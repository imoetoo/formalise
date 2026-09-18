/**
 * The structured output the Formalise prompt produces. Sent to the API as a strict JSON schema
 * (`output_config.format`) and parsed defensively by {@link parseRewriteResponse}.
 */
import type { Addition, SubstanceKind } from '../../shared/types';
import type { ReportedSubstance } from '../substanceCheck';
import { extractJsonObject, isRecord, requireText } from './parse';
import type { ParsedRewrite } from './types';

export type RewriteResponse = ParsedRewrite;

export const SUBSTANCE_KINDS: readonly SubstanceKind[] = [
  'ask',
  'deadline',
  'constraint',
  'number',
  'position',
];

export const REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rewrite', 'additions', 'substance'],
  properties: {
    rewrite: {
      type: 'string',
      description: 'The rewritten message only. No preamble, no quotes, no markdown.',
    },
    additions: {
      type: 'array',
      description:
        'Every phrase in `rewrite` that expresses something the input did not say. ' +
        '`framing` = greeting, politeness, acknowledgement or making an implied ask explicit. ' +
        '`reasoning` = a justification, explanation or fact the input never stated.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: {
          kind: { type: 'string', enum: ['framing', 'reasoning'] },
          text: { type: 'string', description: 'The added phrase, verbatim from `rewrite`.' },
        },
      },
    },
    substance: {
      type: 'array',
      description:
        'Every ask, deadline, constraint, number and stated position in the input, with the ' +
        'exact phrase of `rewrite` that carries it. Use an empty `carriedBy` if you dropped it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text', 'carriedBy'],
        properties: {
          kind: { type: 'string', enum: [...SUBSTANCE_KINDS] },
          text: { type: 'string', description: 'The item as it appears in the input.' },
          carriedBy: {
            type: 'string',
            description: 'Verbatim phrase from `rewrite` carrying this item, or "" if dropped.',
          },
        },
      },
    },
  },
} as const;

/**
 * Parse a reply in the {@link REWRITE_SCHEMA} shape: drop malformed list entries, but refuse an
 * empty or missing rewrite.
 */
export function parseRewriteResponse(raw: string): RewriteResponse {
  const value = extractJsonObject(raw);
  const rewrite = requireText(value, 'rewrite');

  const additions: Addition[] = [];
  if (Array.isArray(value.additions)) {
    for (const entry of value.additions) {
      if (
        isRecord(entry) &&
        (entry.kind === 'framing' || entry.kind === 'reasoning') &&
        typeof entry.text === 'string' &&
        entry.text.trim() !== ''
      ) {
        additions.push({ kind: entry.kind, text: entry.text.trim() });
      }
    }
  }

  const substance: ReportedSubstance[] = [];
  if (Array.isArray(value.substance)) {
    for (const entry of value.substance) {
      if (
        isRecord(entry) &&
        typeof entry.kind === 'string' &&
        (SUBSTANCE_KINDS as readonly string[]).includes(entry.kind) &&
        typeof entry.text === 'string' &&
        entry.text.trim() !== ''
      ) {
        substance.push({
          kind: entry.kind as ReportedSubstance['kind'],
          text: entry.text.trim(),
          carriedBy: typeof entry.carriedBy === 'string' ? entry.carriedBy : '',
        });
      }
    }
  }

  return { rewrite, additions, substance };
}
