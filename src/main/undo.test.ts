import { describe, expect, it } from 'vitest';
import { DEFAULT_UNDO_CAPACITY, UndoBuffer } from './undo';

const entry = (n: number) => ({ original: `orig ${String(n)}`, rewrite: `rw ${String(n)}`, at: n });

describe('UndoBuffer', () => {
  it('starts empty and undo() returns undefined', () => {
    const buffer = new UndoBuffer();
    expect(buffer.capacity).toBe(DEFAULT_UNDO_CAPACITY);
    expect(buffer.canUndo).toBe(false);
    expect(buffer.size).toBe(0);
    expect(buffer.undo()).toBeUndefined();
    expect(buffer.peek()).toBeUndefined();
  });

  it('undoes most recent first and restores the original text', () => {
    const buffer = new UndoBuffer();
    buffer.push(entry(1));
    buffer.push(entry(2));
    expect(buffer.peek()).toEqual(entry(2));
    expect(buffer.undo()?.original).toBe('orig 2');
    expect(buffer.undo()?.original).toBe('orig 1');
    expect(buffer.canUndo).toBe(false);
  });

  it('is a rolling buffer: the oldest entry falls off at capacity', () => {
    const buffer = new UndoBuffer(3);
    for (let i = 1; i <= 5; i += 1) {
      buffer.push(entry(i));
    }
    expect(buffer.size).toBe(3);
    expect(buffer.history().map((e) => e.at)).toEqual([3, 4, 5]);
  });

  it('history() is a copy', () => {
    const buffer = new UndoBuffer();
    buffer.push(entry(1));
    const h = [...buffer.history()];
    h.pop();
    expect(buffer.size).toBe(1);
  });

  it('rejects a nonsense capacity', () => {
    expect(() => new UndoBuffer(0)).toThrow(RangeError);
    expect(() => new UndoBuffer(1.5)).toThrow(RangeError);
  });
});
