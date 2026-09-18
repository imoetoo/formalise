/**
 * The Beautify flow in the main process (PLAN.md §3, plans/05-beautify.plan.md).
 *
 * Hotkey -> read the selection -> show the original at once -> rewrite -> substance-check ->
 * show original, softer reading, additions and any missing substance side by side. Retry re-runs
 * with the same captured original. Nothing here can write back: the dependencies this module
 * accepts are read-only (`readSelection`) or display-only (`show`), and the returned payload is
 * for the review window only.
 */
import { rewrite as defaultRewrite, type RewriteOutcome } from './claude';
import { substanceCheck as defaultSubstanceCheck, type SubstanceReport } from './substanceCheck';
import type { ReviewPayload } from '../shared/types';

export interface BeautifyDeps {
  /** Resolves with the text the user selected. Never asked to write. */
  readSelection: () => Promise<string>;
  /** Shows a payload in the review window. */
  show: (payload: ReviewPayload) => void;
  rewrite?: (text: string, direction: 'beautify') => Promise<RewriteOutcome>;
  substanceCheck?: (input: string, output: string) => SubstanceReport;
}

export const NOTHING_SELECTED =
  'Nothing to beautify: no text was selected or copied. Select the message and press the hotkey again.';

export interface BeautifyController {
  /** Hotkey pressed: capture the selection and beautify it. Resolves with the final payload. */
  trigger: () => Promise<ReviewPayload>;
  /** R pressed: beautify the same captured original again. Resolves null if there is none. */
  retry: () => Promise<ReviewPayload | null>;
  /** True when the review window is showing (or fetching) a Beautify payload. */
  isActive: () => boolean;
  /** The window moved on (closed, or another direction's hotkey fired). */
  deactivate: () => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Beautify `original` once: show it immediately with the result pending, then show the result
 * (or the reason there is none). The original is in every payload, untouched.
 */
export async function beautifyOnce(original: string, deps: BeautifyDeps): Promise<ReviewPayload> {
  const rewrite = deps.rewrite ?? defaultRewrite;
  const check = deps.substanceCheck ?? defaultSubstanceCheck;

  if (original.trim() === '') {
    const empty: ReviewPayload = {
      direction: 'beautify',
      original,
      result: '',
      additions: [],
      error: NOTHING_SELECTED,
    };
    deps.show(empty);
    return empty;
  }

  deps.show({ direction: 'beautify', original, result: '', additions: [] });

  let outcome: RewriteOutcome;
  try {
    outcome = await rewrite(original, 'beautify');
  } catch (error) {
    const failed: ReviewPayload = {
      direction: 'beautify',
      original,
      result: '',
      additions: [],
      error: describeError(error),
    };
    deps.show(failed);
    return failed;
  }

  const report = check(original, outcome.output);
  const done: ReviewPayload = {
    direction: 'beautify',
    original,
    result: outcome.output,
    additions: outcome.additions,
    missing: report.missing.map((item) => ({ kind: item.kind, text: item.text })),
  };
  deps.show(done);
  return done;
}

/** Stateful wrapper that remembers the last captured original so R can retry it. */
export function createBeautifyController(deps: BeautifyDeps): BeautifyController {
  let original: string | null = null;
  let active = false;

  return {
    async trigger() {
      active = true;
      try {
        original = await deps.readSelection();
      } catch (error) {
        original = null;
        const failed: ReviewPayload = {
          direction: 'beautify',
          original: '',
          result: '',
          additions: [],
          error: `Could not read the selected text: ${describeError(error)}. Nothing was sent.`,
        };
        deps.show(failed);
        return failed;
      }
      return beautifyOnce(original, deps);
    },
    async retry() {
      if (!active || original === null) {
        return null;
      }
      return beautifyOnce(original, deps);
    },
    isActive() {
      return active;
    },
    deactivate() {
      active = false;
    },
  };
}
