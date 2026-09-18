import { useEffect } from 'react';
import type { ReviewDecision, ReviewPayload } from '../../shared/types';

export interface ReviewWindowProps {
  payload: ReviewPayload;
  onDecide: (decision: ReviewDecision) => void;
}

/** Maps a keydown to a decision, or null. Exported for tests. */
export function decisionForKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): ReviewDecision | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  switch (event.key) {
    case 'Enter':
      return 'accept';
    case 'Escape':
      return 'cancel';
    case 'r':
    case 'R':
      return 'retry';
    default:
      return null;
  }
}

const LABELS = {
  formalise: {
    title: 'Formalise',
    original: 'What you wrote',
    result: 'Professional version',
    accept: 'Enter replaces your text',
    additions: 'Added by Formalise, not in your words (check before sending)',
  },
  beautify: {
    title: 'Beautify',
    original: 'What they actually wrote',
    result: 'Softer reading',
    accept: 'Enter closes; nothing is written back',
    additions: 'Added by Formalise, not by them',
  },
} as const;

/**
 * Keyboard-first review: original and result side by side, Enter accept, Esc cancel, R retry.
 * Beautify never writes back; anything the tool added is shown apart and attributed
 * (PLAN.md §3). The window is the only thing standing between a rewrite and the user's compose
 * box, so it must never accept on a key that was not clearly meant for it.
 */
export function ReviewWindow({ payload, onDecide }: ReviewWindowProps): React.JSX.Element {
  const labels = LABELS[payload.direction];
  const hasResult = payload.result.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const decision = decisionForKey(event);
      if (decision === null) {
        return;
      }
      if (decision === 'accept' && !hasResult) {
        // Nothing to accept: an empty result must never replace the user's text.
        return;
      }
      event.preventDefault();
      onDecide(decision);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hasResult, onDecide]);

  return (
    <main className="review" data-direction={payload.direction}>
      <header className="review__header">
        <h1>{labels.title}</h1>
        <p className="review__hint">
          <kbd>Enter</kbd> {labels.accept} · <kbd>Esc</kbd> cancel · <kbd>R</kbd> retry
        </p>
      </header>

      <section className="review__panes">
        <article className="pane" aria-label={labels.original}>
          <h2>{labels.original}</h2>
          <pre className="pane__text">{payload.original}</pre>
        </article>
        <article className="pane" aria-label={labels.result}>
          <h2>{labels.result}</h2>
          {hasResult ? (
            <pre className="pane__text">{payload.result}</pre>
          ) : (
            <p className="pane__empty" role="status">
              {payload.error ?? 'No result.'}
            </p>
          )}
        </article>
      </section>

      {payload.additions.length > 0 ? (
        <aside className="additions" aria-label={labels.additions}>
          <h2>{labels.additions}</h2>
          <ul>
            {payload.additions.map((addition) => (
              <li key={addition}>{addition}</li>
            ))}
          </ul>
        </aside>
      ) : null}
    </main>
  );
}
