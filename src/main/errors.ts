/**
 * Every error the rewrite engine can raise. Kept free of SDK imports so prompt parsers and the
 * UI can use them without pulling in the client. The caller's contract for all of them is the
 * same: leave the selected text untouched and show the message (PLAN.md §6).
 */

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

export const UNTOUCHED = 'Nothing was changed; the selected text is untouched.';

export type RewriteErrorKind =
  'no-key' | 'network' | 'timeout' | 'api' | 'refused' | 'malformed' | 'unknown';

/** Base class of every error `rewrite()` can throw. */
export class RewriteError extends Error {
  readonly kind: RewriteErrorKind;
  constructor(kind: RewriteErrorKind, message: string, options?: ErrorOptions) {
    super(`${message} ${UNTOUCHED}`, options);
    this.name = 'RewriteError';
    this.kind = kind;
  }
}

export class MissingApiKeyError extends RewriteError {
  constructor() {
    super(
      'no-key',
      `${API_KEY_ENV} is not set. Export it in your shell or put it in a local .env file ` +
        `(never commit it). Nothing was sent.`,
    );
    this.name = 'MissingApiKeyError';
  }
}

export class NetworkError extends RewriteError {
  constructor(cause: Error) {
    super('network', `Could not reach the Claude API (${cause.message}). Check your connection.`, {
      cause,
    });
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends RewriteError {
  constructor(timeoutMs: number, cause: Error) {
    super('timeout', `The Claude API did not answer within ${String(timeoutMs / 1000)}s.`, {
      cause,
    });
    this.name = 'TimeoutError';
  }
}

export interface ApiErrorSource extends Error {
  status?: number | undefined;
  type?: string | null | undefined;
}

export class ApiError extends RewriteError {
  readonly status: number | undefined;
  readonly apiType: string | null;
  constructor(cause: ApiErrorSource, hint = '') {
    const status = cause.status === undefined ? '' : ` ${String(cause.status)}`;
    super('api', `The Claude API returned an error${status}: ${cause.message}.${hint}`, { cause });
    this.name = 'ApiError';
    this.status = cause.status;
    this.apiType = cause.type ?? null;
  }
}

export class RefusedError extends RewriteError {
  constructor(explanation: string | null | undefined) {
    super(
      'refused',
      `The model declined to rewrite this text${explanation ? `: ${explanation}` : ''}.`,
    );
    this.name = 'RefusedError';
  }
}

export class MalformedResponseError extends RewriteError {
  constructor(detail: string) {
    super('malformed', `The model returned something unusable (${detail}).`);
    this.name = 'MalformedResponseError';
  }
}
