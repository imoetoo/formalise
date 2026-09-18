// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../../shared/types';
import {
  BEAUTIFY_LABELS,
  BeautifyView,
  beautifyDecisionForKey,
  segmentOutput,
} from './BeautifyView';

afterEach(cleanup);

const ORIGINAL = 'i dont care you need to get this done by tomorrow';
const payload: ReviewPayload = {
  direction: 'beautify',
  original: ORIGINAL,
  result:
    'I really appreciate all that you have done for me so far, perhaps just a little bit more. I understand time might be tight, but knowing how amazing you are, would you kindly do this by tomorrow?',
  additions: [
    'I really appreciate all that you have done for me so far',
    'knowing how amazing you are',
  ],
};

describe('beautifyDecisionForKey', () => {
  const plain = { altKey: false, ctrlKey: false, metaKey: false };

  it('maps Esc and R only; Enter is not a decision because there is nothing to accept', () => {
    expect(beautifyDecisionForKey({ key: 'Escape', ...plain })).toBe('cancel');
    expect(beautifyDecisionForKey({ key: 'r', ...plain })).toBe('retry');
    expect(beautifyDecisionForKey({ key: 'R', ...plain })).toBe('retry');
    expect(beautifyDecisionForKey({ key: 'Enter', ...plain })).toBeNull();
    expect(beautifyDecisionForKey({ key: 'a', ...plain })).toBeNull();
  });

  it('ignores chords so the hotkeys themselves never count as a decision', () => {
    expect(
      beautifyDecisionForKey({ key: 'r', altKey: false, ctrlKey: true, metaKey: false }),
    ).toBeNull();
    expect(
      beautifyDecisionForKey({ key: 'Escape', altKey: false, ctrlKey: false, metaKey: true }),
    ).toBeNull();
  });
});

describe('segmentOutput', () => {
  it('marks each addition once, in order, and leaves the rest as the sender’s words', () => {
    expect(segmentOutput(payload.result, payload.additions)).toEqual([
      { text: 'I really appreciate all that you have done for me so far', added: true },
      {
        text: ', perhaps just a little bit more. I understand time might be tight, but ',
        added: false,
      },
      { text: 'knowing how amazing you are', added: true },
      { text: ', would you kindly do this by tomorrow?', added: false },
    ]);
  });

  it('ignores additions that are not in the output and empty strings; never loses text', () => {
    const segments = segmentOutput('please do this by tomorrow', ['not here', '']);
    expect(segments).toEqual([{ text: 'please do this by tomorrow', added: false }]);
    const all = segmentOutput(payload.result, payload.additions)
      .map((s) => s.text)
      .join('');
    expect(all).toBe(payload.result);
  });

  it('does not double-mark overlapping additions', () => {
    expect(segmentOutput('you are amazing, truly amazing', ['amazing', 'you are amazing'])).toEqual(
      [
        { text: 'you are amazing', added: true },
        { text: ', truly ', added: false },
        { text: 'amazing', added: true },
      ],
    );
  });
});

describe('BeautifyView', () => {
  it('shows the original and the softer reading side by side, original first and untouched', () => {
    render(<BeautifyView payload={payload} onDecide={vi.fn()} />);
    const original = screen.getByTestId('beautify-original');
    expect(original.textContent).toBe(ORIGINAL);
    const panes = screen.getAllByRole('article');
    expect(panes).toHaveLength(2);
    expect(panes[0]?.getAttribute('aria-label')).toBe(BEAUTIFY_LABELS.original);
    expect(panes[1]?.getAttribute('aria-label')).toBe(BEAUTIFY_LABELS.result);
    expect(screen.getByTestId('beautify-result').textContent).toBe(payload.result);
  });

  it('never makes the original editable', () => {
    render(<BeautifyView payload={payload} onDecide={vi.fn()} />);
    const original = screen.getByTestId('beautify-original');
    expect(original.tagName).toBe('PRE');
    expect(original.getAttribute('contenteditable')).toBeNull();
    expect(document.querySelectorAll('textarea, input, [contenteditable="true"]')).toHaveLength(0);
  });

  it('keeps the original visible while the result is pending and when the engine failed', () => {
    const { unmount } = render(
      <BeautifyView payload={{ ...payload, result: '', additions: [] }} onDecide={vi.fn()} />,
    );
    expect(screen.getByTestId('beautify-original').textContent).toBe(ORIGINAL);
    expect(screen.getByRole('status').textContent).toBe(BEAUTIFY_LABELS.pending);
    unmount();

    render(
      <BeautifyView
        payload={{ ...payload, result: '', additions: [], error: 'ANTHROPIC_API_KEY is not set.' }}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByTestId('beautify-original').textContent).toBe(ORIGINAL);
    expect(screen.getByRole('status').textContent).toContain('ANTHROPIC_API_KEY');
  });

  it("marks additions inline and lists them apart, both labelled as Formalise's, not the sender's", () => {
    render(<BeautifyView payload={payload} onDecide={vi.fn()} />);

    const marks = screen
      .getByTestId('beautify-result')
      .querySelectorAll('mark[data-added-by="formalise"]');
    expect(Array.from(marks, (m) => m.textContent)).toEqual(payload.additions);
    for (const mark of marks) {
      expect(mark.getAttribute('title')).toBe(BEAUTIFY_LABELS.addedMark);
    }

    const list = screen.getByRole('complementary');
    expect(list.getAttribute('aria-label')).toBe(BEAUTIFY_LABELS.additions);
    expect(within(list).getByRole('heading').textContent).toBe('Added by Formalise, not by them');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(payload.additions);

    // The additions never appear inside the original pane.
    const original = screen.getByTestId('beautify-original');
    for (const addition of payload.additions) {
      expect(original.textContent).not.toContain(addition);
    }
  });

  it('omits the additions block when nothing was added', () => {
    render(<BeautifyView payload={{ ...payload, additions: [] }} onDecide={vi.fn()} />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.querySelectorAll('mark')).toHaveLength(0);
  });

  it('flags substance the check could not find in the softer reading', () => {
    render(
      <BeautifyView
        payload={{ ...payload, missing: [{ kind: 'deadline', text: 'by tomorrow' }] }}
        onDecide={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(BEAUTIFY_LABELS.missing);
    expect(alert.textContent).toContain('deadline');
    expect(alert.textContent).toContain('by tomorrow');
  });

  it('shows no flags when the report has nothing missing', () => {
    const { unmount } = render(
      <BeautifyView payload={{ ...payload, missing: [] }} onDecide={vi.fn()} />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    render(<BeautifyView payload={payload} onDecide={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no accept-and-replace control and says nothing is written back', () => {
    render(<BeautifyView payload={payload} onDecide={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).toMatch(/Nothing is written back/);
    expect(document.body.textContent).not.toMatch(/accept|replace/i);
    expect(document.querySelectorAll('kbd')).toHaveLength(2);
  });

  it('Esc closes and R retries; Enter does nothing, even with a result', () => {
    const onDecide = vi.fn();
    render(<BeautifyView payload={payload} onDecide={onDecide} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'R' });
    expect(onDecide.mock.calls).toEqual([['cancel'], ['retry'], ['retry']]);
    expect(onDecide.mock.calls.flat()).not.toContain('accept');
  });
});
