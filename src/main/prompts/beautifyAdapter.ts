/**
 * Adapts the Beautify prompt (`./beautify.ts`, owned by phase 05) to the engine's
 * {@link DirectionPrompt} interface. The prompt itself is not tuned here. Beautify's reply is
 * `{ output, additions: string[] }`; every addition is encouragement or acknowledgement, which
 * is framing, and the prompt does not self-report substance, so the heuristic layer of the
 * substance check does that work alone.
 */
import { BEAUTIFY_RESPONSE_SCHEMA, BEAUTIFY_SYSTEM_PROMPT, buildBeautifyPrompt } from './beautify';
import { extractJsonObject, requireText } from './parse';
import type { DirectionPrompt, ParsedRewrite } from './types';

export function parseBeautifyResponse(raw: string): ParsedRewrite {
  const value = extractJsonObject(raw);
  const rewrite = requireText(value, 'output');
  const additions: ParsedRewrite['additions'] = [];
  if (Array.isArray(value.additions)) {
    for (const entry of value.additions) {
      if (typeof entry === 'string' && entry.trim() !== '') {
        additions.push({ kind: 'framing', text: entry.trim() });
      }
    }
  }
  return { rewrite, additions, substance: [] };
}

export const BEAUTIFY_PROMPT: DirectionPrompt = {
  direction: 'beautify',
  system: BEAUTIFY_SYSTEM_PROMPT,
  user: (text) => buildBeautifyPrompt(text).user,
  schema: BEAUTIFY_RESPONSE_SCHEMA,
  parse: parseBeautifyResponse,
};
