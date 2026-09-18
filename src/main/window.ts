import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { IPC, type ReviewPayload } from '../shared/types';

let reviewWindow: BrowserWindow | null = null;

/**
 * The single review window. Created hidden at startup and shown on a hotkey; closing it hides
 * it again so the hotkeys keep working. It is destroyed only when the app quits.
 */
export function createReviewWindow(): BrowserWindow {
  if (reviewWindow !== null) {
    return reviewWindow;
  }
  const win = new BrowserWindow({
    width: 960,
    height: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'Formalise',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    reviewWindow = null;
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev; production loads the built file.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl !== undefined) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  reviewWindow = win;
  return win;
}

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

/** Send `payload` to the renderer once it is able to receive it. */
function send(win: BrowserWindow, payload: ReviewPayload): void {
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.reviewShow, payload);
    });
    return;
  }
  win.webContents.send(IPC.reviewShow, payload);
}

/** Show the review window with `payload`. */
export function showReview(payload: ReviewPayload): void {
  const win = createReviewWindow();
  send(win, payload);
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}

/** Update what the window shows without bringing it up (the idle screen, for instance). */
export function primeReview(payload: ReviewPayload): void {
  send(createReviewWindow(), payload);
}

export function hideReview(): void {
  reviewWindow?.hide();
}
