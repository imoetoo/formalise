/**
 * User settings: a small JSON file in Electron's userData directory. Today it holds only the two
 * hotkeys. Defaults are written on first run so the user can find and edit the file; invalid
 * entries fall back to the default and are reported, never silently dropped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIRECTIONS, HOTKEYS, type Direction } from '../shared/types';

export const SETTINGS_FILE = 'settings.json';

export interface Settings {
  hotkeys: Record<Direction, string>;
}

export interface LoadedSettings {
  settings: Settings;
  /** Absolute path of the file, for error messages that tell the user where to look. */
  path: string;
  /** Human-readable problems found while loading; empty when the file was clean or new. */
  problems: string[];
  /** True when the file did not exist and the defaults were written. */
  created: boolean;
}

export function defaultSettings(): Settings {
  return { hotkeys: { ...HOTKEYS } };
}

const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta',
]);

const NAMED_KEYS = new Set([
  'plus',
  'space',
  'tab',
  'capslock',
  'numlock',
  'scrolllock',
  'backspace',
  'delete',
  'insert',
  'return',
  'enter',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'escape',
  'esc',
  'volumeup',
  'volumedown',
  'volumemute',
  'medianexttrack',
  'mediaprevioustrack',
  'mediastop',
  'mediaplaypause',
  'printscreen',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
]);

/**
 * True when `value` is an Electron accelerator we are willing to register globally: one or more
 * modifiers joined by `+` and exactly one key code. A bare key is rejected because a global
 * shortcut on it would swallow ordinary typing in every application.
 */
export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  const parts = value.split('+');
  if (parts.length < 2) {
    return false;
  }
  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1).map((p) => p.toLowerCase());
  if (modifiers.some((m) => !MODIFIERS.has(m))) {
    return false;
  }
  if (new Set(modifiers).size !== modifiers.length) {
    return false;
  }
  const k = key.toLowerCase();
  return (
    /^[a-z0-9]$/.test(k) ||
    /^f([1-9]|1\d|2[0-4])$/.test(k) ||
    /^num[0-9]$/.test(k) ||
    NAMED_KEYS.has(k) ||
    /^[~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`]$/.test(key)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate parsed JSON into settings, listing every problem and substituting defaults. */
export function coerceSettings(raw: unknown): { settings: Settings; problems: string[] } {
  const settings = defaultSettings();
  const problems: string[] = [];
  if (!isRecord(raw)) {
    problems.push('settings.json is not a JSON object; using defaults.');
    return { settings, problems };
  }
  const hotkeys = raw.hotkeys;
  if (hotkeys === undefined) {
    problems.push('settings.json has no "hotkeys"; using defaults.');
    return { settings, problems };
  }
  if (!isRecord(hotkeys)) {
    problems.push('"hotkeys" is not an object; using defaults.');
    return { settings, problems };
  }
  for (const direction of DIRECTIONS) {
    const value = hotkeys[direction];
    if (value === undefined) {
      problems.push(`"hotkeys.${direction}" is missing; using ${HOTKEYS[direction]}.`);
    } else if (!isValidAccelerator(value)) {
      problems.push(
        `"hotkeys.${direction}" (${JSON.stringify(value)}) is not a valid Electron accelerator ` +
          `with at least one modifier; using ${HOTKEYS[direction]}.`,
      );
    } else {
      settings.hotkeys[direction] = value;
    }
  }
  if (settings.hotkeys.formalise.toLowerCase() === settings.hotkeys.beautify.toLowerCase()) {
    problems.push(
      `both hotkeys are ${settings.hotkeys.formalise}; using the default for beautify (${HOTKEYS.beautify}).`,
    );
    settings.hotkeys.beautify = HOTKEYS.beautify;
  }
  return { settings, problems };
}

/**
 * Load settings from `<userDataDir>/settings.json`, writing the defaults when the file does not
 * exist. Never throws for a bad file: the problems are returned for the UI to show.
 */
export function loadSettings(userDataDir: string): LoadedSettings {
  const path = join(userDataDir, SETTINGS_FILE);
  if (!existsSync(path)) {
    const settings = defaultSettings();
    try {
      mkdirSync(userDataDir, { recursive: true });
      writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      return { settings, path, problems: [], created: true };
    } catch (error) {
      return {
        settings,
        path,
        problems: [
          `could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
        ],
        created: false,
      };
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      settings: defaultSettings(),
      path,
      problems: [
        `${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); using defaults.`,
      ],
      created: false,
    };
  }
  const { settings, problems } = coerceSettings(raw);
  return { settings, path, problems, created: false };
}
