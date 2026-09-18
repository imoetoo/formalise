import { useEffect } from 'react';
import { formatAccelerator } from '../../../shared/accelerator';
import {
  HOTKEYS,
  type ReviewDecision,
  type ReviewPayload,
  type ReviewStatus,
} from '../../../shared/types';

export interface FormaliseReviewProps {
  payload: ReviewPayload;
  onDecide: (decision: ReviewDecision) => void;
}

/** Maps a keydown to a Formalise decision, or null. Exported for tests. */
export function formaliseDecisionForKey(event: {
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
    case 'u':
    case 'U':
      return 'undo';
    default:
      return null;
  }
}

/** The life-cycle state, inferred for payloads from callers that do not set it. */
export function statusOf(payload: ReviewPayload): ReviewStatus {
  if (payload.status !== undefined) {
    return payload.status;
  }
  return payload.result.length > 0 ? 'ready' : 'error';
}

export const FORMALISE_LABELS = {
  title: 'Formalise',
  original: 'What you wrote',
  result: 'Professional version',
  accept: 'Enter copies it for pasting',
  cancel: 'cancel',
  retry: 'retry',
  undo: 'undo last',
  loading: 'Asking Claude for a professional version…',
  idle: (hotkeys: Readonly<Record<'formalise' | 'beautify', string>>): string =>
    `Waiting for a hotkey. Copy your text (Ctrl/Cmd+C), then ${formatAccelerator(hotkeys.formalise)} formalises it; ${formatAccelerator(hotkeys.beautify)} beautifies a message you received.`,
  additions: 'Added by Formalise, not in your words (check before sending)',
  reasoning: 'Reason invented by Formalise. You never said this; make sure it is true.',
  framing: 'Framing added by Formalise',
  missing: 'Missing from the professional version',
  missingHelp: 'Your original said this and the rewrite does not. Retry (R) or edit after pasting.',
} as const;

/**
 * Formalise: what you wrote on the left, the professional version on the right. Substance the
 * rewrite dropped is flagged (PLAN.md §2); anything the tool added is listed apart, with invented
 * reasoning called out more loudly than greetings and politeness (PLAN.md §4, "Careful"). Enter
 * accepts only when a result is showing, so an empty or pending result can never replace the
 * user's text; Esc cancels; R retries; U undoes the last accepted rewrite.
 */
export function FormaliseReview({ payload, onDecide }: FormaliseReviewProps): React.JSX.Element {
  const status = statusOf(payload);
  const hasResult = payload.result.length > 0;
  const canAccept = status === 'ready' && hasResult;
  const canRetry = payload.original.trim().length > 0 && status !== 'loading';
  const canUndo = payload.canUndo === true;
  const hotkeys = payload.hotkeys ?? HOTKEYS;
  const reasoning = new Set(payload.reasoning ?? []);
  const framing = payload.additions.filter((a) => !reasoning.has(a));
  const missing = payload.missing ?? [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const decision = formaliseDecisionForKey(event);
      if (decision === null) {
        return;
      }
      if (
        (decision === 'accept' && !canAccept) ||
        (decision === 'retry' && !canRetry) ||
        (decision === 'undo' && !canUndo)
      ) {
        return;
      }
      event.preventDefault();
      onDecide(decision);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [canAccept, canRetry, canUndo, onDecide]);

  return (
    <main className="review review--formalise" data-direction="formalise" data-status={status}>
      <header className="review__header">
        <h1>{FORMALISE_LABELS.title}</h1>
        <p className="review__hint">
          <kbd aria-disabled={!canAccept}>Enter</kbd> <span>{FORMALISE_LABELS.accept}</span> ·{' '}
          <kbd>Esc</kbd> <span>{FORMALISE_LABELS.cancel}</span> ·{' '}
          <kbd aria-disabled={!canRetry}>R</kbd> <span>{FORMALISE_LABELS.retry}</span>
          {canUndo ? (
            <>
              {' '}
              · <kbd>U</kbd> <span>{FORMALISE_LABELS.undo}</span>
            </>
          ) : null}
        </p>
      </header>

      {status === 'accepted' && payload.notice !== undefined ? (
        <p className="notice" role="status" data-testid="formalise-notice">
          {payload.notice}
        </p>
      ) : null}

      <section className="review__panes">
        <article className="pane pane--original" aria-label={FORMALISE_LABELS.original}>
          <h2>{FORMALISE_LABELS.original}</h2>
          {payload.original.length > 0 ? (
            <pre className="pane__text" data-testid="formalise-original">
              {payload.original}
            </pre>
          ) : (
            <p className="pane__empty">{status === 'idle' ? FORMALISE_LABELS.idle(hotkeys) : ''}</p>
          )}
        </article>
        <article className="pane" aria-label={FORMALISE_LABELS.result}>
          <h2>{FORMALISE_LABELS.result}</h2>
          {hasResult ? (
            <pre className="pane__text" data-testid="formalise-result">
              {payload.result}
            </pre>
          ) : (
            <p className="pane__empty" role="status" aria-busy={status === 'loading'}>
              {status === 'loading'
                ? FORMALISE_LABELS.loading
                : (payload.error ?? (status === 'idle' ? '' : 'No result.'))}
            </p>
          )}
        </article>
      </section>

      {missing.length > 0 ? (
        <section className="missing" role="alert" aria-label={FORMALISE_LABELS.missing}>
          <h2>{FORMALISE_LABELS.missing}</h2>
          <ul>
            {missing.map((item) => (
              <li key={`${item.kind}:${item.text}`}>
                <span className="missing__kind">{item.kind}</span> {item.text}
              </li>
            ))}
          </ul>
          <p className="missing__help">{FORMALISE_LABELS.missingHelp}</p>
        </section>
      ) : null}

      {payload.additions.length > 0 ? (
        <aside className="additions" aria-label={FORMALISE_LABELS.additions}>
          <h2>{FORMALISE_LABELS.additions}</h2>
          {reasoning.size > 0 ? (
            <div className="additions__reasoning" data-testid="formalise-reasoning">
              <h3>{FORMALISE_LABELS.reasoning}</h3>
              <ul>
                {[...reasoning].map((text) => (
                  <li key={text}>
                    <mark className="tool-added tool-added--reasoning">{text}</mark>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {framing.length > 0 ? (
            <div className="additions__framing" data-testid="formalise-framing">
              {reasoning.size > 0 ? <h3>{FORMALISE_LABELS.framing}</h3> : null}
              <ul>
                {framing.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
