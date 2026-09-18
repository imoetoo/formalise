/**
 * ACCEPTANCE HARNESS (PLAN.md §4). Two layers:
 *
 * 1. Shape checks on `test/fixtures/acceptance.json`, always run: the fixture is the contract.
 * 2. Live run of the Formalise example through the real engine, only when `ANTHROPIC_API_KEY`
 *    is set; skipped (not failed) otherwise so CI stays green without a secret. The live result
 *    is judged by substance survival and register, never by exact string equality: the
 *    heuristic substance check must report nothing missing, a few deterministic register
 *    checks must hold, and a model judge scores a short rubric.
 *
 * The Beautify live case belongs to phase 05, which owns that prompt.
 */
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, type Direction } from '../src/shared/types';
import {
  API_KEY_ENV,
  DEFAULT_MODEL,
  createClient,
  requireApiKey,
  rewrite,
  type RewriteOutcome,
} from '../src/main/claude';
import type { SubstanceKind } from '../src/main/substanceCheck';
import fixtures from './fixtures/acceptance.json';

const SUBSTANCE_KINDS: readonly SubstanceKind[] = [
  'ask',
  'deadline',
  'constraint',
  'number',
  'position',
];

interface FixtureSubstance {
  kind: SubstanceKind;
  /** The item as it appears in the input. */
  text: string;
  /** Literal fragments the owner's reference output contains (case-insensitive). */
  evidence: string[];
}

interface AcceptanceCase {
  id: string;
  direction: Direction;
  input: string;
  expected: string;
  substance: FixtureSubstance[];
  notes?: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isSubstance(value: unknown): value is FixtureSubstance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const s = value as Record<string, unknown>;
  return (
    typeof s.kind === 'string' &&
    (SUBSTANCE_KINDS as readonly string[]).includes(s.kind) &&
    typeof s.text === 'string' &&
    isStringArray(s.evidence) &&
    s.evidence.length > 0
  );
}

function isAcceptanceCase(value: unknown): value is AcceptanceCase {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.direction === 'string' &&
    (DIRECTIONS as readonly string[]).includes(c.direction) &&
    typeof c.input === 'string' &&
    typeof c.expected === 'string' &&
    Array.isArray(c.substance) &&
    c.substance.every(isSubstance) &&
    (c.notes === undefined || typeof c.notes === 'string')
  );
}

/** Narrow the JSON at runtime so a malformed fixture fails here, naming the offending entry. */
function loadCases(raw: unknown): AcceptanceCase[] {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { cases?: unknown }).cases)
  ) {
    throw new Error('acceptance.json: expected { cases: [...] }');
  }
  const entries = (raw as { cases: unknown[] }).cases;
  return entries.map((entry, index) => {
    if (!isAcceptanceCase(entry)) {
      throw new Error(
        `acceptance.json: case ${String(index)} is malformed: ${JSON.stringify(entry)}`,
      );
    }
    return entry;
  });
}

const cases = loadCases(fixtures);

describe('acceptance fixtures (PLAN.md §4)', () => {
  it('holds exactly the two owner-supplied examples, one per direction', () => {
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.direction).sort()).toEqual([...DIRECTIONS].sort());
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it.each(cases)('$id is well formed', (c) => {
    expect(c.input.trim()).not.toBe('');
    expect(c.expected.trim()).not.toBe('');
    expect(c.substance.length).toBeGreaterThan(0);
  });

  it.each(cases)('$id: the reference output carries every substance item', (c) => {
    for (const item of c.substance) {
      for (const fragment of item.evidence) {
        expect(c.expected.toLowerCase()).toContain(fragment.toLowerCase());
      }
    }
  });

  it('beautify keeps the deadline: "tomorrow" is listed and survives (PLAN.md §4 point 3)', () => {
    const beautify = cases.find((c) => c.direction === 'beautify');
    const deadline = beautify?.substance.find((s) => s.kind === 'deadline');
    expect(deadline?.evidence).toContain('tomorrow');
  });

  it('keeps the Singlish input verbatim rather than tidied English', () => {
    const formalise = cases.find((c) => c.direction === 'formalise');
    expect(formalise?.input).toBe('wakao! where got enough time sia');
    const beautify = cases.find((c) => c.direction === 'beautify');
    expect(beautify?.input).toBe('i dont care you need to get this done by tomorrow');
  });
});

// ---------------------------------------------------------------------------------------------
// Live engine run, gated on the key
// ---------------------------------------------------------------------------------------------

const LIVE = (process.env[API_KEY_ENV] ?? '').trim() !== '';
const LIVE_TIMEOUT_MS = 180_000;

/** Singlish particles and expletives that must not survive Formalise. */
const NOT_PROFESSIONAL =
  /\b(wakao|walao|walau|alamak|sia|lah|lor|leh|meh|hor|siao|jialat|wtf|knn|ccb)\b/i;

interface JudgeVerdict {
  substance_survives: boolean;
  register_professional: boolean;
  no_new_facts: boolean;
  notes: string;
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['substance_survives', 'register_professional', 'no_new_facts', 'notes'],
  properties: {
    substance_survives: {
      type: 'boolean',
      description: 'Every listed substance item is still expressed in the output.',
    },
    register_professional: {
      type: 'boolean',
      description:
        'Output is polished, professional English suitable to send to a manager: no swearing, no Singlish particles, polite and clear.',
    },
    no_new_facts: {
      type: 'boolean',
      description:
        'Output invents no specific facts, commitments, dates or numbers. Generic framing, greetings and a generic reason are allowed.',
    },
    notes: { type: 'string', description: 'One or two sentences explaining any false verdict.' },
  },
} as const;

async function judge(c: AcceptanceCase, outcome: RewriteOutcome): Promise<JudgeVerdict> {
  const client = createClient(requireApiKey());
  const rubric = c.substance.map((s) => `- ${s.kind}: "${s.text}"`).join('\n');
  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system:
      'You are a strict reviewer of message rewrites. You compare an input, its rewrite and a list of substance items, and answer a rubric as JSON. Judge meaning, not wording: an item survives if the rewrite still expresses it, however rephrased.',
    messages: [
      {
        role: 'user',
        content:
          `Direction: ${c.direction}.\n\nInput:\n<input>\n${c.input}\n</input>\n\n` +
          `Rewrite:\n<rewrite>\n${outcome.output}\n</rewrite>\n\n` +
          `Reference output (a target for voice, not a required match):\n<reference>\n${c.expected}\n</reference>\n\n` +
          `Substance that must survive:\n${rubric}\n\nAnswer the rubric.`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
  });
  const text = message.content
    .filter((b): b is { type: 'text'; text: string; citations: null } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return JSON.parse(text) as JudgeVerdict;
}

describe.skipIf(!LIVE)('acceptance (live engine, needs ANTHROPIC_API_KEY)', () => {
  const formalise = cases.find((c) => c.direction === 'formalise');
  if (formalise === undefined) {
    throw new Error('acceptance.json has no formalise case');
  }

  it(
    `${formalise.id}: rewrite() keeps the substance, reads as professional English and reports its additions`,
    async () => {
      const outcome = await rewrite(formalise.input, 'formalise');
      const context = `\n--- input ---\n${formalise.input}\n--- output ---\n${outcome.output}\n--- additions ---\n${JSON.stringify(outcome.additionDetails, null, 2)}\n--- substance ---\n${JSON.stringify(outcome.substance, null, 2)}\n`;

      // Deterministic layer.
      expect(outcome.output.trim(), context).not.toBe('');
      expect(outcome.output.trim().toLowerCase(), context).not.toBe(formalise.input.toLowerCase());
      expect(outcome.output, context).not.toMatch(NOT_PROFESSIONAL);
      expect(outcome.substance.missing, context).toEqual([]);
      // The §4 example adds a greeting and an explicit ask; a faithful rewrite reports them.
      expect(outcome.additions.length, context).toBeGreaterThan(0);
      for (const addition of outcome.additions) {
        expect(outcome.output.toLowerCase(), context).toContain(addition.toLowerCase());
      }

      // Model judge on the rubric.
      const verdict = await judge(formalise, outcome);
      const why = `${context}--- judge ---\n${JSON.stringify(verdict, null, 2)}\n`;
      expect(verdict.substance_survives, why).toBe(true);
      expect(verdict.register_professional, why).toBe(true);
      expect(verdict.no_new_facts, why).toBe(true);
    },
    LIVE_TIMEOUT_MS,
  );

  // Phase 05 owns the Beautify prompt; its live case lands there.
  it.todo('beautify: rewrite() output carries "tomorrow" and reports added encouragement');
});
