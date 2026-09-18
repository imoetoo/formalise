import { app, clipboard, ipcMain } from 'electron';
import { createBeautifyController } from './beautify';
import { dotEnvCandidates, loadDotEnv } from './env';
import { createFormaliseController } from './formalise';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { createClipboardSelection } from './selection';
import { loadSettings } from './settings';
import { createReviewWindow, hideReview, primeReview, showReview } from './window';
import { formatAccelerator } from '../shared/accelerator';
import { DIRECTIONS, IPC, type Direction, type ReviewDecision } from '../shared/types';

// `.env` first, before anything can read the environment. The real environment always wins over
// the file (src/main/env.ts). The engine reads the key lazily, at rewrite time.
const dotenv = loadDotEnv(
  dotEnvCandidates({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    execPath: process.execPath,
  }),
);
for (const file of dotenv.loaded) {
  console.log(`[formalise] loaded ${file} (${dotenv.applied.join(', ') || 'nothing new'})`);
}
for (const problem of dotenv.problems) {
  console.error(`[formalise] .env: ${problem}`);
}

// One selection path for both directions (src/main/selection.ts). Beautify is handed only the
// read half so it has no way to write anything back (PLAN.md §3).
const selection = createClipboardSelection(clipboard);

const beautify = createBeautifyController({
  readSelection: () => selection.readSelection(),
  show: showReview,
});

// Filled in once settings are loaded, after app.whenReady().
let formalise = createFormaliseController({ selection, show: showReview, hide: hideReview });

function onHotkey(direction: Direction): void {
  console.log(`[formalise] hotkey -> ${direction}`);
  if (direction === 'beautify') {
    formalise.deactivate();
    void beautify.trigger();
    return;
  }
  beautify.deactivate();
  void formalise.trigger();
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
  switch (decision) {
    case 'accept':
      void formalise.accept();
      return;
    case 'retry':
      void formalise.retry();
      return;
    case 'undo':
      void formalise.undo();
      return;
    case 'cancel':
      formalise.cancel();
      return;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    createReviewWindow();

    const loaded = loadSettings(app.getPath('userData'));
    if (loaded.created) {
      console.log(`[formalise] wrote default settings to ${loaded.path}`);
    }
    for (const problem of loaded.problems) {
      console.error(`[formalise] settings: ${problem}`);
    }
    const hotkeys = loaded.settings.hotkeys;
    formalise = createFormaliseController({
      selection,
      show: showReview,
      hide: hideReview,
      hotkeys,
    });

    const { registered, failed } = registerHotkeys(onHotkey, hotkeys);
    for (const direction of registered) {
      console.log(`[formalise] registered ${hotkeys[direction]} for ${direction}`);
    }
    const complaints = [
      ...failed.map(
        (direction) =>
          `Could not register ${formatAccelerator(hotkeys[direction])} for ${direction}; another application owns it.`,
      ),
      ...loaded.problems.map((problem) => `Settings: ${problem}`),
    ];
    if (complaints.length > 0) {
      for (const direction of failed) {
        console.error(`[formalise] could not register ${hotkeys[direction]} for ${direction}`);
      }
      const working = DIRECTIONS.filter((d) => registered.includes(d))
        .map((d) => `${formatAccelerator(hotkeys[d])} (${d})`)
        .join(', ');
      showReview(
        formalise.idle(
          `${complaints.join(' ')} Edit the hotkeys in ${loaded.path} and restart Formalise.` +
            (working === '' ? '' : ` Working now: ${working}.`),
        ),
      );
    } else {
      primeReview(formalise.idle());
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
