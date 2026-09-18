/**
 * Substance check, PLAN.md §2: after a rewrite, every ask, deadline, constraint, number and
 * stated position in the input must still be present in the output. Flag what went missing
 * rather than silently shipping it. One check serves both directions.
 *
 * STUB for phase 01: signature only. Extraction and matching are phase 03
 * (plans/03-claude-client.plan.md).
 */

export type SubstanceKind = 'ask' | 'deadline' | 'constraint' | 'number' | 'position';

export interface SubstanceItem {
  kind: SubstanceKind;
  /** The item as it appears in the input. */
  text: string;
}

export interface SubstanceReport {
  /** True when nothing extracted from the input is missing from the output. */
  ok: boolean;
  /** Items found in the input. */
  found: readonly SubstanceItem[];
  /** Items found in the input that could not be located in the output. */
  missing: readonly SubstanceItem[];
}

/**
 * Compare `input` and `output` and report any substance that did not survive.
 *
 * Phase 01: extracts nothing and therefore reports `ok: true` with empty lists. Do not rely
 * on this result until phase 03 lands; the acceptance harness will fail loudly then.
 */
export function substanceCheck(_input: string, _output: string): SubstanceReport {
  return { ok: true, found: [], missing: [] };
}
