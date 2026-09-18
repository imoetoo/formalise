/**
 * Claude API client. STUB for phase 01: reads the key from the environment and refuses to
 * proceed without it, but makes no network call yet. Real client, prompts and the added-content
 * report are phase 03 (plans/03-claude-client.plan.md).
 */
import type { Direction } from '../shared/types';

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      `${API_KEY_ENV} is not set. Export it in your shell or put it in a local .env file ` +
        `(never commit it). Nothing was sent and the selected text is untouched.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet. See plans/03-claude-client.plan.md.`);
    this.name = 'NotImplementedError';
  }
}

export interface RewriteOutcome {
  direction: Direction;
  input: string;
  output: string;
  /** Text the model added that was not in the input, to be shown as the tool's own. */
  additions: readonly string[];
}

/** Returns the API key or throws {@link MissingApiKeyError}. Exported for tests. */
export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[API_KEY_ENV];
  if (key === undefined || key.trim() === '') {
    throw new MissingApiKeyError();
  }
  return key;
}

/**
 * Rewrite `text` in the given direction.
 *
 * Phase 01 behaviour: validates the key, then throws {@link NotImplementedError}. It never
 * opens a connection. Callers must treat any thrown error as "leave the selected text
 * untouched and say why" (PLAN.md §6).
 */
export function rewrite(
  text: string,
  direction: Direction,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RewriteOutcome> {
  requireApiKey(env);
  return Promise.reject(
    new NotImplementedError(`rewrite(${direction}) for ${String(text.length)} chars`),
  );
}
