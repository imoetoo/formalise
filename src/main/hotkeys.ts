import { globalShortcut } from 'electron';
import { DIRECTIONS, HOTKEYS, type Direction } from '../shared/types';

export interface HotkeyRegistration {
  registered: Direction[];
  /** Directions whose accelerator another application already owns. */
  failed: Direction[];
}

/**
 * Register the two global shortcuts. Must be called after `app.whenReady()`.
 *
 * `accelerators` are the user's configured hotkeys (`src/main/settings.ts`); the defaults are
 * `HOTKEYS`. A failed direction is returned, never swallowed, so the caller can show it.
 */
export function registerHotkeys(
  onTrigger: (direction: Direction) => void,
  accelerators: Readonly<Record<Direction, string>> = HOTKEYS,
): HotkeyRegistration {
  const result: HotkeyRegistration = { registered: [], failed: [] };
  for (const direction of DIRECTIONS) {
    const accelerator = accelerators[direction];
    const ok = globalShortcut.register(accelerator, () => {
      onTrigger(direction);
    });
    if (ok && globalShortcut.isRegistered(accelerator)) {
      result.registered.push(direction);
    } else {
      result.failed.push(direction);
    }
  }
  return result;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
