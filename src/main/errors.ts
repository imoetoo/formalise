/**
 * Every error the rewrite engine can raise. Kept free of SDK imports so prompt parsers and the
 * UI can use them without pulling in the client. The caller's contract for all of them is the
 * same: leave the selected text untouched and show the message (PLAN.md §6).
 */

export const API_KEY_ENV = 'ANTHROPIC_API_KEY';

/**
 * Optional. An organisation-level key that is not scoped to a workspace is rejected by the API
 * unless every request carries the workspace id in the `anthropic-workspace-id` header; this
 * variable supplies it. Workspace-scoped keys need nothing.
 */
export const WORKSPACE_ID_ENV = 'ANTHROPIC_WORKSPACE_ID';
export const WORKSPACE_HEADER = 'anthropic-workspace-id';

/**
 * Optional. The SDK's own variable for an Anthropic-compatible gateway. The SDK appends
 * `/v1/messages` itself, so the value is everything before `/v1` (OpenCode Zen, whose endpoint
 * is `https://opencode.ai/zen/v1/messages`, takes `https://opencode.ai/zen`). The client is never
 * built with a hard-coded base URL; the value is simply passed through when present.
 */
export const BASE_URL_ENV = 'ANTHROPIC_BASE_URL';

/** Optional. Overrides `DEFAULT_MODEL`, for gateways that expose Claude under another id. */
export const MODEL_ENV = 'ANTHROPIC_MODEL';

export const UNTOUCHED = 'Nothing was changed; the selected text is untouched.';

export type RewriteErrorKind =
  'no-key' | 'workspace' | 'network' | 'timeout' | 'api' | 'refused' | 'malformed' | 'unknown';

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

/**
 * The API answered 400 "This API key is not scoped to a workspace, so this request must include
 * the anthropic-workspace-id header" (seen live on 2026-09-18 with an organisation-level key).
 */
export class WorkspaceScopeError extends RewriteError {
  constructor(cause?: Error) {
    super(
      'workspace',
      `Your ${API_KEY_ENV} is an organisation-level key that is not scoped to a workspace, so the ` +
        `Claude API needs a workspace id with every request. Either create a workspace-scoped key ` +
        `in the Anthropic Console and use that, or set ${WORKSPACE_ID_ENV} to your workspace's id ` +
        `(sent as the ${WORKSPACE_HEADER} header) and restart.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'WorkspaceScopeError';
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
