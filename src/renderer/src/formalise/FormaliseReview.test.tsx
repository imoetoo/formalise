// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../../../shared/types';
import { FormaliseReview, formaliseDecisionForKey, statusOf } from './FormaliseReview';

afterEach(cleanup);

const ready: ReviewPayload = {
  direction: 'formalise',
  status: 'ready',
  original: 'wakao! where got enough time sia',
  result:
    'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?',
  additions: ['Hi boss,', 'due to the complexities of the tasks', 'would you kindly allow me'],
  reasoning: ['due to the complexities of the tasks'],
  missing: [],
  canUndo: false,
};

/** `ready` without its status, for callers that never set one. */
const { status: _readyStatus, ...noStatus } = ready;

const keys = (...names: string[]): void => {
  for (const key of names) {
    fireEvent.keyDown(window, { key });
  }
};

describe('formaliseDecisionForKey', () => {
  it('maps Enter, Esc, R and U, and ignores chords and other keys', () => {
    const plain = { altKey: false, ctrlKey: false, metaKey: false };
    expect(formaliseDecisionForKey({ key: 'Enter', ...plain })).toBe('accept');
    expect(formaliseDecisionForKey({ key: 'Escape', ...plain })).toBe('cancel');
    expect(formaliseDecisionForKey({ key: 'R', ...plain })).toBe('retry');
    expect(formaliseDecisionForKey({ key: 'u', ...plain })).toBe('undo');
    expect(formaliseDecisionForKey({ key: 'a', ...plain })).toBeNull();
    expect(formaliseDecisionForKey({ key: 'Enter', ...plain, ctrlKey: true })).toBeNull();
    expect(formaliseDecisionForKey({ key: 'u', ...plain, altKey: true })).toBeNull();
  });

  it('statusOf infers ready/error for payloads without a status', () => {
    expect(statusOf(noStatus)).toBe('ready');
    expect(statusOf({ ...noStatus, result: '' })).toBe('error');
    expect(statusOf({ ...ready, status: 'loading' })).toBe('loading');
  });
});

describe('FormaliseReview states', () => {
  it('idle: names the hotkeys in force and accepts nothing', () => {
    const onDecide = vi.fn();
    render(
      <FormaliseReview
        payload={{
          direction: 'formalise',
          status: 'idle',
          original: '',
          result: '',
          additions: [],
          hotkeys: { formalise: 'CommandOrControl+Alt+Shift+F', beautify: 'Ctrl+Alt+W' },
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText(/Ctrl\/Cmd\+Alt\+Shift\+F formalises/)).toBeTruthy();
    expect(screen.getByText(/Ctrl\+Alt\+W beautifies/)).toBeTruthy();
    keys('Enter', 'r', 'u');
    expect(onDecide).not.toHaveBeenCalled();
    keys('Escape');
    expect(onDecide.mock.calls).toEqual([['cancel']]);
  });

  it('loading: shows the original, a busy status, and allows only Esc', () => {
    const onDecide = vi.fn();
    render(
      <FormaliseReview
        payload={{ ...ready, status: 'loading', result: '', additions: [], reasoning: [] }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByTestId('formalise-original').textContent).toBe(ready.original);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Asking Claude/);
    expect(status.getAttribute('aria-busy')).toBe('true');
    keys('Enter', 'r');
    expect(onDecide).not.toHaveBeenCalled();
    keys('Escape');
    expect(onDecide.mock.calls).toEqual([['cancel']]);
  });

  it('error: shows why, never accepts, still allows retry and cancel', () => {
    const onDecide = vi.fn();
    render(
      <FormaliseReview
        payload={{
          ...ready,
          status: 'error',
          result: '',
          additions: [],
          reasoning: [],
          error:
            'ANTHROPIC_API_KEY is not set. Nothing was changed; the selected text is untouched.',
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('ANTHROPIC_API_KEY');
    keys('Enter');
    expect(onDecide).not.toHaveBeenCalled();
    keys('Escape', 'R');
    expect(onDecide.mock.calls).toEqual([['cancel'], ['retry']]);
  });

  it('ready: original and result side by side; Enter accepts, Esc cancels, R retries, U ignored without undo', () => {
    const onDecide = vi.fn();
    render(<FormaliseReview payload={ready} onDecide={onDecide} />);
    expect(screen.getByTestId('formalise-original').textContent).toBe(ready.original);
    expect(screen.getByTestId('formalise-result').textContent).toBe(ready.result);
    expect(screen.queryByRole('alert')).toBeNull();
    keys('Enter', 'Escape', 'r', 'u');
    expect(onDecide.mock.calls).toEqual([['accept'], ['cancel'], ['retry']]);
  });

  it('ready: invented reasoning is marked apart from framing, both attributed to Formalise', () => {
    render(<FormaliseReview payload={ready} onDecide={vi.fn()} />);
    const aside = screen.getByRole('complementary');
    expect(aside.textContent).toContain('Added by Formalise');
    const reasoning = screen.getByTestId('formalise-reasoning');
    expect(reasoning.textContent).toContain('Reason invented by Formalise');
    expect(reasoning.textContent).toContain('due to the complexities of the tasks');
    expect(reasoning.querySelector('mark.tool-added--reasoning')).not.toBeNull();
    const framing = screen.getByTestId('formalise-framing');
    expect(framing.textContent).toContain('Hi boss,');
    expect(framing.textContent).toContain('would you kindly allow me');
    expect(framing.textContent).not.toContain('due to the complexities');
  });

  it('ready: substance that went missing is flagged as an alert with kind and text', () => {
    render(
      <FormaliseReview
        payload={{
          ...ready,
          missing: [
            { kind: 'deadline', text: 'by friday' },
            { kind: 'position', text: 'scope doubled' },
          ],
        }}
        onDecide={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Missing from the professional version');
    expect(alert.textContent).toContain('deadline');
    expect(alert.textContent).toContain('by friday');
    expect(alert.textContent).toContain('scope doubled');
  });

  it('accepted: shows the paste instruction and offers undo; Enter no longer accepts', () => {
    const onDecide = vi.fn();
    render(
      <FormaliseReview
        payload={{
          ...ready,
          status: 'accepted',
          canUndo: true,
          notice: 'Copied to your clipboard. Paste to replace. Press U to undo the last rewrite.',
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByTestId('formalise-notice').textContent).toMatch(/Copied to your clipboard/);
    expect(screen.getByText('undo last')).toBeTruthy();
    keys('Enter');
    expect(onDecide).not.toHaveBeenCalled();
    keys('u', 'Escape');
    expect(onDecide.mock.calls).toEqual([['undo'], ['cancel']]);
  });

  it('a payload without a status still behaves: result means ready, empty means error', () => {
    const onDecide = vi.fn();
    const { unmount } = render(<FormaliseReview payload={noStatus} onDecide={onDecide} />);
    keys('Enter');
    expect(onDecide.mock.calls).toEqual([['accept']]);
    unmount();
    onDecide.mockClear();
    render(
      <FormaliseReview
        payload={{ ...noStatus, result: '', error: 'no network' }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('no network');
    keys('Enter');
    expect(onDecide).not.toHaveBeenCalled();
  });
});
