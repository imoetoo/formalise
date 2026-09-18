import { describe, expect, it } from 'vitest';
import {
  containsPhrase,
  extractSubstance,
  normalise,
  substanceCheck,
  type SubstanceItem,
} from './substanceCheck';

const kinds = (items: readonly SubstanceItem[]): string[] => items.map((i) => i.kind);
const texts = (items: readonly SubstanceItem[]): string[] => items.map((i) => i.text);

describe('normalise', () => {
  it('lower-cases, drops punctuation, joins clock times and turns number words into digits', () => {
    expect(normalise('Wakao! Where GOT enough time, sia?')).toBe('wakao where got enough time sia');
    expect(normalise('by 3 pm, two days, $1,500')).toBe('by 3pm 2 days $1500');
    expect(normalise("don't / doesn't")).toBe('dont doesnt');
  });

  it('containsPhrase matches whole words only', () => {
    expect(containsPhrase(normalise('do this by tomorrow'), 'tomorrow')).toBe(true);
    expect(containsPhrase(normalise('the sun is out'), 'sun')).toBe(true);
    expect(containsPhrase(normalise('sunday is fine'), 'sun')).toBe(false);
    expect(containsPhrase(normalise('anything'), '')).toBe(false);
  });
});

describe('extractSubstance', () => {
  it('finds the deadline "tomorrow" in the §4 Beautify input', () => {
    const items = extractSubstance('i dont care you need to get this done by tomorrow');
    expect(items).toContainEqual({ kind: 'deadline', text: 'by tomorrow' });
    expect(items).toContainEqual({ kind: 'ask', text: 'you need to get this done' });
    // Emotional temperature is not substance (PLAN.md §5 D2).
    expect(texts(items).some((t) => t.includes('dont care'))).toBe(false);
  });

  it('finds the position in the §4 Formalise input and ignores the interjections', () => {
    const items = extractSubstance('wakao! where got enough time sia');
    expect(items).toEqual([{ kind: 'position', text: 'where got enough time' }]);
  });

  it('extracts an objection, a scope statement and a deadline from the PLAN.md §2 sentence', () => {
    const items = extractSubstance('This deadline is impossible, the scope doubled');
    expect(kinds(items)).toEqual(['position', 'position']);
    expect(texts(items)).toEqual(['this deadline is impossible', 'scope doubled']);
  });

  it('extracts numbers with their unit and skips numbers already inside a deadline', () => {
    expect(extractSubstance('I need 2 days, budget is $500, 50% done')).toEqual([
      { kind: 'ask', text: 'i need 2 days' },
      { kind: 'number', text: '2 days' },
      { kind: 'number', text: '$500' },
      { kind: 'number', text: '50%' },
    ]);
    const dated = extractSubstance('submit by 18 Sep latest');
    expect(dated).toContainEqual({ kind: 'deadline', text: '18 sep' });
    expect(kinds(dated)).not.toContain('number');
  });

  it('reads Singlish and abbreviations: tmr, eod, fri only after a preposition', () => {
    expect(extractSubstance('can send me by tmr eod?')).toEqual([
      { kind: 'ask', text: 'can send me' },
      { kind: 'deadline', text: 'by tmr' },
      { kind: 'deadline', text: 'eod' },
    ]);
    expect(extractSubstance('we sat around')).toEqual([]);
    expect(extractSubstance('do it by fri')).toContainEqual({ kind: 'deadline', text: 'by fri' });
  });

  it('extracts constraints: ceilings, floors and absences', () => {
    expect(extractSubstance('only 2 people, at least 3 days, no extra budget')).toEqual([
      { kind: 'constraint', text: 'only 2 people' },
      { kind: 'constraint', text: 'at least 3 days' },
      { kind: 'constraint', text: 'no extra budget' },
    ]);
  });

  it('returns nothing for text with no substance', () => {
    expect(extractSubstance('ok thanks')).toEqual([]);
    expect(extractSubstance('')).toEqual([]);
  });
});

describe('substanceCheck (heuristic layer)', () => {
  it('flags a missing deadline: "fix it by Friday" -> output without Friday', () => {
    const report = substanceCheck(
      'This is unacceptable, fix it by Friday or we escalate',
      'Could you please look into this at your convenience?',
    );
    expect(report.ok).toBe(false);
    expect(report.missing).toContainEqual({ kind: 'deadline', text: 'by friday' });
    expect(report.missing).toContainEqual({ kind: 'position', text: 'unacceptable' });
    expect(report.missing).toContainEqual({ kind: 'position', text: 'or we escalate' });
  });

  it('accepts the PLAN.md §2 Beautify example: serious, still carries Friday', () => {
    const report = substanceCheck(
      'This is unacceptable, fix it by Friday or we escalate',
      'This is a serious concern. Please fix it by Friday; otherwise I will need to escalate it.',
    );
    expect(report.ok).toBe(true);
    expect(kinds(report.found)).toEqual(['position', 'ask', 'deadline', 'position']);
  });

  it('flags a dropped objection: "This deadline is impossible, the scope doubled"', () => {
    const mush = substanceCheck(
      'This deadline is impossible, the scope doubled',
      'I look forward to discussing the timeline.',
    );
    expect(mush.ok).toBe(false);
    expect(texts(mush.missing)).toEqual(['scope doubled']);

    const faithful = substanceCheck(
      'This deadline is impossible, the scope doubled',
      'I am concerned the current deadline is not feasible, as the scope has doubled since we agreed it.',
    );
    expect(faithful.ok).toBe(true);
  });

  it('keeps ok=true when the output carries every ask, deadline, number and position', () => {
    const report = substanceCheck(
      'wakao! where got enough time sia',
      'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?',
    );
    expect(report).toEqual({
      ok: true,
      found: [{ kind: 'position', text: 'where got enough time' }],
      missing: [],
    });

    const beautify = substanceCheck(
      'i dont care you need to get this done by tomorrow',
      'I really appreciate all that you have done for me so far, perhaps just a little bit more. I understand time might be tight, but knowing how amazing you are, would you kindly do this by tomorrow?',
    );
    expect(beautify.ok).toBe(true);
    expect(beautify.found).toEqual([
      { kind: 'ask', text: 'you need to get this done' },
      { kind: 'deadline', text: 'by tomorrow' },
    ]);
  });

  it('treats numbers as substance: "2 days" must survive as 2 days, not "a couple"', () => {
    const vague = substanceCheck(
      'I need 2 days for this',
      'I would need a couple of days for this.',
    );
    expect(vague.ok).toBe(false);
    expect(vague.missing).toContainEqual({ kind: 'number', text: '2 days' });

    const words = substanceCheck('I need 2 days for this', 'I would need two days for this.');
    expect(words.ok).toBe(true);
  });

  it('accepts equivalent deadline spellings and rejects a changed day', () => {
    expect(substanceCheck('send by tmr', 'Could you send it by tomorrow?').ok).toBe(true);
    expect(substanceCheck('send by tomorrow', 'Could you send it by Friday?').ok).toBe(false);
    expect(substanceCheck('need it eod', 'I need it by end of day.').ok).toBe(true);
  });

  it('flags an ask whose verb was lost', () => {
    const report = substanceCheck(
      'please fix the login bug',
      'I wanted to bring the login bug to your attention.',
    );
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([{ kind: 'ask', text: 'please fix the login bug' }]);
  });
});

describe('substanceCheck (model-reported layer)', () => {
  const input = 'wakao! where got enough time sia';
  const output = 'Hi boss, would you kindly allow me to take a while longer for this issue?';

  it('honours a reported item only when its carrying phrase really occurs in the output', () => {
    const report = substanceCheck(input, output, [
      { kind: 'ask', text: 'more time (implied)', carriedBy: 'a while longer' },
    ]);
    expect(report.ok).toBe(true);
    expect(report.found).toContainEqual({ kind: 'ask', text: 'more time (implied)' });
  });

  it('flags a reported item the model says it dropped, or claims to carry with a phrase that is not there', () => {
    const dropped = substanceCheck(input, output, [
      { kind: 'ask', text: 'more time', carriedBy: '' },
    ]);
    expect(dropped.missing).toEqual([{ kind: 'ask', text: 'more time' }]);

    const lying = substanceCheck(input, output, [
      { kind: 'ask', text: 'more time', carriedBy: 'an extension of two weeks' },
    ]);
    expect(lying.missing).toEqual([{ kind: 'ask', text: 'more time' }]);
  });

  it('ignores malformed reported items and never double-counts a heuristic item', () => {
    const report = substanceCheck(input, output, [
      { kind: 'position', text: '  ', carriedBy: 'x' },
      { kind: 'position', text: 'where got enough time', carriedBy: 'a while longer' },
    ]);
    expect(report.found).toEqual([{ kind: 'position', text: 'where got enough time' }]);
    expect(report.ok).toBe(true);
  });
});
