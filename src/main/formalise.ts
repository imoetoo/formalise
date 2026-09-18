/**
 * The Formalise flow in the main process (PLAN.md §1, §3, §6; plans/04-review-window.plan.md).
 *
 * Hotkey -> read the selection -> show it at once with the result pending -> rewrite -> show the
 * professional version with substance flags and additions -> Enter writes it to the selection
 * path and records an undo entry, Esc leaves everything untouched, R re-runs the same original,
 * U puts the previous original back on the write path. Every engine error leaves the text
 * untouched and says why.
 */
import { describeRewriteError, rewrite as defaultRewrite, type RewriteOutcome } from './claude';
import { NOTHING_CAPTURED, type SelectionAdapter } from './selection';
import { UndoBuffer } from './undo';
import { HOTKEYS, type Direction, type ReviewPayload } from '../shared/types';

export interface FormaliseDeps {
  selection: SelectionAdapter;
  /** Shows a payload in the review window. */
  show: (payload: ReviewPayload) => void;
  /** Hides the review window. */
  hide: () => void;
  rewrite?: (text: string, direction: 'formalise') => Promise<RewriteOutcome>;
  undo?: UndoBuffer;
  /** The hotkeys in force, for the idle screen. */
  hotkeys?: Readonly<Record<Direction, string>>;
  now?: () => number;
}

export interface FormaliseController {
  /** Hotkey pressed: capture the selection and formalise it. Resolves with the final payload. */
  trigger: () => Promise<ReviewPayload>;
  /** R pressed: formalise the same captured original again. Null when there is nothing to retry. */
  retry: () => Promise<ReviewPayload | null>;
  /** Enter pressed: put the result on the write path and remember the original for undo. */
  accept: () => Promise<ReviewPayload | null>;
  /** U pressed: put the previous original back on the write path. Null when nothing to undo. */
  undo: () => Promise<ReviewPayload | null>;
  /** Esc pressed: close, touching nothing. */
  cancel: () => void;
  /** The payload for the idle screen: hotkeys in force and whether undo is available. */
  idle: (error?: string) => ReviewPayload;
  /** True when the review window is showing (or fetching) a Formalise payload. */
  isActive: () => boolean;
  /** The window moved on (closed, or another direction's hotkey fired). */
  deactivate: () => void;
}

export const UNDO_HINT = 'Press U to undo the last rewrite, or Esc to close.';

export const RESTORED_INSTRUCTION =
  'Your original text is back on your clipboard. Paste (Ctrl/Cmd+V) to put it back.';

export function createFormaliseController(deps: FormaliseDeps): FormaliseController {
  const rewrite = deps.rewrite ?? defaultRewrite;
  const undo = deps.undo ?? new UndoBuffer();
  const hotkeys = deps.hotkeys ?? HOTKEYS;
  const now = deps.now ?? Date.now;

  let original: string | null = null;
  let outcome: RewriteOutcome | null = null;
  let active = false;
  /** Increments per run so a stale response never overwrites a newer one. */
  let run = 0;

  const base = (): Pick<ReviewPayload, 'direction' | 'hotkeys' | 'canUndo'> => ({
    direction: 'formalise',
    hotkeys,
    canUndo: undo.canUndo,
  });

  function idle(error?: string): ReviewPayload {
    return {
      ...base(),
      original: '',
      result: '',
      additions: [],
      status: 'idle',
      ...(error === undefined ? {} : { error }),
    };
  }

  async function formaliseOnce(text: string): Promise<ReviewPayload> {
    const thisRun = (run += 1);
    outcome = null;
    if (text.trim() === '') {
      const empty: ReviewPayload = {
        ...base(),
        original: text,
        result: '',
        additions: [],
        status: 'error',
        error: NOTHING_CAPTURED,
      };
      deps.show(empty);
      return empty;
    }

    deps.show({ ...base(), original: text, result: '', additions: [], status: 'loading' });

    let result: RewriteOutcome;
    try {
      result = await rewrite(text, 'formalise');
    } catch (error) {
      const failed: ReviewPayload = {
        ...base(),
        original: text,
        result: '',
        additions: [],
        status: 'error',
        error: describeRewriteError(error),
      };
      if (thisRun === run) {
        deps.show(failed);
      }
      return failed;
    }

    const done: ReviewPayload = {
      ...base(),
      original: text,
      result: result.output,
      additions: result.additions,
      reasoning: result.reasoning,
      missing: result.substance.missing,
      status: 'ready',
    };
    if (thisRun === run) {
      outcome = result;
      deps.show(done);
    }
    return done;
  }

  return {
    async trigger() {
      active = true;
      try {
        original = await deps.selection.readSelection();
      } catch (error) {
        original = null;
        const failed: ReviewPayload = {
          ...base(),
          original: '',
          result: '',
          additions: [],
          status: 'error',
          error: `Could not read the selected text: ${error instanceof Error ? error.message : String(error)}. Nothing was sent.`,
        };
        deps.show(failed);
        return failed;
      }
      return formaliseOnce(original);
    },

    async retry() {
      if (!active || original === null || original.trim() === '') {
        return null;
      }
      return formaliseOnce(original);
    },

    async accept() {
      if (!active || outcome === null || original === null) {
        // Nothing to accept: an empty or pending result must never replace the user's text.
        return null;
      }
      const accepted = outcome;
      const written = await deps.selection.writeSelection(accepted.output);
      undo.push({ original, rewrite: accepted.output, at: now() });
      const payload: ReviewPayload = {
        ...base(),
        original,
        result: accepted.output,
        additions: accepted.additions,
        reasoning: accepted.reasoning,
        missing: accepted.substance.missing,
        status: 'accepted',
        notice: `${written.instruction} ${UNDO_HINT}`,
      };
      outcome = null;
      deps.show(payload);
      return payload;
    },

    async undo() {
      const entry = undo.undo();
      if (entry === undefined) {
        return null;
      }
      await deps.selection.writeSelection(entry.original);
      active = true;
      original = entry.original;
      outcome = null;
      const payload: ReviewPayload = {
        ...base(),
        original: entry.original,
        result: entry.rewrite,
        additions: [],
        status: 'accepted',
        notice: `${RESTORED_INSTRUCTION}${undo.canUndo ? ` ${UNDO_HINT}` : ''}`,
      };
      deps.show(payload);
      return payload;
    },

    cancel() {
      active = false;
      outcome = null;
      deps.hide();
    },

    idle,
    isActive: () => active,
    deactivate() {
      active = false;
      outcome = null;
    },
  };
}
