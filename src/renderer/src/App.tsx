import { useCallback, useEffect, useState } from 'react';
import type { ReviewDecision, ReviewPayload } from '../../shared/types';
import { ReviewWindow } from './ReviewWindow';

/** Shown until the main process sends the real idle payload with the configured hotkeys. */
const IDLE: ReviewPayload = {
  direction: 'formalise',
  status: 'idle',
  original: '',
  result: '',
  additions: [],
};

export function App(): React.JSX.Element {
  const [payload, setPayload] = useState<ReviewPayload>(IDLE);

  useEffect(() => {
    const bridge = window.formalise;
    if (bridge === undefined) {
      return;
    }
    return bridge.onReviewShow(setPayload);
  }, []);

  const decide = useCallback((decision: ReviewDecision) => {
    window.formalise?.decide(decision);
  }, []);

  return <ReviewWindow payload={payload} onDecide={decide} />;
}
