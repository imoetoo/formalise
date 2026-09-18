import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOTKEYS } from '../shared/types';
import { SETTINGS_FILE, coerceSettings, isValidAccelerator, loadSettings } from './settings';

const dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'formalise-settings-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('isValidAccelerator', () => {
  it('accepts modifier chords with one key', () => {
    for (const ok of [
      'CommandOrControl+Alt+Shift+F',
      'CmdOrCtrl+Alt+B',
      'Ctrl+Shift+F12',
      'Super+Space',
      'Alt+num0',
      'Control+Shift+/',
    ]) {
      expect(isValidAccelerator(ok), ok).toBe(true);
    }
  });

  it('rejects bare keys, unknown modifiers, repeated modifiers, junk and non-strings', () => {
    for (const bad of [
      'F',
      'Shift',
      'Hyper+F',
      'Ctrl+Ctrl+F',
      'Ctrl+',
      'Ctrl+FF',
      'Ctrl+F+G',
      '',
      42,
      null,
    ]) {
      expect(isValidAccelerator(bad), String(bad)).toBe(false);
    }
  });
});

describe('coerceSettings', () => {
  it('keeps valid hotkeys and reports nothing', () => {
    const { settings, problems } = coerceSettings({
      hotkeys: { formalise: 'Ctrl+Alt+P', beautify: 'Ctrl+Alt+W' },
    });
    expect(settings.hotkeys).toEqual({ formalise: 'Ctrl+Alt+P', beautify: 'Ctrl+Alt+W' });
    expect(problems).toEqual([]);
  });

  it('falls back to the default per direction and names each problem', () => {
    const { settings, problems } = coerceSettings({ hotkeys: { formalise: 'F' } });
    expect(settings.hotkeys).toEqual(HOTKEYS);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/hotkeys\.formalise.*not a valid/);
    expect(problems[1]).toMatch(/hotkeys\.beautify.*missing/);
  });

  it('refuses two directions on the same chord', () => {
    const { settings, problems } = coerceSettings({
      hotkeys: { formalise: 'Ctrl+Alt+X', beautify: 'ctrl+alt+x' },
    });
    expect(settings.hotkeys.formalise).toBe('Ctrl+Alt+X');
    expect(settings.hotkeys.beautify).toBe(HOTKEYS.beautify);
    expect(problems[0]).toMatch(/both hotkeys/);
  });

  it('handles non-objects', () => {
    expect(coerceSettings(null).problems[0]).toMatch(/not a JSON object/);
    expect(coerceSettings({}).problems[0]).toMatch(/no "hotkeys"/);
    expect(coerceSettings({ hotkeys: 'x' }).problems[0]).toMatch(/not an object/);
  });
});

describe('loadSettings', () => {
  it('writes the defaults on first run and reads them back', () => {
    const dir = join(tempDir(), 'nested');
    const first = loadSettings(dir);
    expect(first.created).toBe(true);
    expect(first.path).toBe(join(dir, SETTINGS_FILE));
    expect(first.settings.hotkeys).toEqual(HOTKEYS);
    expect(JSON.parse(readFileSync(first.path, 'utf8'))).toEqual({ hotkeys: HOTKEYS });

    const second = loadSettings(dir);
    expect(second.created).toBe(false);
    expect(second.problems).toEqual([]);
    expect(second.settings).toEqual(first.settings);
  });

  it('survives a corrupt file with defaults and a problem naming the path', () => {
    const dir = tempDir();
    writeFileSync(join(dir, SETTINGS_FILE), '{ not json');
    const loaded = loadSettings(dir);
    expect(loaded.settings.hotkeys).toEqual(HOTKEYS);
    expect(loaded.problems[0]).toContain(loaded.path);
  });

  it('applies a user override', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, SETTINGS_FILE),
      JSON.stringify({ hotkeys: { formalise: 'Ctrl+Alt+P', beautify: HOTKEYS.beautify } }),
    );
    expect(loadSettings(dir).settings.hotkeys.formalise).toBe('Ctrl+Alt+P');
  });
});
