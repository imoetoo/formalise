/**
 * Claude API client (phase 03, plans/03-claude-client.plan.md).
 *
 * `rewrite()` sends the captured text to the Anthropic Messages API over HTTPS through the
 * official SDK, asks for a strict JSON object (rewrite + additions + self-reported substance),
 * parses it defensively and runs the substance check. Every failure surfaces as a typed
 * {@link RewriteError}; the caller must treat any error as "leave the selected text untouched
 * and say why" (PLAN.md §6). The key comes from `ANTHROPIC_API_KEY` only; nothing is ever sent
 * by this module except the rewrite request itself.
 */
import Anthropic, { type ClientOptions as SdkClientOptions } from '@anthropic-ai/sdk';
import type { Addition, Direction } from '../shared/types';
import {
  API_KEY_ENV,
  ApiError,
  BASE_URL_ENV,
  MODEL_ENV,
  MalformedResponseError,
  MissingApiKeyError,
  NetworkError,
  RefusedError,
  RewriteError,
  TimeoutError,
  WORKSPACE_HEADER,
  WORKSPACE_ID_ENV,
  WorkspaceScopeError,
} from './errors';
import { promptFor } from './prompts';
import { substanceCheck, type SubstanceReport } from './substanceCheck';

export {
  API_KEY_ENV,
  ApiError,
  BASE_URL_ENV,
  MODEL_ENV,
  MalformedResponseError,
  MissingApiKeyError,
  NetworkError,
  RefusedError,
  RewriteError,
  TimeoutError,
  UNTOUCHED,
  WORKSPACE_HEADER,
  WORKSPACE_ID_ENV,
  WorkspaceScopeError,
  type RewriteErrorKind,
} from './errors';
export { parseRewriteResponse } from './prompts';

/**
 * The one place the model is named. Overridden by `ANTHROPIC_MODEL` in the environment
 * ({@link modelFrom}) or per call with `RewriteOptions.model`.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5';

/** Wall-clock bound for one request; the SDK retries connection errors within it. */
export const REQUEST_TIMEOUT_MS = 60_000;

/** Ample for a message rewrite; hitting it is reported as a malformed response, not truncated. */
export const MAX_OUTPUT_TOKENS = 4_096;

export interface RewriteOutcome {
  direction: Direction;
  input: string;
  output: string;
  /** Text the model added that was not in the input, to be shown as the tool's own. */
  additions: readonly string[];
  /** The same additions with their kind. */
  additionDetails: readonly Addition[];
  /** The subset of additions that is reasoning the input never stated (PLAN.md §4). */
  reasoning: readonly string[];
  /** Substance check of `output` against `input`, including the model's verified self-report. */
  substance: SubstanceReport;
  /** The model that produced the rewrite. */
  model: string;
}

/** The slice of the SDK client `rewrite()` uses. `new Anthropic()` satisfies it; tests fake it. */
export interface RewriteClient {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: Anthropic.RequestOptions,
    ): Promise<Anthropic.Message>;
  };
}

export interface RewriteOptions {
  /** Injected client, mainly for tests. Defaults to a real SDK client built from the key. */
  client?: RewriteClient;
  /** Injected transport for the default client, for tests that need to see the HTTP request. */
  fetch?: SdkClientOptions['fetch'];
  model?: string;
  timeoutMs?: number;
}

/** Returns the API key or throws {@link MissingApiKeyError}. Exported for tests. */
export function requireApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[API_KEY_ENV];
  if (key === undefined || key.trim() === '') {
    throw new MissingApiKeyError();
  }
  return key;
}

/** A trimmed environment variable, or undefined when unset or blank. */
function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** The optional workspace id (`ANTHROPIC_WORKSPACE_ID`), or undefined when unset or blank. */
export function workspaceIdFrom(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return optionalEnv(env, WORKSPACE_ID_ENV);
}

/** The optional gateway base URL (`ANTHROPIC_BASE_URL`), or undefined for the SDK's default. */
export function baseUrlFrom(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return optionalEnv(env, BASE_URL_ENV);
}

/** The model to use: `ANTHROPIC_MODEL` when set to a non-blank string, else `DEFAULT_MODEL`. */
export function modelFrom(env: NodeJS.ProcessEnv = process.env): string {
  return optionalEnv(env, MODEL_ENV) ?? DEFAULT_MODEL;
}

/**
 * One line per engine setting for a start-up log, so the effective model and endpoint are
 * visible without reading the environment by hand. Never includes the key.
 */
export function describeEngineConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const model = modelFrom(env);
  const baseUrl = baseUrlFrom(env);
  const lines = [
    `model: ${model}${model === DEFAULT_MODEL && optionalEnv(env, MODEL_ENV) === undefined ? ' (default)' : ` (from ${MODEL_ENV})`}`,
    `endpoint: ${baseUrl ?? 'https://api.anthropic.com (default)'}${baseUrl === undefined ? '' : ` (from ${BASE_URL_ENV})`}`,
  ];
  if (workspaceIdFrom(env) !== undefined) {
    lines.push(`workspace: ${WORKSPACE_ID_ENV} is set and sent as ${WORKSPACE_HEADER}`);
  }
  return lines;
}

export interface ClientOptions {
  /** Sent as the `anthropic-workspace-id` header on every request when present. */
  workspaceId?: string;
  /** An Anthropic-compatible gateway; absent means the SDK's default (api.anthropic.com). */
  baseUrl?: string;
  fetch?: SdkClientOptions['fetch'];
}

/** A real SDK client. Retries (SDK default) stay inside the timeout budget per attempt. */
export function createClient(
  apiKey: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  options: ClientOptions = {},
): Anthropic {
  return new Anthropic({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 2,
    ...(options.workspaceId === undefined
      ? {}
      : { defaultHeaders: { [WORKSPACE_HEADER]: options.workspaceId } }),
    // Passed through from the environment only; never hard-coded, so the SDK's own default and
    // its ANTHROPIC_BASE_URL handling stay in charge when nothing is set.
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

function clientFor(env: NodeJS.ProcessEnv, apiKey: string, options: RewriteOptions): RewriteClient {
  if (options.client !== undefined) {
    return options.client;
  }
  const workspaceId = workspaceIdFrom(env);
  const baseUrl = baseUrlFrom(env);
  return createClient(apiKey, options.timeoutMs ?? REQUEST_TIMEOUT_MS, {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

/**
 * Rewrite `text` in the given direction.
 *
 * The key is validated synchronously, before any connection is opened, so a missing key throws
 * rather than rejects. Everything else rejects with a {@link RewriteError} subclass.
 */
export function rewrite(
  text: string,
  direction: Direction,
  env: NodeJS.ProcessEnv = process.env,
  options: RewriteOptions = {},
): Promise<RewriteOutcome> {
  const apiKey = requireApiKey(env);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const client = clientFor(env, apiKey, options);
  const model = options.model ?? modelFrom(env);
  return performRewrite(text, direction, client, model, timeoutMs);
}

async function performRewrite(
  text: string,
  direction: Direction,
  client: RewriteClient,
  model: string,
  timeoutMs: number,
): Promise<RewriteOutcome> {
  const prompt = promptFor(direction);
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt.user(text) }],
        output_config: { format: { type: 'json_schema', schema: prompt.schema } },
      },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw toRewriteError(error, timeoutMs);
  }

  if (message.stop_reason === 'refusal') {
    throw new RefusedError(message.stop_details?.explanation);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new MalformedResponseError('the response was cut off at the output limit');
  }

  const raw = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const parsed = prompt.parse(raw);

  return {
    direction,
    input: text,
    output: parsed.rewrite,
    additions: parsed.additions.map((a) => a.text),
    additionDetails: parsed.additions,
    reasoning: parsed.additions.filter((a) => a.kind === 'reasoning').map((a) => a.text),
    substance: substanceCheck(text, parsed.rewrite, parsed.substance),
    model: message.model,
  };
}

/** The API's own wording for a key that needs a workspace id, matched loosely. */
const WORKSPACE_SCOPE_MESSAGE = /not scoped to a workspace|anthropic-workspace-id/i;

/** Map an SDK error to the typed error the UI reports. Most specific class first. */
export function toRewriteError(error: unknown, timeoutMs: number): RewriteError {
  if (error instanceof RewriteError) {
    return error;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new TimeoutError(timeoutMs, error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new NetworkError(error);
  }
  if (
    error instanceof Anthropic.APIError &&
    error.status === 400 &&
    WORKSPACE_SCOPE_MESSAGE.test(error.message)
  ) {
    return new WorkspaceScopeError(error);
  }
  if (error instanceof Anthropic.APIError) {
    const hint = error instanceof Anthropic.AuthenticationError ? ` Check ${API_KEY_ENV}.` : '';
    return new ApiError(error as InstanceType<typeof Anthropic.APIError>, hint);
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  return new RewriteError('unknown', `Unexpected failure: ${cause.message}.`, { cause });
}

/** The message to show the user for any error out of `rewrite()`. Always says the text is untouched. */
export function describeRewriteError(error: unknown): string {
  return toRewriteError(error, REQUEST_TIMEOUT_MS).message;
}
