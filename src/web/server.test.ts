import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RewriteOutcome } from '../main/claude';
import {
  API_KEY_ENV,
  ApiError,
  MalformedResponseError,
  MissingApiKeyError,
  NetworkError,
  RefusedError,
  TimeoutError,
  WorkspaceScopeError,
} from '../main/errors';
import type { Direction } from '../shared/types';
import {
  MAX_INPUT_CHARS,
  STATUS_FOR_KIND,
  createRateLimiter,
  createWebServer,
  isExposed,
  reachableUrls,
  type ErrorResponseBody,
  type RewriteFn,
  type RewriteResponseBody,
  type WebServerOptions,
} from './server';

const STATIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const SECRET = 'sk-ant-api03-THIS-KEY-MUST-NEVER-LEAVE-THE-HOST';
const KEYED_ENV: NodeJS.ProcessEnv = { [API_KEY_ENV]: SECRET };

const FORMALISE_IN = 'wakao! where got enough time sia';
const FORMALISE_OUT =
  'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?';
const BEAUTIFY_IN = 'i dont care you need to get this done by tomorrow';
const BEAUTIFY_OUT =
  'I really appreciate all that you have done for me so far, perhaps just a little bit more. I understand time might be tight, but knowing how amazing you are, would you kindly do this by tomorrow?';

function outcome(
  text: string,
  direction: Direction,
  over: Partial<RewriteOutcome> = {},
): RewriteOutcome {
  const formalise = direction === 'formalise';
  const additions = formalise
    ? [
        { kind: 'framing' as const, text: 'Hi boss,' },
        { kind: 'reasoning' as const, text: 'due to the complexities of the tasks' },
      ]
    : [
        {
          kind: 'framing' as const,
          text: 'I really appreciate all that you have done for me so far',
        },
        { kind: 'framing' as const, text: 'knowing how amazing you are' },
      ];
  return {
    direction,
    input: text,
    output: formalise ? FORMALISE_OUT : BEAUTIFY_OUT,
    additions: additions.map((a) => a.text),
    additionDetails: additions,
    reasoning: additions.filter((a) => a.kind === 'reasoning').map((a) => a.text),
    substance: {
      ok: true,
      found: formalise
        ? [{ kind: 'position', text: 'where got enough time' }]
        : [{ kind: 'deadline', text: 'by tomorrow' }],
      missing: [],
    },
    model: 'claude-test',
    ...over,
  };
}

const servers: Server[] = [];

async function start(
  options: Partial<WebServerOptions> = {},
): Promise<{ base: string; server: Server }> {
  const server = createWebServer({ staticDir: STATIC_DIR, env: KEYED_ENV, ...options });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${String(port)}`, server };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

function post(base: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  const { headers, ...rest } = init;
  return fetch(`${base}/api/rewrite`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
  });
}

describe('static page', () => {
  it('serves index.html at / with a same-origin content security policy and no caching', async () => {
    const { base } = await start();
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('<textarea');
    expect(html).toContain('value="formalise"');
    expect(html).toContain('value="beautify"');
    // Only same-origin assets, so the policy above can actually be enforced.
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
  });

  it('serves the script and stylesheet with their types and refuses everything else', async () => {
    const { base } = await start();
    const js = await fetch(base + '/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const css = await fetch(base + '/styles.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');

    for (const path of [
      '/missing.html',
      '/server.ts',
      '/package.json',
      '/.env',
      '/api',
      '/a/b.js',
    ]) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as ErrorResponseBody).kind).toBe('not-found');
    }
    // Path traversal in either spelling never leaves the static directory.
    const traversal = await fetch(base + '/%2e%2e%2fpackage.json');
    expect(traversal.status).toBe(404);
  });

  it('answers only GET/HEAD for the page and only POST for the endpoint', async () => {
    const { base } = await start();
    const postPage = await fetch(base + '/', { method: 'POST' });
    expect(postPage.status).toBe(405);
    const getApi = await fetch(base + '/api/rewrite');
    expect(getApi.status).toBe(405);
    expect(getApi.headers.get('allow')).toBe('POST');
    const head = await fetch(base + '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  it('publishes the input limit so the page can show it', async () => {
    const { base } = await start();
    const res = await fetch(base + '/api/config');
    expect(await res.json()).toEqual({
      maxInputChars: MAX_INPUT_CHARS,
      directions: ['formalise', 'beautify'],
    });
  });
});

describe('POST /api/rewrite', () => {
  it('calls the engine with the text, the direction and the server environment, and returns the desktop shape', async () => {
    const rewrite = vi.fn<RewriteFn>((text, direction) =>
      Promise.resolve(outcome(text, direction)),
    );
    const { base } = await start({ rewrite });
    const res = await post(base, { text: FORMALISE_IN, direction: 'formalise' });
    expect(res.status).toBe(200);
    expect(rewrite).toHaveBeenCalledWith(FORMALISE_IN, 'formalise', KEYED_ENV);

    const body = (await res.json()) as RewriteResponseBody;
    expect(body).toEqual({
      direction: 'formalise',
      output: FORMALISE_OUT,
      additions: ['Hi boss,', 'due to the complexities of the tasks'],
      additionDetails: [
        { kind: 'framing', text: 'Hi boss,' },
        { kind: 'reasoning', text: 'due to the complexities of the tasks' },
      ],
      reasoning: ['due to the complexities of the tasks'],
      substance: {
        ok: true,
        found: [{ kind: 'position', text: 'where got enough time' }],
        missing: [],
      },
      segments: [
        { text: 'Hi boss,', added: true },
        { text: ' Honestly, ', added: false },
        { text: 'due to the complexities of the tasks', added: true },
        {
          text: ', would you kindly allow me to take a while longer for this issue?',
          added: false,
        },
      ],
      model: 'claude-test',
    });
  });

  it('marks Beautify additions as segments and carries missing substance through', async () => {
    const rewrite = vi.fn<RewriteFn>((text, direction) =>
      Promise.resolve(
        outcome(text, direction, {
          substance: {
            ok: false,
            found: [{ kind: 'deadline', text: 'by tomorrow' }],
            missing: [{ kind: 'deadline', text: 'by tomorrow' }],
          },
        }),
      ),
    );
    const { base } = await start({ rewrite });
    const res = await post(base, { text: BEAUTIFY_IN, direction: 'beautify' });
    const body = (await res.json()) as RewriteResponseBody;
    expect(body.direction).toBe('beautify');
    expect(body.reasoning).toEqual([]);
    expect(body.substance.missing).toEqual([{ kind: 'deadline', text: 'by tomorrow' }]);
    expect(body.segments.filter((s) => s.added).map((s) => s.text)).toEqual([
      'I really appreciate all that you have done for me so far',
      'knowing how amazing you are',
    ]);
    expect(body.segments.map((s) => s.text).join('')).toBe(BEAUTIFY_OUT);
  });

  it('accepts a same-origin browser request and refuses one from another origin', async () => {
    const rewrite = vi.fn<RewriteFn>((text, direction) =>
      Promise.resolve(outcome(text, direction)),
    );
    const { base } = await start({ rewrite });
    const same = await post(
      base,
      { text: FORMALISE_IN, direction: 'formalise' },
      { headers: { Origin: base } },
    );
    expect(same.status).toBe(200);

    const cross = await post(
      base,
      { text: FORMALISE_IN, direction: 'formalise' },
      { headers: { Origin: 'http://evil.example' } },
    );
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as ErrorResponseBody).kind).toBe('forbidden');
    const nullOrigin = await post(
      base,
      { text: FORMALISE_IN, direction: 'formalise' },
      { headers: { Origin: 'null' } },
    );
    expect(nullOrigin.status).toBe(403);
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('rejects anything that is not JSON text in the two known fields', async () => {
    const rewrite = vi.fn<RewriteFn>();
    const { base } = await start({ rewrite, maxInputChars: 20 });

    const cases: { body: unknown; status: number; kind: string; init?: RequestInit }[] = [
      { body: 'not json', status: 400, kind: 'bad-request' },
      { body: '[1,2]', status: 400, kind: 'bad-request' },
      { body: { direction: 'formalise' }, status: 400, kind: 'bad-request' },
      { body: { text: 42, direction: 'formalise' }, status: 400, kind: 'bad-request' },
      { body: { text: ['a'], direction: 'formalise' }, status: 400, kind: 'bad-request' },
      { body: { text: '   \n ', direction: 'formalise' }, status: 400, kind: 'bad-request' },
      { body: { text: 'hi' }, status: 400, kind: 'bad-request' },
      { body: { text: 'hi', direction: 'shout' }, status: 400, kind: 'bad-request' },
      { body: { text: 'hi there', direction: 'formalise' }, status: 400, kind: 'bad-request' },
      { body: { text: 'x'.repeat(21), direction: 'formalise' }, status: 413, kind: 'too-large' },
      {
        body: { text: 'hi', direction: 'formalise' },
        status: 415,
        kind: 'unsupported-media-type',
        init: { headers: { 'Content-Type': 'text/plain' } },
      },
    ];
    for (const c of cases) {
      const res = await post(base, c.body, c.init);
      expect(res.status, JSON.stringify(c.body)).toBe(c.status);
      const body = (await res.json()) as ErrorResponseBody;
      expect(body.kind, JSON.stringify(c.body)).toBe(c.kind);
      expect(body.error).not.toBe('');
    }
    // Newlines and tabs are text; exactly the limit is fine.
    const ok = await post(base, { text: 'a\tb\r\nc'.padEnd(20, 'd'), direction: 'beautify' });
    expect(ok.status).not.toBe(400);
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('refuses a body over the byte limit before reading it all', async () => {
    const rewrite = vi.fn<RewriteFn>();
    const { base } = await start({ rewrite, maxBodyBytes: 200 });
    const res = await post(base, { text: 'y'.repeat(400), direction: 'formalise' });
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorResponseBody).kind).toBe('too-large');
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('rate-limits each client with a Retry-After and lets it through again after the window', async () => {
    let clock = 1_000_000;
    const rewrite = vi.fn<RewriteFn>((text, direction) =>
      Promise.resolve(outcome(text, direction)),
    );
    const { base } = await start({
      rewrite,
      rateLimit: { max: 2, windowMs: 60_000 },
      now: () => clock,
    });
    const body = { text: FORMALISE_IN, direction: 'formalise' };
    expect((await post(base, body)).status).toBe(200);
    expect((await post(base, body)).status).toBe(200);
    const limited = await post(base, body);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(((await limited.json()) as ErrorResponseBody).kind).toBe('rate-limited');
    expect(rewrite).toHaveBeenCalledTimes(2);

    clock += 60_001;
    expect((await post(base, body)).status).toBe(200);
    expect(rewrite).toHaveBeenCalledTimes(3);
  });

  it('turns away a rewrite while the host already has as many in flight as it allows', async () => {
    let release: (value: RewriteOutcome) => void = () => undefined;
    const pending = new Promise<RewriteOutcome>((resolve) => {
      release = resolve;
    });
    const rewrite = vi.fn<RewriteFn>(() => pending);
    const { base } = await start({ rewrite, maxInFlight: 1 });
    const body = { text: FORMALISE_IN, direction: 'formalise' };
    const first = post(base, body);
    await vi.waitFor(() => {
      expect(rewrite).toHaveBeenCalledTimes(1);
    });
    const second = await post(base, body);
    expect(second.status).toBe(429);
    expect(((await second.json()) as ErrorResponseBody).kind).toBe('busy');

    release(outcome(FORMALISE_IN, 'formalise'));
    expect((await first).status).toBe(200);
    // The slot is free again.
    expect((await post(base, body)).status).toBe(200);
  });

  it('maps every engine error to a status and its plain-words message, and never a stack', async () => {
    const cases: { error: unknown; kind: keyof typeof STATUS_FOR_KIND }[] = [
      { error: new MissingApiKeyError(), kind: 'no-key' },
      { error: new WorkspaceScopeError(), kind: 'workspace' },
      {
        error: new NetworkError(new Error('getaddrinfo ENOTFOUND api.anthropic.com')),
        kind: 'network',
      },
      { error: new TimeoutError(60_000, new Error('timed out')), kind: 'timeout' },
      {
        error: new ApiError(
          Object.assign(new Error('overloaded'), { status: 529, type: 'overloaded_error' }),
        ),
        kind: 'api',
      },
      { error: new RefusedError('harmful content'), kind: 'refused' },
      { error: new MalformedResponseError('no JSON object in the response'), kind: 'malformed' },
      { error: new Error('boom'), kind: 'unknown' },
      { error: 'a string, not even an Error', kind: 'unknown' },
    ];
    for (const c of cases) {
      // The engine may reject with anything; the server must cope with a non-Error too.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const rewrite = vi.fn<RewriteFn>(() => Promise.reject(c.error));
      const { base } = await start({ rewrite });
      const res = await post(base, { text: FORMALISE_IN, direction: 'formalise' });
      expect(res.status, c.kind).toBe(STATUS_FOR_KIND[c.kind]);
      const body = (await res.json()) as ErrorResponseBody;
      expect(body.kind).toBe(c.kind);
      expect(body.error).toMatch(/untouched/);
      expect(body.error).not.toMatch(/\n\s+at /);
    }
  });

  it('uses the desktop engine by default and reads the key only from the server environment', async () => {
    // No injected engine: the real `rewrite()` runs and refuses synchronously without a key,
    // before any connection is opened. A key offered by the request changes nothing.
    const { base } = await start({ env: {} });
    const res = await post(
      base,
      { text: FORMALISE_IN, direction: 'formalise', apiKey: SECRET, env: KEYED_ENV },
      { headers: { 'x-api-key': SECRET, Authorization: `Bearer ${SECRET}` } },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.kind).toBe('no-key');
    expect(body.error).toContain(`${API_KEY_ENV} is not set`);
  });

  it('never logs the text, only method, path, status and timing', async () => {
    const lines: string[] = [];
    const rewrite = vi.fn<RewriteFn>((text, direction) =>
      Promise.resolve(outcome(text, direction)),
    );
    const { base } = await start({ rewrite, log: (line) => lines.push(line) });
    await post(base, { text: FORMALISE_IN, direction: 'formalise' });
    await post(base, { text: 'x'.repeat(MAX_INPUT_CHARS + 1), direction: 'formalise' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^POST \/api\/rewrite -> 200 \d+ms$/);
    expect(lines[1]).toMatch(/^POST \/api\/rewrite -> 413 \d+ms$/);
    expect(lines.join('\n')).not.toContain('wakao');
    expect(lines.join('\n')).not.toContain(FORMALISE_OUT);
  });
});

describe('the key never leaves the host', () => {
  it('appears in no served asset, success body, error body or header, even when the engine leaks it', async () => {
    const failures: unknown[] = [
      new MissingApiKeyError(),
      new ApiError(
        Object.assign(new Error(`invalid x-api-key ${SECRET}`), {
          status: 401,
          type: 'authentication_error',
        }),
      ),
      new Error(`boom ${SECRET}`),
    ];
    let turn = 0;
    const rewrite = vi.fn<RewriteFn>((text, direction, env) => {
      // A confused engine that puts the key into its errors or its output must still not reach
      // the browser: the server redacts the key from every JSON byte it sends.
      const failure = failures[turn];
      turn += 1;
      if (failure !== undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(failure);
      }
      const key = env[API_KEY_ENV] ?? '';
      return Promise.resolve(
        outcome(text, direction, { model: `model-${key}`, output: `${FORMALISE_OUT} ${key}` }),
      );
    });
    const { base } = await start({ rewrite });

    const transcripts: string[] = [];
    const record = async (res: Response): Promise<void> => {
      const headers: string[] = [];
      res.headers.forEach((value, name) => {
        headers.push(`${name}: ${value}`);
      });
      transcripts.push(headers.join('\n') + '\n' + (await res.text()));
    };
    for (const path of ['/', '/app.js', '/styles.css', '/api/config', '/nope', '/api/rewrite']) {
      await record(await fetch(base + path));
    }
    for (let i = 0; i <= failures.length; i += 1) {
      await record(await post(base, { text: FORMALISE_IN, direction: 'formalise' }));
    }
    expect(rewrite).toHaveBeenCalledTimes(failures.length + 1);
    expect(transcripts).toHaveLength(6 + failures.length + 1);
    for (const transcript of transcripts) {
      expect(transcript).not.toContain(SECRET);
    }
    // The leaky success still arrived, redacted, so the redaction is what kept the key in.
    const success = transcripts.find((t) => t.includes('"model":"model-'));
    expect(success).toBeDefined();
    expect(success).toContain('[redacted]');

    // The page has no way to learn it either: the served files never mention a key, and the
    // server only compares it, never reading it into anything it sends.
    const sources = ['index.html', 'app.js', 'styles.css'].map((f) =>
      readFileSync(new URL(`./public/${f}`, import.meta.url), 'utf8'),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/sk-ant|apiKey|api_key|x-api-key|ANTHROPIC/i);
    }
  });
});

describe('createRateLimiter', () => {
  it('counts per key over a sliding window and forgets idle keys', () => {
    let clock = 0;
    const limiter = createRateLimiter(2, 100, () => clock);
    expect(limiter.hit('a')).toEqual({ allowed: true });
    clock = 50;
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('b')).toEqual({ allowed: true });
    clock = 60;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterMs: 40 });
    clock = 100;
    // The hit at t=0 has aged out; the one at t=50 remains, so one more is allowed.
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterMs: 50 });
    clock = 1_000;
    expect(limiter.hit('a')).toEqual({ allowed: true });
  });
});

describe('reachableUrls and isExposed', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '192.168.1.20', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    down: undefined,
  };

  it('lists localhost and every external IPv4 address for a wildcard bind', () => {
    expect(reachableUrls('0.0.0.0', 8787, interfaces)).toEqual([
      'http://localhost:8787',
      'http://192.168.1.20:8787',
    ]);
    expect(reachableUrls('::', 8787, interfaces)).toEqual([
      'http://localhost:8787',
      'http://192.168.1.20:8787',
    ]);
  });

  it('lists just the bound host, plus localhost for loopback', () => {
    expect(reachableUrls('127.0.0.1', 8787, interfaces)).toEqual([
      'http://127.0.0.1:8787',
      'http://localhost:8787',
    ]);
    expect(reachableUrls('192.168.1.20', 9000, interfaces)).toEqual(['http://192.168.1.20:9000']);
    expect(reachableUrls('::1', 8787, interfaces)).toEqual([
      'http://[::1]:8787',
      'http://localhost:8787',
    ]);
  });

  it('knows which binds other machines can reach', () => {
    expect(isExposed('127.0.0.1')).toBe(false);
    expect(isExposed('localhost')).toBe(false);
    expect(isExposed('::1')).toBe(false);
    expect(isExposed('0.0.0.0')).toBe(true);
    expect(isExposed('192.168.1.20')).toBe(true);
  });
});
