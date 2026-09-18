import type { ReviewDecision, ReviewPayload } from '../shared/types';

/** The only surface the renderer gets. Exposed as `window.formalise` by the preload script. */
export interface FormaliseBridge {
  /** Subscribe to payloads from the main process; returns an unsubscribe function. */
  onReviewShow(callback: (payload: ReviewPayload) => void): () => void;
  /** Report the user's keyboard decision. */
  decide(decision: ReviewDecision): void;
}

declare global {
  interface Window {
    /** Absent in unit tests and plain browsers; the renderer must cope. */
    formalise?: FormaliseBridge;
  }
}
