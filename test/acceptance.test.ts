/**
 * ACCEPTANCE HARNESS, phase 01: shape only.
 *
 * Loads the PLAN.md §4 examples from test/fixtures/acceptance.json and checks that the fixture
 * is well formed and self-consistent. It does NOT call the engine yet: `rewrite()` is a stub.
 * Phase 03 (plans/03-claude-client.plan.md) wires each case through `rewrite()` and
 * `substanceCheck()` and asserts that every `substance` item survives and that additions are
 * reported. Until then this file is the contract the engine will be held to.
 */
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, type Direction } from '../src/shared/types';
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
  /** Literal fragments any acceptable output must contain (case-insensitive). */
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

  // Phase 03 replaces these with real runs through rewrite() + substanceCheck().
  it.todo('formalise: rewrite() output carries every substance item and reports added reasoning');
  it.todo('beautify: rewrite() output carries "tomorrow" and reports added encouragement');
});
