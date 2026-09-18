// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPayload } from '../../shared/types';
import { ReviewWindow, decisionForKey } from './ReviewWindow';

afterEach(cleanup);

const beautify: ReviewPayload = {
  direction: 'beautify',
  original: 'i dont care you need to get this done by tomorrow',
  result: 'I understand time might be tight, would you kindly do this by tomorrow?',
  additions: ['I really appreciate all that you have done for me so far'],
};

describe('decisionForKey', () => {
  it('maps Enter, Esc and R and ignores everything else', () => {
    const plain = { altKey: false, ctrlKey: false, metaKey: false };
    expect(decisionForKey({ key: 'Enter', ...plain })).toBe('accept');
    expect(decisionForKey({ key: 'Escape', ...plain })).toBe('cancel');
    expect(decisionForKey({ key: 'r', ...plain })).toBe('retry');
    expect(decisionForKey({ key: 'R', ...plain })).toBe('retry');
    expect(decisionForKey({ key: 'a', ...plain })).toBeNull();
    expect(decisionForKey({ key: ' ', ...plain })).toBeNull();
  });

  it('ignores chords so the hotkeys themselves never count as a decision', () => {
    expect(
      decisionForKey({ key: 'Enter', altKey: false, ctrlKey: true, metaKey: false }),
    ).toBeNull();
    expect(decisionForKey({ key: 'r', altKey: false, ctrlKey: false, metaKey: true })).toBeNull();
  });
});

describe('ReviewWindow', () => {
  it("renders original and result side by side with additions marked as the tool's", () => {
    render(<ReviewWindow payload={beautify} onDecide={vi.fn()} />);
    expect(screen.getByText(beautify.original)).toBeTruthy();
    expect(screen.getByText(beautify.result)).toBeTruthy();
    const additions = screen.getByRole('complementary');
    expect(additions.textContent).toContain('Added by Formalise');
    expect(additions.textContent).toContain(beautify.additions[0]);
  });

  it('Enter accepts, Esc cancels, R retries', () => {
    const onDecide = vi.fn();
    render(<ReviewWindow payload={beautify} onDecide={onDecide} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'r' });
    expect(onDecide.mock.calls).toEqual([['accept'], ['cancel'], ['retry']]);
  });

  it('never accepts an empty result, but still allows cancel and retry', () => {
    const onDecide = vi.fn();
    render(
      <ReviewWindow
        payload={{ ...beautify, result: '', error: 'ANTHROPIC_API_KEY is not set.' }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('ANTHROPIC_API_KEY');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDecide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'R' });
    expect(onDecide.mock.calls).toEqual([['cancel'], ['retry']]);
  });
});
