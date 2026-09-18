import { useCallback, useEffect, useState } from 'react';
import type { ReviewDecision, ReviewPayload } from '../../shared/types';
import { ReviewWindow } from './ReviewWindow';

const IDLE: ReviewPayload = {
  direction: 'formalise',
  original: '',
  result: '',
  additions: [],
  error: 'Waiting for a hotkey. Ctrl/Cmd+Shift+F formalises, Ctrl/Cmd+Shift+B beautifies.',
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
