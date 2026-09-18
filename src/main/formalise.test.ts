import { describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../shared/types';
import type { RewriteOutcome } from './claude';
import { MissingApiKeyError } from './errors';
import {
  RESTORED_INSTRUCTION,
  UNDO_HINT,
  createFormaliseController,
  type FormaliseDeps,
} from './formalise';
import { NOTHING_CAPTURED, PASTE_INSTRUCTION, createClipboardSelection } from './selection';
import { UndoBuffer } from './undo';

const ORIGINAL = 'wakao! where got enough time sia';
const OUTCOME: RewriteOutcome = {
  direction: 'formalise',
  input: ORIGINAL,
  output:
    'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?',
  additions: ['Hi boss,', 'due to the complexities of the tasks', 'would you kindly allow me'],
  additionDetails: [
    { kind: 'framing', text: 'Hi boss,' },
    { kind: 'reasoning', text: 'due to the complexities of the tasks' },
    { kind: 'framing', text: 'would you kindly allow me' },
  ],
  reasoning: ['due to the complexities of the tasks'],
  substance: {
    ok: false,
    found: [{ kind: 'position', text: 'where got enough time' }],
    missing: [{ kind: 'position', text: 'where got enough time' }],
  },
  model: 'claude-sonnet-5-test',
};

function harness(overrides: Partial<FormaliseDeps> = {}, clipboardText = ORIGINAL) {
  let clip = clipboardText;
  const clipboard = {
    readText: vi.fn(() => Promise.resolve(clip)),
    writeText: vi.fn((text: string) => {
      clip = text;
      return Promise.resolve();
    }),
  };
  const shown: ReviewPayload[] = [];
  const hide = vi.fn();
  const rewrite = vi.fn(() => Promise.resolve(OUTCOME));
  const deps: FormaliseDeps = {
    selection: createClipboardSelection(clipboard),
    show: (p) => {
      shown.push(p);
    },
    hide,
    rewrite,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return {
    controller: createFormaliseController(deps),
    shown,
    hide,
    rewrite,
    clipboard,
    get clip() {
      return clip;
    },
  };
}

describe('Formalise controller: trigger', () => {
  it('shows the original at once while loading, then the result with flags and reasoning', async () => {
    const h = harness();
    const done = await h.controller.trigger();
    expect(h.shown).toHaveLength(2);
    expect(h.shown[0]).toMatchObject({
      direction: 'formalise',
      original: ORIGINAL,
      result: '',
      status: 'loading',
      canUndo: false,
    });
    expect(h.shown[1]).toBe(done);
    expect(done).toMatchObject({
      status: 'ready',
      original: ORIGINAL,
      result: OUTCOME.output,
      additions: OUTCOME.additions,
      reasoning: ['due to the complexities of the tasks'],
      missing: [{ kind: 'position', text: 'where got enough time' }],
    });
    expect(h.rewrite).toHaveBeenCalledWith(ORIGINAL, 'formalise');
    expect(h.controller.isActive()).toBe(true);
    // Nothing was written: the clipboard still holds the original.
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('with nothing captured, explains how to copy first and never calls the engine', async () => {
    const h = harness({}, '   ');
    const done = await h.controller.trigger();
    expect(done.status).toBe('error');
    expect(done.error).toBe(NOTHING_CAPTURED);
    expect(h.rewrite).not.toHaveBeenCalled();
    expect(await h.controller.retry()).toBeNull();
  });

  it('on an engine error keeps the original visible, has no result, says why and leaves the clipboard alone', async () => {
    const h = harness({ rewrite: vi.fn(() => Promise.reject(new MissingApiKeyError())) });
    const done = await h.controller.trigger();
    expect(done.status).toBe('error');
    expect(done.result).toBe('');
    expect(done.original).toBe(ORIGINAL);
    expect(done.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(done.error).toMatch(/untouched/);
    expect(h.clip).toBe(ORIGINAL);
    expect(await h.controller.accept()).toBeNull();
  });

  it('a failed selection read is shown, never thrown at the hotkey', async () => {
    const h = harness({
      selection: {
        readSelection: () => Promise.reject(new Error('clipboard busy')),
        writeSelection: () => Promise.reject(new Error('unused')),
      },
    });
    const done = await h.controller.trigger();
    expect(done.error).toContain('clipboard busy');
    expect(h.rewrite).not.toHaveBeenCalled();
  });
});

describe('Formalise controller: retry', () => {
  it('re-runs the same original without re-reading the selection', async () => {
    const h = harness();
    await h.controller.trigger();
    h.clipboard.readText.mockResolvedValue('something copied since');
    const again = await h.controller.retry();
    expect(again?.original).toBe(ORIGINAL);
    expect(h.clipboard.readText).toHaveBeenCalledTimes(1);
    expect(h.rewrite).toHaveBeenCalledTimes(2);
  });

  it('does nothing when inactive', async () => {
    const h = harness();
    expect(await h.controller.retry()).toBeNull();
    await h.controller.trigger();
    h.controller.deactivate();
    expect(await h.controller.retry()).toBeNull();
  });

  it('a stale response never overwrites a newer run', async () => {
    let resolveFirst: (o: RewriteOutcome) => void = () => undefined;
    const slow = new Promise<RewriteOutcome>((r) => {
      resolveFirst = r;
    });
    const rewrite = vi
      .fn<() => Promise<RewriteOutcome>>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ ...OUTCOME, output: 'second' });
    const h = harness({ rewrite });
    const first = h.controller.trigger();
    await vi.waitFor(() => {
      expect(rewrite).toHaveBeenCalledTimes(1);
    });
    await h.controller.retry();
    resolveFirst({ ...OUTCOME, output: 'first (stale)' });
    await first;
    expect(h.shown.at(-1)?.result).toBe('second');
    expect(h.shown.some((p) => p.result === 'first (stale)')).toBe(false);
  });
});

describe('Formalise controller: accept and undo', () => {
  it('Enter writes the result to the clipboard, tells the user to paste and records an undo entry', async () => {
    const undo = new UndoBuffer(2);
    const h = harness({ undo });
    await h.controller.trigger();
    const accepted = await h.controller.accept();
    expect(h.clip).toBe(OUTCOME.output);
    expect(accepted).toMatchObject({
      status: 'accepted',
      original: ORIGINAL,
      result: OUTCOME.output,
      canUndo: true,
      notice: `${PASTE_INSTRUCTION} ${UNDO_HINT}`,
    });
    expect(undo.peek()).toEqual({
      original: ORIGINAL,
      rewrite: OUTCOME.output,
      at: 1_700_000_000_000,
    });
    // Accepting twice would need a new result.
    expect(await h.controller.accept()).toBeNull();
  });

  it('never accepts before a result exists', async () => {
    const h = harness({ rewrite: vi.fn(() => new Promise<RewriteOutcome>(() => undefined)) });
    void h.controller.trigger();
    await Promise.resolve();
    expect(await h.controller.accept()).toBeNull();
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('U puts the previous original back on the clipboard, most recent first', async () => {
    const h = harness();
    await h.controller.trigger();
    await h.controller.accept();
    h.clipboard.readText.mockResolvedValue('second message lah');
    await h.controller.trigger();
    await h.controller.accept();

    const undone = await h.controller.undo();
    expect(h.clip).toBe('second message lah');
    expect(undone).toMatchObject({
      status: 'accepted',
      original: 'second message lah',
      result: OUTCOME.output,
      canUndo: true,
    });
    expect(undone?.notice).toBe(`${RESTORED_INSTRUCTION} ${UNDO_HINT}`);

    const undoneAgain = await h.controller.undo();
    expect(h.clip).toBe(ORIGINAL);
    expect(undoneAgain?.canUndo).toBe(false);
    expect(undoneAgain?.notice).toBe(RESTORED_INSTRUCTION);
    expect(await h.controller.undo()).toBeNull();
  });

  it('Esc hides and touches nothing', async () => {
    const h = harness();
    await h.controller.trigger();
    h.controller.cancel();
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.clip).toBe(ORIGINAL);
    expect(h.controller.isActive()).toBe(false);
    expect(await h.controller.accept()).toBeNull();
  });

  it('idle() carries the hotkeys in force and the undo state', async () => {
    const hotkeys = { formalise: 'Ctrl+Alt+P', beautify: 'Ctrl+Alt+W' };
    const h = harness({ hotkeys });
    expect(h.controller.idle()).toEqual({
      direction: 'formalise',
      hotkeys,
      canUndo: false,
      original: '',
      result: '',
      additions: [],
      status: 'idle',
    });
    await h.controller.trigger();
    await h.controller.accept();
    expect(h.controller.idle('boom')).toMatchObject({ canUndo: true, error: 'boom' });
  });
});
