import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  API_KEY_ENV,
  ApiError,
  BASE_URL_ENV,
  DEFAULT_MODEL,
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
  describeEngineConfig,
  describeRewriteError,
  modelFrom,
  parseRewriteResponse,
  requireApiKey,
  rewrite,
  workspaceIdFrom,
  type RewriteClient,
} from './claude';

const ENV = { [API_KEY_ENV]: 'sk-test' };

const GOOD_JSON = JSON.stringify({
  rewrite:
    'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?',
  additions: [
    { kind: 'framing', text: 'Hi boss,' },
    { kind: 'reasoning', text: 'due to the complexities of the tasks' },
    { kind: 'framing', text: 'would you kindly allow me' },
  ],
  substance: [
    { kind: 'position', text: 'where got enough time', carriedBy: 'take a while longer' },
    { kind: 'ask', text: 'more time (implied)', carriedBy: 'would you kindly allow me' },
  ],
});

function message(
  overrides: Partial<Anthropic.Message> & { text?: string } = {},
): Anthropic.Message {
  const { text = GOOD_JSON, ...rest } = overrides;
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-test',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    context_management: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
      output_tokens_details: null,
    },
    ...rest,
  } as Anthropic.Message;
}

function fakeClient(impl: () => Promise<Anthropic.Message>): RewriteClient & {
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(impl);
  return { messages: { create }, create };
}

describe('requireApiKey', () => {
  it('names the missing variable and promises the text is untouched when the key is absent', () => {
    expect(() => requireApiKey({})).toThrow(MissingApiKeyError);
    expect(() => requireApiKey({})).toThrow(API_KEY_ENV);
    expect(() => requireApiKey({ [API_KEY_ENV]: '   ' })).toThrow(MissingApiKeyError);
    expect(() => requireApiKey({})).toThrow(/untouched/);
  });

  it('returns the key when present', () => {
    expect(requireApiKey({ [API_KEY_ENV]: 'sk-test' })).toBe('sk-test');
  });
});

describe('rewrite', () => {
  it('refuses synchronously without a key, before touching the network', () => {
    const client = fakeClient(() => Promise.resolve(message()));
    expect(() => rewrite('wakao', 'formalise', {}, { client })).toThrow(MissingApiKeyError);
    expect(client.create).not.toHaveBeenCalled();
  });

  it('sends the Formalise prompt with a strict JSON schema, the default model and a bounded timeout', async () => {
    const client = fakeClient(() => Promise.resolve(message()));
    await rewrite('wakao! where got enough time sia', 'formalise', ENV, {
      client,
      timeoutMs: 1234,
    });

    expect(client.create).toHaveBeenCalledTimes(1);
    const [params, options] = client.create.mock.calls[0] as [
      Anthropic.MessageCreateParamsNonStreaming,
      Anthropic.RequestOptions,
    ];
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(params.system)).toMatch(/register changes, substance does not/i);
    const user = params.messages[0]?.content;
    expect(typeof user === 'string' && user.includes('wakao! where got enough time sia')).toBe(
      true,
    );
    expect(options.timeout).toBe(1234);
  });

  it('returns the rewrite, splits reasoning from framing and runs the substance check', async () => {
    const client = fakeClient(() => Promise.resolve(message()));
    const outcome = await rewrite('wakao! where got enough time sia', 'formalise', ENV, { client });

    expect(outcome.direction).toBe('formalise');
    expect(outcome.input).toBe('wakao! where got enough time sia');
    expect(outcome.output).toMatch(/^Hi boss,/);
    expect(outcome.model).toBe('claude-sonnet-5-test');
    expect(outcome.additions).toEqual([
      'Hi boss,',
      'due to the complexities of the tasks',
      'would you kindly allow me',
    ]);
    expect(outcome.reasoning).toEqual(['due to the complexities of the tasks']);
    expect(outcome.substance.ok).toBe(true);
    expect(outcome.substance.found).toContainEqual({
      kind: 'position',
      text: 'where got enough time',
    });
    expect(outcome.substance.found).toContainEqual({ kind: 'ask', text: 'more time (implied)' });
  });

  it('flags substance the model claims to carry with a phrase that is not in its rewrite', async () => {
    const lying = JSON.stringify({
      rewrite: 'Hi boss, I look forward to discussing the timeline.',
      additions: [],
      substance: [{ kind: 'position', text: 'where got enough time', carriedBy: 'a while longer' }],
    });
    const client = fakeClient(() => Promise.resolve(message({ text: lying })));
    const outcome = await rewrite('wakao! where got enough time sia', 'formalise', ENV, { client });
    expect(outcome.substance.ok).toBe(false);
    expect(outcome.substance.missing).toEqual([
      { kind: 'position', text: 'where got enough time' },
    ]);
  });

  it('honours a model override', async () => {
    const client = fakeClient(() => Promise.resolve(message()));
    await rewrite('x', 'formalise', ENV, { client, model: 'claude-opus-5' });
    const [params] = client.create.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.model).toBe('claude-opus-5');
  });

  it('reports a refusal as RefusedError with the explanation', async () => {
    const client = fakeClient(() =>
      Promise.resolve(
        message({
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: null, explanation: 'policy' },
          text: '',
        }),
      ),
    );
    await expect(rewrite('x', 'formalise', ENV, { client })).rejects.toThrow(RefusedError);
    await expect(rewrite('x', 'formalise', ENV, { client })).rejects.toThrow(/policy/);
  });

  it('reports a truncated response as malformed rather than using half a message', async () => {
    const client = fakeClient(() => Promise.resolve(message({ stop_reason: 'max_tokens' })));
    await expect(rewrite('x', 'formalise', ENV, { client })).rejects.toThrow(
      MalformedResponseError,
    );
  });

  it('maps SDK errors to typed errors: timeout, network, API status', async () => {
    const timeout = fakeClient(() => Promise.reject(new Anthropic.APIConnectionTimeoutError()));
    await expect(rewrite('x', 'formalise', ENV, { client: timeout })).rejects.toThrow(TimeoutError);
    await expect(
      rewrite('x', 'formalise', ENV, { client: timeout, timeoutMs: 5000 }),
    ).rejects.toThrow(/within 5s/);

    const network = fakeClient(() =>
      Promise.reject(new Anthropic.APIConnectionError({ message: 'ECONNREFUSED' })),
    );
    await expect(rewrite('x', 'formalise', ENV, { client: network })).rejects.toThrow(NetworkError);
    await expect(rewrite('x', 'formalise', ENV, { client: network })).rejects.toThrow(
      /ECONNREFUSED/,
    );

    const rateLimited = fakeClient(() =>
      Promise.reject(
        new Anthropic.RateLimitError(429, { type: 'rate_limit_error' }, 'slow down', new Headers()),
      ),
    );
    const err = await rewrite('x', 'formalise', ENV, { client: rateLimited }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toMatch(/429/);

    const auth = fakeClient(() =>
      Promise.reject(
        new Anthropic.AuthenticationError(
          401,
          { type: 'authentication_error' },
          'bad key',
          new Headers(),
        ),
      ),
    );
    await expect(rewrite('x', 'formalise', ENV, { client: auth })).rejects.toThrow(API_KEY_ENV);
  });

  it('wraps anything unexpected and still promises the text is untouched', async () => {
    const weird = fakeClient(() => Promise.reject(new Error('boom')));
    const err = await rewrite('x', 'formalise', ENV, { client: weird }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RewriteError);
    expect((err as RewriteError).kind).toBe('unknown');
    expect((err as RewriteError).message).toContain(UNTOUCHED);
  });

  it('describeRewriteError gives a user-facing message for any error, always ending untouched', () => {
    expect(describeRewriteError(new MissingApiKeyError())).toContain(API_KEY_ENV);
    expect(describeRewriteError('nope')).toContain(UNTOUCHED);
    expect(describeRewriteError(new Anthropic.APIConnectionError({ message: 'down' }))).toMatch(
      /Could not reach/,
    );
  });
});

describe('workspace id', () => {
  /** A transport that answers every request with a good message and records the requests. */
  function fakeFetch(): {
    fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    headers: () => Headers;
    url: () => string;
    calls: () => number;
  } {
    const seen: RequestInit[] = [];
    const urls: string[] = [];
    return {
      fetch: (input, init) => {
        seen.push(init ?? {});
        urls.push(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        return Promise.resolve(
          new Response(JSON.stringify(message()), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
      headers: () => new Headers(seen[0]?.headers),
      url: () => urls[0] ?? '',
      calls: () => seen.length,
    };
  }

  it('sends requests to ANTHROPIC_BASE_URL when set, so a compatible gateway can be used', async () => {
    const transport = fakeFetch();
    await rewrite(
      'x',
      'formalise',
      { ...ENV, [BASE_URL_ENV]: 'https://opencode.ai/zen' },
      { fetch: transport.fetch },
    );
    // The SDK appends /v1/messages itself, so the variable holds the part before /v1.
    expect(transport.url()).toBe('https://opencode.ai/zen/v1/messages');
  });

  it('uses the default endpoint when the variable is unset', async () => {
    const transport = fakeFetch();
    await rewrite('x', 'formalise', ENV, { fetch: transport.fetch });
    expect(transport.url()).toBe('https://api.anthropic.com/v1/messages');
  });

  it('reads ANTHROPIC_WORKSPACE_ID, ignoring blanks', () => {
    expect(workspaceIdFrom({})).toBeUndefined();
    expect(workspaceIdFrom({ [WORKSPACE_ID_ENV]: '   ' })).toBeUndefined();
    expect(workspaceIdFrom({ [WORKSPACE_ID_ENV]: ' wrkspc_01 ' })).toBe('wrkspc_01');
  });

  it('sends it as the anthropic-workspace-id header on the request when set', async () => {
    const transport = fakeFetch();
    await rewrite(
      'x',
      'formalise',
      { ...ENV, [WORKSPACE_ID_ENV]: 'wrkspc_01' },
      { fetch: transport.fetch },
    );
    expect(transport.calls()).toBe(1);
    expect(transport.headers().get(WORKSPACE_HEADER)).toBe('wrkspc_01');
    expect(transport.headers().get('x-api-key')).toBe('sk-test');
  });

  it('sends no such header when the variable is unset', async () => {
    const transport = fakeFetch();
    await rewrite('x', 'formalise', ENV, { fetch: transport.fetch });
    expect(transport.calls()).toBe(1);
    expect(transport.headers().has(WORKSPACE_HEADER)).toBe(false);
    expect(transport.headers().get('x-api-key')).toBe('sk-test');
  });

  it('maps the "not scoped to a workspace" 400 to WorkspaceScopeError naming both remedies', async () => {
    const apiMessage =
      'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header';
    const unscoped = fakeClient(() =>
      Promise.reject(
        new Anthropic.BadRequestError(
          400,
          { type: 'error', error: { type: 'invalid_request_error', message: apiMessage } },
          apiMessage,
          new Headers(),
        ),
      ),
    );
    const err = await rewrite('x', 'formalise', ENV, { client: unscoped }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceScopeError);
    expect((err as WorkspaceScopeError).kind).toBe('workspace');
    expect((err as WorkspaceScopeError).message).toContain(WORKSPACE_ID_ENV);
    expect((err as WorkspaceScopeError).message).toMatch(/workspace-scoped key/);
    expect((err as WorkspaceScopeError).message).toContain(UNTOUCHED);

    // Any other 400 stays a plain API error.
    const other = fakeClient(() =>
      Promise.reject(
        new Anthropic.BadRequestError(
          400,
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'max_tokens too big' },
          },
          'max_tokens too big',
          new Headers(),
        ),
      ),
    );
    const plain = await rewrite('x', 'formalise', ENV, { client: other }).catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(ApiError);
    expect(plain).not.toBeInstanceOf(WorkspaceScopeError);
  });
});

describe('model override', () => {
  it('uses DEFAULT_MODEL unless ANTHROPIC_MODEL is a non-blank string', () => {
    expect(modelFrom({})).toBe(DEFAULT_MODEL);
    expect(modelFrom({ [MODEL_ENV]: '' })).toBe(DEFAULT_MODEL);
    expect(modelFrom({ [MODEL_ENV]: '   ' })).toBe(DEFAULT_MODEL);
    expect(modelFrom({ [MODEL_ENV]: ' claude-sonnet-4-5 ' })).toBe('claude-sonnet-4-5');
  });

  it('sends the overridden model, and a per-call model still wins over the environment', async () => {
    const client = fakeClient(() => Promise.resolve(message()));
    await rewrite('x', 'formalise', { ...ENV, [MODEL_ENV]: 'gateway-claude' }, { client });
    const [params] = client.create.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.model).toBe('gateway-claude');

    await rewrite(
      'x',
      'formalise',
      { ...ENV, [MODEL_ENV]: 'gateway-claude' },
      { client, model: 'claude-opus-5' },
    );
    const [second] = client.create.mock.calls[1] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(second.model).toBe('claude-opus-5');
  });

  it('describes the effective model and endpoint for the start-up log, never the key', () => {
    const plain = describeEngineConfig(ENV).join('\n');
    expect(plain).toContain(`model: ${DEFAULT_MODEL} (default)`);
    expect(plain).toContain('endpoint: https://api.anthropic.com (default)');
    expect(plain).not.toContain('sk-test');

    const custom = describeEngineConfig({
      ...ENV,
      [MODEL_ENV]: 'gateway-claude',
      [BASE_URL_ENV]: 'https://opencode.ai/zen',
      [WORKSPACE_ID_ENV]: 'wrkspc_01',
    }).join('\n');
    expect(custom).toContain(`model: gateway-claude (from ${MODEL_ENV})`);
    expect(custom).toContain(`endpoint: https://opencode.ai/zen (from ${BASE_URL_ENV})`);
    expect(custom).toContain(WORKSPACE_HEADER);
    expect(custom).not.toContain('wrkspc_01');
    expect(custom).not.toContain('sk-test');
  });
});

describe('parseRewriteResponse', () => {
  it('accepts a clean object and normalises whitespace', () => {
    const parsed = parseRewriteResponse(GOOD_JSON);
    expect(parsed.rewrite).toMatch(/^Hi boss/);
    expect(parsed.additions).toHaveLength(3);
    expect(parsed.substance[0]).toEqual({
      kind: 'position',
      text: 'where got enough time',
      carriedBy: 'take a while longer',
    });
  });

  it('tolerates code fences and surrounding prose', () => {
    const fenced = 'Here you go:\n```json\n' + GOOD_JSON + '\n```\nHope that helps.';
    expect(parseRewriteResponse(fenced).rewrite).toMatch(/^Hi boss/);
    const prose = 'Sure! ' + GOOD_JSON + ' Done.';
    expect(parseRewriteResponse(prose).rewrite).toMatch(/^Hi boss/);
  });

  it('drops malformed list entries but keeps the rewrite', () => {
    const messy = JSON.stringify({
      rewrite: '  Hi boss.  ',
      additions: [
        { kind: 'nonsense', text: 'x' },
        { kind: 'framing', text: '  ' },
        'str',
        { kind: 'framing', text: 'Hi' },
      ],
      substance: [
        { kind: 'ask', text: 'do it' },
        { kind: 'bogus', text: 'x', carriedBy: 'y' },
        null,
      ],
    });
    const parsed = parseRewriteResponse(messy);
    expect(parsed.rewrite).toBe('Hi boss.');
    expect(parsed.additions).toEqual([{ kind: 'framing', text: 'Hi' }]);
    expect(parsed.substance).toEqual([{ kind: 'ask', text: 'do it', carriedBy: '' }]);
  });

  it('rejects no JSON, invalid JSON, non-objects and an empty rewrite', () => {
    expect(() => parseRewriteResponse('')).toThrow(MalformedResponseError);
    expect(() => parseRewriteResponse('just words')).toThrow(/no JSON object/);
    expect(() => parseRewriteResponse('{"rewrite": ')).toThrow(/invalid JSON/);
    expect(() => parseRewriteResponse('[1,2]')).toThrow(MalformedResponseError);
    expect(() => parseRewriteResponse('{"rewrite": "   "}')).toThrow(/missing or empty/);
    expect(() => parseRewriteResponse('{"additions": []}')).toThrow(/missing or empty/);
  });
});
