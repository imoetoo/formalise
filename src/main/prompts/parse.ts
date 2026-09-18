/**
 * Defensive parsing shared by every direction's prompt: tolerate code fences and surrounding
 * prose, refuse anything that is not a JSON object. Direction-specific shape checks live with
 * each prompt.
 */
import { MalformedResponseError } from '../errors';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Locate and parse the one JSON object in `raw`. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  let candidate = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(candidate);
  if (fenced?.[1] !== undefined) {
    candidate = fenced[1].trim();
  }
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new MalformedResponseError('no JSON object in the response');
    }
    candidate = candidate.slice(start, end + 1);
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (error) {
    throw new MalformedResponseError(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) {
    throw new MalformedResponseError('the JSON is not an object');
  }
  return value;
}

/** A non-empty, trimmed string field, or a malformed-response error naming it. */
export function requireText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MalformedResponseError(`the ${field} is missing or empty`);
  }
  return value.trim();
}
