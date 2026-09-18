/**
 * Splits a rewrite into the sender's words and the tool's additions so every addition can be
 * rendered as a marked span (PLAN.md §3). Pure and DOM-free: the Electron renderer and the web
 * page both depend on it, the latter through `POST /api/rewrite` in `src/web/server.ts`.
 */

export interface Segment {
  text: string;
  /** True when this span was added by the tool and is not the sender's. */
  added: boolean;
}

/**
 * Split `output` into the sender's words and the tool's additions. Additions are matched
 * verbatim, longest first so a span that contains another is marked whole, each at its first
 * occurrence that does not overlap an earlier match; an addition that is not a substring of the
 * output is simply not marked inline (it still appears in the labelled list).
 */
export function segmentOutput(output: string, additions: readonly string[]): Segment[] {
  const ranges: { start: number; end: number }[] = [];
  const longestFirst = [...additions].sort((a, b) => b.length - a.length);
  for (const addition of longestFirst) {
    if (addition === '') {
      continue;
    }
    let from = 0;
    let placed = false;
    while (!placed) {
      const start = output.indexOf(addition, from);
      if (start === -1) {
        break;
      }
      const end = start + addition.length;
      const overlaps = ranges.some((r) => start < r.end && end > r.start);
      if (overlaps) {
        from = start + 1;
      } else {
        ranges.push({ start, end });
        placed = true;
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: output.slice(cursor, range.start), added: false });
    }
    segments.push({ text: output.slice(range.start, range.end), added: true });
    cursor = range.end;
  }
  if (cursor < output.length) {
    segments.push({ text: output.slice(cursor), added: false });
  }
  return segments;
}
