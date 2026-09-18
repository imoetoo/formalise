import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../shared/types';
import {
  NOTHING_SELECTED,
  beautifyOnce,
  createBeautifyController,
  type BeautifyDeps,
} from './beautify';
import type { RewriteOutcome } from './claude';
import type { SubstanceReport } from './substanceCheck';

// Electron's clipboard, replaced so the real read path runs and every write is a recorded spy.
// Electron 44's clipboard is promise-based; the mock mirrors its surface (has/read/readText are
// reads; write/writeText/clear mutate).
const clipboardMock = vi.hoisted(() => ({
  readText: vi.fn<() => Promise<string>>(() => Promise.resolve('')),
  read: vi.fn(() => Promise.resolve([])),
  has: vi.fn(() => Promise.resolve(false)),
  writeText: vi.fn(() => Promise.resolve()),
  write: vi.fn(() => Promise.resolve()),
  clear: vi.fn(),
}));
const CLIPBOARD_MUTATORS = ['writeText', 'write', 'clear'] as const;
vi.mock('electron', () => ({ clipboard: clipboardMock }));

const ORIGINAL = 'i dont care you need to get this done by tomorrow';
const OUTCOME: RewriteOutcome = {
  direction: 'beautify',
  input: ORIGINAL,
  output:
    'I really appreciate all that you have done for me so far. I understand time might be tight, but would you kindly do this by tomorrow?',
  additions: ['I really appreciate all that you have done for me so far'],
};
const CLEAN: SubstanceReport = { ok: true, found: [], missing: [] };

function fakeDeps(overrides: Partial<BeautifyDeps> = {}): BeautifyDeps & {
  shown: ReviewPayload[];
} {
  const shown: ReviewPayload[] = [];
  return {
    readSelection: () => Promise.resolve(ORIGINAL),
    show: (payload) => {
      shown.push(payload);
    },
    rewrite: vi.fn(() => Promise.resolve(OUTCOME)),
    substanceCheck: () => CLEAN,
    ...overrides,
    shown,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('beautifyOnce', () => {
  it('shows the original immediately with the result pending, then the softer reading beside it', async () => {
    const deps = fakeDeps();
    const done = await beautifyOnce(ORIGINAL, deps);
    expect(deps.shown).toHaveLength(2);
    expect(deps.shown[0]).toEqual({
      direction: 'beautify',
      original: ORIGINAL,
      result: '',
      additions: [],
    });
    expect(deps.shown[1]).toBe(done);
    expect(done.original).toBe(ORIGINAL);
    expect(done.result).toBe(OUTCOME.output);
    expect(done.additions).toEqual(OUTCOME.additions);
    expect(done.missing).toEqual([]);
    expect(done.error).toBeUndefined();
  });

  it('passes the captured text to rewrite() in the beautify direction, untouched', async () => {
    const deps = fakeDeps();
    await beautifyOnce(ORIGINAL, deps);
    expect(deps.rewrite).toHaveBeenCalledWith(ORIGINAL, 'beautify');
  });

  it('carries the substance report’s missing items to the window', async () => {
    const report: SubstanceReport = {
      ok: false,
      found: [{ kind: 'deadline', text: 'by tomorrow' }],
      missing: [{ kind: 'deadline', text: 'by tomorrow' }],
    };
    const deps = fakeDeps({ substanceCheck: () => report });
    const done = await beautifyOnce(ORIGINAL, deps);
    expect(done.missing).toEqual([{ kind: 'deadline', text: 'by tomorrow' }]);
  });

  it('on an engine error keeps the original visible, has no result, and says why', async () => {
    const deps = fakeDeps({
      rewrite: vi.fn(() =>
        Promise.reject(new Error('ANTHROPIC_API_KEY is not set. Nothing was sent.')),
      ),
    });
    const done = await beautifyOnce(ORIGINAL, deps);
    expect(done.original).toBe(ORIGINAL);
    expect(done.result).toBe('');
    expect(done.additions).toEqual([]);
    expect(done.error).toContain('ANTHROPIC_API_KEY');
    expect(deps.shown.at(-1)).toBe(done);
  });

  it('with nothing selected, explains instead of calling the engine', async () => {
    const deps = fakeDeps();
    const done = await beautifyOnce('   ', deps);
    expect(done.error).toBe(NOTHING_SELECTED);
    expect(deps.rewrite).not.toHaveBeenCalled();
    expect(deps.shown).toEqual([done]);
  });
});

describe('createBeautifyController', () => {
  it('trigger reads the selection once; retry re-runs the same original without re-reading', async () => {
    const readSelection = vi.fn(() => Promise.resolve(ORIGINAL));
    const deps = fakeDeps({ readSelection });
    const controller = createBeautifyController(deps);

    expect(controller.isActive()).toBe(false);
    const first = await controller.trigger();
    expect(controller.isActive()).toBe(true);
    expect(first.original).toBe(ORIGINAL);

    readSelection.mockResolvedValue('something else copied since');
    const again = await controller.retry();
    expect(again?.original).toBe(ORIGINAL);
    expect(readSelection).toHaveBeenCalledTimes(1);
    expect(deps.rewrite).toHaveBeenCalledTimes(2);
  });

  it('a failed selection read is shown as the reason, never thrown at the hotkey', async () => {
    const deps = fakeDeps({ readSelection: () => Promise.reject(new Error('clipboard busy')) });
    const controller = createBeautifyController(deps);
    const shown = await controller.trigger();
    expect(shown.error).toContain('clipboard busy');
    expect(shown.result).toBe('');
    expect(deps.rewrite).not.toHaveBeenCalled();
    expect(await controller.retry()).toBeNull();
  });

  it('retry does nothing when Beautify is not the active direction', async () => {
    const deps = fakeDeps();
    const controller = createBeautifyController(deps);
    expect(await controller.retry()).toBeNull();
    await controller.trigger();
    controller.deactivate();
    expect(await controller.retry()).toBeNull();
    expect(deps.rewrite).toHaveBeenCalledTimes(1);
  });
});

describe('no write-back path (PLAN.md §3)', () => {
  it('the full flow through the real clipboard reader never writes to the clipboard', async () => {
    const { readSelectionFromClipboard } = await import('./clipboardSelection');
    clipboardMock.readText.mockResolvedValue(ORIGINAL);
    const deps = fakeDeps({ readSelection: readSelectionFromClipboard });
    const controller = createBeautifyController(deps);

    await controller.trigger();
    await controller.retry();
    await beautifyOnce(ORIGINAL, {
      ...deps,
      rewrite: () => Promise.reject(new Error('network down')),
    });

    expect(clipboardMock.readText).toHaveBeenCalled();
    for (const name of CLIPBOARD_MUTATORS) {
      expect(
        clipboardMock[name],
        `clipboard.${name} must never be called by Beautify`,
      ).not.toHaveBeenCalled();
    }
  });

  it('the Beautify modules contain no clipboard write or selection replacement', async () => {
    const { readFile } = await import('node:fs/promises');
    const sources = await Promise.all(
      [
        'src/main/beautify.ts',
        'src/main/clipboardSelection.ts',
        'src/renderer/src/BeautifyView.tsx',
      ].map((path) => readFile(path, 'utf8')),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/clipboard\.write/);
      expect(source).not.toMatch(/writeText|clipboard\.clear|ClipboardItem/);
      expect(source).not.toMatch(/'accept'/);
      expect(source).not.toMatch(/sendInputEvent|robotjs|nut-js|keyboard\.type/);
    }
  });
});
