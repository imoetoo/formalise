import { describe, expect, it } from 'vitest';
import { PASTE_INSTRUCTION, createClipboardSelection } from './selection';

function fakeClipboard(initial = '') {
  let value = initial;
  return {
    readText: () => Promise.resolve(value),
    writeText: (text: string) => {
      value = text;
      return Promise.resolve();
    },
    get value() {
      return value;
    },
  };
}

describe('clipboard selection adapter', () => {
  it('reads the clipboard as the selection, verbatim, and treats whitespace as nothing', async () => {
    expect(await createClipboardSelection(fakeClipboard('  wakao! sia \n')).readSelection()).toBe(
      '  wakao! sia \n',
    );
    expect(await createClipboardSelection(fakeClipboard('   \n')).readSelection()).toBe('');
    expect(await createClipboardSelection(fakeClipboard()).readSelection()).toBe('');
  });

  it('writes the result to the clipboard and tells the user to paste', async () => {
    const clipboard = fakeClipboard('old');
    const result = await createClipboardSelection(clipboard).writeSelection('Hi boss,');
    expect(clipboard.value).toBe('Hi boss,');
    expect(result).toEqual({ method: 'clipboard', instruction: PASTE_INSTRUCTION });
  });
});
