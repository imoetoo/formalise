/**
 * Short rolling undo buffer (PLAN.md §1: "short rolling buffer for undo and comparing a few
 * versions. No archive."). In memory only; gone when the app quits.
 */

export interface UndoEntry {
  /** The user's text before the rewrite. */
  original: string;
  /** The rewrite that replaced it. */
  rewrite: string;
  /** Epoch milliseconds. */
  at: number;
}

export const DEFAULT_UNDO_CAPACITY = 5;

export class UndoBuffer {
  private readonly entries: UndoEntry[] = [];
  readonly capacity: number;

  constructor(capacity = DEFAULT_UNDO_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`undo capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.capacity = capacity;
  }

  /** Record an accepted rewrite. The oldest entry falls off once the buffer is full. */
  push(entry: UndoEntry): void {
    this.entries.push(entry);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  /** Remove and return the most recent entry, or undefined when there is nothing to undo. */
  undo(): UndoEntry | undefined {
    return this.entries.pop();
  }

  /** The most recent entry without removing it. */
  peek(): UndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }

  get canUndo(): boolean {
    return this.entries.length > 0;
  }

  /** Oldest first. A copy; mutating it does not affect the buffer. */
  history(): readonly UndoEntry[] {
    return [...this.entries];
  }
}
