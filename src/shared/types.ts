/**
 * Types and IPC channel names shared by the main process, the preload bridge and the
 * renderer. Keep this file free of Electron and DOM imports so both sides can use it.
 */

/** The two directions from PLAN.md §1. */
export type Direction = 'formalise' | 'beautify';

export const DIRECTIONS: readonly Direction[] = ['formalise', 'beautify'];

/**
 * Default global hotkeys, in Electron accelerator syntax. Users override them in `settings.json`
 * under Electron's userData directory (`src/main/settings.ts`).
 *
 * Why Ctrl/Cmd+Alt+Shift: the apps this tool targets own the obvious chords. WhatsApp Web binds
 * Ctrl+Shift+F (search in chat) and Ctrl+Shift+B (block), and Outlook binds Ctrl+Alt+F (forward
 * as attachment). Ctrl+Alt+Shift+<letter> is a chord WhatsApp Web itself uses for its own
 * commands (U, H, [, ]) so it reaches the page, and F / B are unbound there, in Telegram Web and
 * in Outlook as of 2026-09-18. See plans/02-hotkey-selection.plan.md.
 */
export const HOTKEYS: Readonly<Record<Direction, string>> = {
  formalise: 'CommandOrControl+Alt+Shift+F',
  beautify: 'CommandOrControl+Alt+Shift+B',
};

/** What a piece of substance is (PLAN.md §2). */
export type SubstanceKind = 'ask' | 'deadline' | 'constraint' | 'number' | 'position';

/** One item of substance found in the input. */
export interface SubstanceItem {
  kind: SubstanceKind;
  /** The item as it appears in the input. */
  text: string;
}

/**
 * One item the substance check found in the input but not in the result. Mirrors
 * `SubstanceReport.missing` in `src/main/substanceCheck.ts` without the renderer importing
 * main-process code.
 */
export type SubstanceFlag = SubstanceItem;

/**
 * Something the model added that was not in the input. `framing` covers the allowed additions
 * (greeting, politeness, acknowledgement, making an implied ask explicit, encouragement);
 * `reasoning` is a justification or fact the input never stated, which the review step must
 * surface distinctly (PLAN.md §4).
 */
export type AdditionKind = 'framing' | 'reasoning';

export interface Addition {
  kind: AdditionKind;
  text: string;
}

/** Where the review window is in its life cycle. */
export type ReviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'accepted';

/** What the review window shows. */
export interface ReviewPayload {
  direction: Direction;
  /** The text as captured. For Beautify this is the boss's actual words and is never edited. */
  original: string;
  /** The rewrite. Empty while the engine is a stub or a request is in flight. */
  result: string;
  /**
   * Content the tool added that was not in the input (encouragement for Beautify, invented
   * reasoning for Formalise). Rendered separately and attributed to the tool, PLAN.md §3/§4.
   */
  additions: readonly string[];
  /**
   * Substance the check could not find in the result (PLAN.md §2), for the window to flag.
   * Absent or empty when nothing went missing or no check ran.
   */
  missing?: readonly SubstanceFlag[];
  /** Human-readable reason when there is no result (no key, no network, API error). */
  error?: string;
  /** Life-cycle state; absent means `ready` when `result` is non-empty, else `error`. */
  status?: ReviewStatus;
  /**
   * The subset of `additions` that is reasoning or justification the input never stated
   * (PLAN.md §4, "Careful"). Shown with a stronger warning than framing.
   */
  reasoning?: readonly string[];
  /** True when a previous rewrite can be undone (Formalise only). */
  canUndo?: boolean;
  /** A short instruction after an action, e.g. how to paste the accepted text. */
  notice?: string;
  /** The hotkeys in force, for the idle screen. Absent means the defaults in `HOTKEYS`. */
  hotkeys?: Readonly<Record<Direction, string>>;
}

/** Renderer -> main decisions. `undo` restores the previous text to the write path. */
export type ReviewDecision = 'accept' | 'cancel' | 'retry' | 'undo';

/** IPC channel names. */
export const IPC = {
  /** main -> renderer: show this payload. */
  reviewShow: 'review:show',
  /** renderer -> main: the user pressed Enter / Esc / R / U. */
  reviewDecision: 'review:decision',
} as const;
