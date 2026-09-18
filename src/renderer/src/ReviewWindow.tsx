import type { ReviewDecision, ReviewPayload } from '../../shared/types';
import { BeautifyView } from './BeautifyView';
import { FormaliseReview } from './formalise/FormaliseReview';

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
    case 'u':
    case 'U':
      return 'undo';
    default:
      return null;
  }
}

/**
 * Keyboard-first review. Beautify payloads are handed to {@link BeautifyView}, which has no
 * accept action at all, so no caller can render the boss's message with a key that writes
 * anything back (PLAN.md §3). Formalise payloads go to {@link FormaliseReview}, which accepts
 * only when a result is showing.
 */
export function ReviewWindow(props: ReviewWindowProps): React.JSX.Element {
  if (props.payload.direction === 'beautify') {
    return <BeautifyView payload={props.payload} onDecide={props.onDecide} />;
  }
  return <FormaliseReview {...props} />;
}
