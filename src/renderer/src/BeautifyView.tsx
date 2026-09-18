import { useEffect } from 'react';
import type { ReviewDecision, ReviewPayload } from '../../shared/types';

/** The decisions Beautify can send. There is no accept: nothing is ever written back. */
export type BeautifyDecision = Extract<ReviewDecision, 'cancel' | 'retry'>;

export interface BeautifyViewProps {
  payload: ReviewPayload;
  onDecide: (decision: BeautifyDecision) => void;
}

/** Maps a keydown to a Beautify decision, or null. Enter is deliberately not mapped. */
export function beautifyDecisionForKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): BeautifyDecision | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  switch (event.key) {
    case 'Escape':
      return 'cancel';
    case 'r':
    case 'R':
      return 'retry';
    default:
      return null;
  }
}

export interface Segment {
  text: string;
  /** True when this span was added by the tool and is not the sender's. */
  added: boolean;
}

/**
 * Split `output` into the sender's words and the tool's additions, so each addition can be
 * rendered as a marked span. Additions are matched verbatim, longest first so a span that
 * contains another is marked whole, each at its first occurrence that does not overlap an
 * earlier match; an addition that is not a substring of the output is simply not marked inline
 * (it still appears in the labelled list). Exported for tests.
 */
export function segmentOutput(output: string, additions: readonly string[]): Segment[] {
  const ranges: { start: number; end: number }[] = [];
  const longestFirst = [...additions].sort((a, b) => b.length - a.length);
  for (const addition of longestFirst) {
    if (addition === '') {
      continue;
    }
    let from = 0;
    let placed = false;
    while (!placed) {
      const start = output.indexOf(addition, from);
      if (start === -1) {
        break;
      }
      const end = start + addition.length;
      const overlaps = ranges.some((r) => start < r.end && end > r.start);
      if (overlaps) {
        from = start + 1;
      } else {
        ranges.push({ start, end });
        placed = true;
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: output.slice(cursor, range.start), added: false });
    }
    segments.push({ text: output.slice(range.start, range.end), added: true });
    cursor = range.end;
  }
  if (cursor < output.length) {
    segments.push({ text: output.slice(cursor), added: false });
  }
  return segments;
}

export const BEAUTIFY_LABELS = {
  title: 'Beautify',
  original: 'What they actually wrote',
  result: 'Softer reading',
  additions: 'Added by Formalise, not by them',
  addedMark: 'Added by Formalise',
  missing: 'Missing from the softer reading',
  pending: 'Asking Claude for a softer reading…',
  noWriteBack: 'Shown here only. Nothing is written back.',
} as const;

/**
 * Beautify: the boss's actual words on the left, always visible, never editable; the softer
 * reading on the right. Anything the tool added is marked inline and listed apart, attributed to
 * Formalise, so the reader never remembers praise they did not receive (PLAN.md §3). There is no
 * accept action: Esc closes, R retries, nothing is written back.
 */
export function BeautifyView({ payload, onDecide }: BeautifyViewProps): React.JSX.Element {
  const hasResult = payload.result.length > 0;
  const missing = payload.missing ?? [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const decision = beautifyDecisionForKey(event);
      if (decision === null) {
        return;
      }
      event.preventDefault();
      onDecide(decision);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onDecide]);

  return (
    <main className="review review--beautify" data-direction="beautify">
      <header className="review__header">
        <h1>{BEAUTIFY_LABELS.title}</h1>
        <p className="review__hint">
          <kbd>Esc</kbd> close · <kbd>R</kbd> retry · {BEAUTIFY_LABELS.noWriteBack}
        </p>
      </header>

      <section className="review__panes">
        <article className="pane pane--original" aria-label={BEAUTIFY_LABELS.original}>
          <h2>{BEAUTIFY_LABELS.original}</h2>
          <pre className="pane__text" data-testid="beautify-original">
            {payload.original}
          </pre>
        </article>
        <article className="pane" aria-label={BEAUTIFY_LABELS.result}>
          <h2>{BEAUTIFY_LABELS.result}</h2>
          {hasResult ? (
            <pre className="pane__text" data-testid="beautify-result">
              {segmentOutput(payload.result, payload.additions).map((segment, index) =>
                segment.added ? (
                  <mark
                    key={index}
                    className="tool-added"
                    data-added-by="formalise"
                    title={BEAUTIFY_LABELS.addedMark}
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </pre>
          ) : (
            <p className="pane__empty" role="status">
              {payload.error ?? BEAUTIFY_LABELS.pending}
            </p>
          )}
        </article>
      </section>

      {payload.additions.length > 0 ? (
        <aside className="additions" aria-label={BEAUTIFY_LABELS.additions}>
          <h2>{BEAUTIFY_LABELS.additions}</h2>
          <ul>
            {payload.additions.map((addition) => (
              <li key={addition}>{addition}</li>
            ))}
          </ul>
        </aside>
      ) : null}

      {missing.length > 0 ? (
        <section className="missing" role="alert" aria-label={BEAUTIFY_LABELS.missing}>
          <h2>{BEAUTIFY_LABELS.missing}</h2>
          <ul>
            {missing.map((item) => (
              <li key={`${item.kind}:${item.text}`}>
                <span className="missing__kind">{item.kind}</span> {item.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
