/**
 * Selection capture and replacement behind one interface, so the flows in `formalise.ts` and
 * `beautify.ts` do not care how text gets in and out of the other application.
 *
 * Current implementation: Electron's built-in `clipboard` only. The user copies their text
 * (Ctrl/Cmd+C) before pressing the hotkey, and pastes (Ctrl/Cmd+V) after accepting. Simulating
 * those keystrokes through a native module is phase 02 (plans/02-hotkey-selection.plan.md).
 * Beautify receives only `readSelection`, so it has no write path (PLAN.md §3).
 */
import type { Clipboard } from 'electron';

export interface WriteResult {
  method: 'clipboard';
  /** What to tell the user so the text actually lands in their compose box. */
  instruction: string;
}

export interface SelectionAdapter {
  /** The text to rewrite. Empty string when nothing usable was captured. */
  readSelection(): Promise<string>;
  /** Put `text` on the write path; returns how it landed and what the user must do next. */
  writeSelection(text: string): Promise<WriteResult>;
}

export const PASTE_INSTRUCTION =
  'Copied to your clipboard. Click back into your message and paste (Ctrl/Cmd+V) to replace your text.';

export const NOTHING_CAPTURED =
  'Nothing to rewrite. Select your text and copy it (Ctrl/Cmd+C), then press the hotkey again.';

/** Clipboard-backed adapter. Electron 44's clipboard is promise-based; it is injected so tests need no Electron. */
export function createClipboardSelection(
  clipboard: Pick<Clipboard, 'readText' | 'writeText'>,
): SelectionAdapter {
  return {
    async readSelection() {
      const text = await clipboard.readText();
      return text.trim() === '' ? '' : text;
    },
    async writeSelection(text) {
      await clipboard.writeText(text);
      return { method: 'clipboard', instruction: PASTE_INSTRUCTION };
    },
  };
}
