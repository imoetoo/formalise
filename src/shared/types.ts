/**
 * Types and IPC channel names shared by the main process, the preload bridge and the
 * renderer. Keep this file free of Electron and DOM imports so both sides can use it.
 */

/** The two directions from PLAN.md §1. */
export type Direction = 'formalise' | 'beautify';

export const DIRECTIONS: readonly Direction[] = ['formalise', 'beautify'];

/**
 * Global hotkeys, in Electron accelerator syntax. Windows-specific handling and conflict
 * detection are phase 02 work.
 */
export const HOTKEYS: Readonly<Record<Direction, string>> = {
  formalise: 'CommandOrControl+Shift+F',
  beautify: 'CommandOrControl+Shift+B',
};

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
  /** Human-readable reason when there is no result (no key, no network, API error). */
  error?: string;
}

/** Renderer -> main decisions. */
export type ReviewDecision = 'accept' | 'cancel' | 'retry';

/** IPC channel names. */
export const IPC = {
  /** main -> renderer: show this payload. */
  reviewShow: 'review:show',
  /** renderer -> main: the user pressed Enter / Esc / R. */
  reviewDecision: 'review:decision',
} as const;
