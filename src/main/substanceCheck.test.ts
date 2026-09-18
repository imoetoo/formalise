import { describe, expect, it } from 'vitest';
import { substanceCheck } from './substanceCheck';

describe('substanceCheck (stub, phase 01)', () => {
  it('has the agreed signature and report shape', () => {
    const report = substanceCheck('i dont care you need to get this done by tomorrow', '');
    expect(report).toEqual({ ok: true, found: [], missing: [] });
  });

  // Placeholders for phase 03 (plans/03-claude-client.plan.md). Each becomes a real assertion
  // when extraction lands; the PLAN.md §2 sentences are the intended inputs.
  it.todo('finds the deadline "tomorrow" in the §4 Beautify input');
  it.todo('flags a missing deadline: "fix it by Friday" -> output without Friday');
  it.todo('flags a dropped objection: "This deadline is impossible, the scope doubled"');
  it.todo('keeps ok=true when the output carries every ask, deadline, number and position');
  it.todo('treats numbers as substance: "2 days" must survive as 2 days, not "a couple"');
});
