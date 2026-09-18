import { app, ipcMain } from 'electron';
import { createBeautifyController } from './beautify';
import { readSelectionFromClipboard } from './clipboardSelection';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { createReviewWindow, hideReview, showReview } from './window';
import { HOTKEYS, IPC, type Direction, type ReviewDecision } from '../shared/types';

// Beautify (phase 05): read the selection, show it beside the softer reading, never write back.
// Selection capture is the interim clipboard read until phase 02's abstraction lands.
const beautify = createBeautifyController({
  readSelection: readSelectionFromClipboard,
  show: showReview,
});

// Formalise, phase 01: the hotkey only logs and opens the review window with an empty result.
// Selection capture is phase 02; the rewrite itself is phase 03 (see plans/).
function onHotkey(direction: Direction): void {
  console.log(`[formalise] hotkey ${HOTKEYS[direction]} -> ${direction}`);
  if (direction === 'beautify') {
    void beautify.trigger();
    return;
  }
  beautify.deactivate();
  showReview({
    direction,
    original: '',
    result: '',
    additions: [],
    error: 'Selection capture and the Claude client are not wired yet (phase 01 scaffold).',
  });
}

function onDecision(decision: ReviewDecision): void {
  console.log(`[formalise] review decision: ${decision}`);
  if (beautify.isActive()) {
    // Beautify has no accept: Esc closes, R retries, and anything else just closes. Nothing is
    // written back to the selection or the clipboard (PLAN.md §3).
    if (decision === 'retry') {
      void beautify.retry();
      return;
    }
    beautify.deactivate();
    hideReview();
    return;
  }
  // Phase 04 wires accept (replace selection) and retry (re-run). Nothing is ever sent.
  hideReview();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    createReviewWindow();
    const { registered, failed } = registerHotkeys(onHotkey);
    for (const direction of registered) {
      console.log(`[formalise] registered ${HOTKEYS[direction]} for ${direction}`);
    }
    for (const direction of failed) {
      console.error(
        `[formalise] could not register ${HOTKEYS[direction]} for ${direction}; another app owns it`,
      );
    }
    ipcMain.on(IPC.reviewDecision, (_event, decision: ReviewDecision) => {
      onDecision(decision);
    });
  });

  // A hotkey utility keeps running with no window open on every platform.
  app.on('window-all-closed', () => {
    /* keep running */
  });

  app.on('will-quit', () => {
    unregisterHotkeys();
  });
}
