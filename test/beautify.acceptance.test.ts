/**
 * LIVE acceptance for the PLAN.md §4 Beautify example (plans/05-beautify.plan.md, T7).
 *
 * Runs the fixture through the real `rewrite()` and `substanceCheck()`. Needs ANTHROPIC_API_KEY;
 * without it the whole file is skipped, never failed. While the engine is still the phase 01
 * stub (NotImplementedError) each test skips itself and says so. The judgement is a rubric, not
 * exact equality: the owner's `expected` text is a target for register, not a required string.
 */
import { describe, expect, it } from 'vitest';
import { API_KEY_ENV, NotImplementedError, rewrite, type RewriteOutcome } from '../src/main/claude';
import { substanceCheck } from '../src/main/substanceCheck';
import fixtures from './fixtures/acceptance.json';

const hasKey = (process.env[API_KEY_ENV] ?? '').trim() !== '';

const found = fixtures.cases.find((c) => c.direction === 'beautify');
if (found === undefined) {
  throw new Error('acceptance.json has no beautify case');
}
const fixture: NonNullable<typeof found> = found;

/** Words that make the register warm and deferential; at least two must appear. */
const WARM_MARKERS = [
  'appreciate',
  'thank',
  'grateful',
  'kindly',
  'please',
  'would you',
  'could you',
  'understand',
  'know',
  'if possible',
  'when you can',
];

/** Fragments of the input's dismissiveness that must not survive verbatim. */
const HARSH_MARKERS = ["don't care", 'dont care', 'i do not care'];

let cached: Promise<RewriteOutcome> | null = null;
function outcome(): Promise<RewriteOutcome> {
  cached ??= rewrite(fixture.input, 'beautify');
  return cached;
}

describe.skipIf(!hasKey)('beautify live acceptance (PLAN.md §4)', () => {
  async function run(ctx: { skip: (note?: string) => void }): Promise<RewriteOutcome | null> {
    try {
      return await outcome();
    } catch (error) {
      if (error instanceof NotImplementedError) {
        ctx.skip('engine is still the phase 01 stub; see plans/03-claude-client.plan.md');
        return null;
      }
      throw error;
    }
  }

  it('keeps the deadline: "tomorrow" survives (§4 point 3)', async (ctx) => {
    const result = await run(ctx);
    if (result === null) return;
    for (const item of fixture.substance) {
      for (const fragment of item.evidence) {
        if (item.kind === 'deadline') {
          expect(result.output.toLowerCase()).toContain(fragment.toLowerCase());
        }
      }
    }
    const report = substanceCheck(fixture.input, result.output);
    expect(report.missing).toEqual([]);
  });

  it('still asks for the thing to be done', async (ctx) => {
    const result = await run(ctx);
    if (result === null) return;
    expect(result.output.toLowerCase()).toMatch(/\b(do|done|finish|complete|get)\b/);
    expect(result.output).toMatch(/\?|please|kindly/i);
  });

  it('reads warm and deferential, not dismissive (rubric, never exact match)', async (ctx) => {
    const result = await run(ctx);
    if (result === null) return;
    const lower = result.output.toLowerCase();
    const warm = WARM_MARKERS.filter((m) => lower.includes(m));
    expect(
      warm.length,
      `warm markers found: ${JSON.stringify(warm)} in ${result.output}`,
    ).toBeGreaterThanOrEqual(2);
    for (const harsh of HARSH_MARKERS) {
      expect(lower).not.toContain(harsh);
    }
    expect(result.output).not.toBe(fixture.expected); // a rubric target, not a string to parrot
    expect(result.output.length).toBeLessThan(fixture.input.length * 6);
  });

  it("reports what it added as verbatim spans, so the UI can mark them as the tool's", async (ctx) => {
    const result = await run(ctx);
    if (result === null) return;
    expect(Array.isArray(result.additions)).toBe(true);
    for (const addition of result.additions) {
      expect(addition.trim()).not.toBe('');
      expect(result.output).toContain(addition);
      expect(fixture.input.toLowerCase()).not.toContain(addition.toLowerCase());
    }
  });

  it('adds no new date, number or commitment', async (ctx) => {
    const result = await run(ctx);
    if (result === null) return;
    const lower = result.output.toLowerCase();
    expect(lower).not.toMatch(
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d+\s*(am|pm|days?|hours?|weeks?))\b/,
    );
    expect(lower).not.toMatch(/\b(i promise|i will make sure|i guarantee)\b/);
  });
});
