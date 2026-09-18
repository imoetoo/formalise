/**
 * Reads the text the user selected, for Beautify. Phase 05 interim: reads the clipboard as it
 * is, on the assumption the user copied the boss's message. Phase 02 replaces this with the
 * shared selection abstraction (`src/main/selection.ts`, clipboard plus simulated copy). Kept to
 * one function so the swap is a one-line change in `src/main/index.ts`.
 *
 * Read-only by design: Beautify never writes to the clipboard or the selection (PLAN.md §3).
 */
import { clipboard } from 'electron';

export function readSelectionFromClipboard(): Promise<string> {
  return clipboard.readText();
}
