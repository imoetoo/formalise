/**
 * Web mode (phase 06, plans/06-web-mode.plan.md): a paste-box page over the existing engine for
 * people without their own Claude API key. The person who has the key runs this small HTTP
 * server; anyone who can reach it pastes text into the page, picks a direction and reviews the
 * result in the browser.
 *
 * Boundary: exactly the desktop engine, exposed once. `POST /api/rewrite` calls the same
 * `rewrite()` (which runs the substance check) as the hotkey flows in `src/main`, so the two
 * modes cannot drift. The key comes from the server process environment passed in as `env` and
 * never leaves it: no response, asset or log line carries it, and nothing in a request can
 * substitute another key. Inputs and outputs are never persisted or logged (PLAN.md §1: the
 * tool never sends anything; here the browser only shows the result to the person who pasted).
 *
 * Abuse limits protect the host's quota on a shared network: an input size limit, a per-client
 * sliding-window rate limit, a cap on concurrent rewrites, JSON-only bodies and a same-origin
 * check so another web page cannot make a visitor's browser spend the host's quota.
 */
import { readFile, realpath } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, join, sep } from 'node:path';
import { REQUEST_TIMEOUT_MS, rewrite as defaultRewrite, toRewriteError } from '../main/claude';
import type { RewriteOutcome } from '../main/claude';
import { API_KEY_ENV, type RewriteErrorKind } from '../main/errors';
import { segmentOutput, type Segment } from '../shared/segment';
import { DIRECTIONS, type Addition, type Direction, type SubstanceItem } from '../shared/types';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

/** Longest input accepted, in UTF-16 code units (what a textarea's `maxlength` counts). */
export const MAX_INPUT_CHARS = 4_000;
/** Longest request body accepted; ample for `MAX_INPUT_CHARS` of escaped four-byte UTF-8. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Per-client limit: this many rewrites per window. */
export const RATE_LIMIT_MAX = 6;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Rewrites in flight across all clients before new ones are turned away. */
export const MAX_IN_FLIGHT = 4;

export type RewriteFn = (
  text: string,
  direction: Direction,
  env: NodeJS.ProcessEnv,
) => Promise<RewriteOutcome>;

export interface WebServerOptions {
  /** Directory holding `index.html`, `app.js` and `styles.css`. */
  staticDir: string;
  /** The only place the API key is read from. Defaults to the server process environment. */
  env?: NodeJS.ProcessEnv;
  /** The engine. Defaults to the desktop's `rewrite()`; tests inject a fake. */
  rewrite?: RewriteFn;
  maxInputChars?: number;
  maxBodyBytes?: number;
  rateLimit?: { max: number; windowMs: number };
  maxInFlight?: number;
  /** Receives one line per request: method, path, status and duration. Never the text. */
  log?: (line: string) => void;
  now?: () => number;
}

/** Body of a successful `POST /api/rewrite`. Mirrors what the desktop review window shows. */
export interface RewriteResponseBody {
  direction: Direction;
  output: string;
  /** Text the tool added that was not in the input, to be shown as the tool's own. */
  additions: readonly string[];
  additionDetails: readonly Addition[];
  /** The subset of `additions` that is reasoning the input never stated (PLAN.md §4). */
  reasoning: readonly string[];
  substance: { ok: boolean; found: readonly SubstanceItem[]; missing: readonly SubstanceItem[] };
  /** `output` split into the sender's words and marked additions, ready to render. */
  segments: readonly Segment[];
  model: string;
}

export type WebErrorKind =
  | RewriteErrorKind
  | 'bad-request'
  | 'too-large'
  | 'unsupported-media-type'
  | 'forbidden'
  | 'rate-limited'
  | 'busy'
  | 'not-found'
  | 'method-not-allowed';

export interface ErrorResponseBody {
  error: string;
  kind: WebErrorKind;
}

export interface ConfigResponseBody {
  maxInputChars: number;
  directions: readonly Direction[];
}

/** HTTP status for each engine failure. The message is the engine's own, in plain words. */
export const STATUS_FOR_KIND: Readonly<Record<RewriteErrorKind, number>> = {
  'no-key': 503,
  workspace: 503,
  network: 502,
  timeout: 504,
  api: 502,
  refused: 422,
  malformed: 502,
  unknown: 500,
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Control characters that never occur in pasted prose; anything carrying them is not text. */
// eslint-disable-next-line no-control-regex
const NOT_TEXT = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

// ---------------------------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------------------------

export interface RateLimiter {
  /** Records a hit for `key` when allowed. `retryAfterMs` is set when it is not. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfterMs: number };
}

/** Sliding-window limiter: at most `max` hits per `windowMs` per key. Exported for tests. */
export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  function sweep(at: number): void {
    // Drop keys whose every hit has aged out so the map cannot grow with the client count.
    if (at - lastSweep < windowMs) {
      return;
    }
    lastSweep = at;
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => at - t < windowMs);
      if (fresh.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, fresh);
      }
    }
  }

  return {
    hit(key) {
      const at = now();
      sweep(at);
      const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
      if (recent.length >= max) {
        const oldest = recent[0] ?? at;
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: Math.max(1, windowMs - (at - oldest)) };
      }
      recent.push(at);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly kind: WebErrorKind,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  extra: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(body);
}

/** Text of every JSON response passes through this before it leaves; see {@link redactor}. */
type Redact = (text: string) => string;

/**
 * Belt and braces for the one promise this server makes: even if an error message or a model
 * reply somehow carried the key, the bytes on the wire will not. The key is only ever compared,
 * never read into anything that is sent.
 */
function redactor(env: NodeJS.ProcessEnv): Redact {
  const key = env[API_KEY_ENV];
  if (key === undefined || key.trim() === '') {
    return (text) => text;
  }
  return (text) => text.split(key).join('[redacted]');
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  redact: Redact,
  extra: Readonly<Record<string, string>> = {},
): void {
  send(res, status, redact(JSON.stringify(body)), 'application/json; charset=utf-8', extra);
}

function sendError(res: ServerResponse, error: HttpError, redact: Redact): void {
  const body: ErrorResponseBody = { error: error.message, kind: error.kind };
  sendJson(res, error.status, body, redact, error.headers);
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, 'too-large', `The request is larger than ${String(limit)} bytes.`);
}

/** Read the whole body, refusing anything over `limit` bytes before buffering it. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(tooLarge(limit));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(tooLarge(limit));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      reject(new HttpError(400, 'bad-request', `Could not read the request: ${error.message}`));
    });
  });
}

/**
 * Refuse requests another origin's page could have made from a visitor's browser. A browser
 * sends `Origin` on every cross-origin request and on same-origin POSTs; it must match the
 * host the page was served from. Non-browser clients send no `Origin` and pass.
 */
function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) {
    return;
  }
  const host = req.headers.host;
  if (host === undefined || origin !== `http://${host}`) {
    throw new HttpError(
      403,
      'forbidden',
      'Cross-origin requests are not accepted. Open the page from the URL the server printed.',
    );
  }
}

function parseRewriteRequest(
  raw: Buffer,
  maxInputChars: number,
): { text: string; direction: Direction } {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad-request', 'The request body is not valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'bad-request', 'The request body must be a JSON object.');
  }
  const { text, direction } = value as Record<string, unknown>;
  if (typeof direction !== 'string' || !(DIRECTIONS as readonly string[]).includes(direction)) {
    throw new HttpError(
      400,
      'bad-request',
      `"direction" must be one of ${DIRECTIONS.map((d) => `"${d}"`).join(', ')}.`,
    );
  }
  if (typeof text !== 'string') {
    throw new HttpError(400, 'bad-request', '"text" must be a string.');
  }
  if (text.trim() === '') {
    throw new HttpError(400, 'bad-request', 'Paste some text first; there is nothing to rewrite.');
  }
  if (NOT_TEXT.test(text)) {
    throw new HttpError(
      400,
      'bad-request',
      'The text contains control characters; paste plain text.',
    );
  }
  if (text.length > maxInputChars) {
    throw new HttpError(
      413,
      'too-large',
      `The text is ${String(text.length)} characters; the limit is ${String(maxInputChars)}.`,
    );
  }
  return { text, direction: direction as Direction };
}

function toResponseBody(outcome: RewriteOutcome): RewriteResponseBody {
  return {
    direction: outcome.direction,
    output: outcome.output,
    additions: outcome.additions,
    additionDetails: outcome.additionDetails,
    reasoning: outcome.reasoning,
    substance: {
      ok: outcome.substance.ok,
      found: outcome.substance.found,
      missing: outcome.substance.missing,
    },
    segments: segmentOutput(outcome.output, outcome.additions),
    model: outcome.model,
  };
}

// ---------------------------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------------------------

export type WebHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** The request handler alone, for embedding or testing without a socket. */
export function createWebHandler(options: WebServerOptions): WebHandler {
  const env = options.env ?? process.env;
  const rewrite = options.rewrite ?? defaultRewrite;
  const maxInputChars = options.maxInputChars ?? MAX_INPUT_CHARS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const limiter = createRateLimiter(
    options.rateLimit?.max ?? RATE_LIMIT_MAX,
    options.rateLimit?.windowMs ?? RATE_LIMIT_WINDOW_MS,
    now,
  );
  const redact = redactor(env);
  let staticRoot: Promise<string> | null = null;
  let inFlight = 0;

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    // One flat directory, no traversal: the name must be a plain file name we know how to type.
    const type = CONTENT_TYPES[extname(name)];
    if (
      name !== basename(name) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ||
      type === undefined
    ) {
      throw new HttpError(404, 'not-found', 'Not found.');
    }
    staticRoot ??= realpath(options.staticDir);
    const root = await staticRoot;
    let content: Buffer;
    try {
      const real = await realpath(join(root, name));
      if (!real.startsWith(root + sep)) {
        throw new Error('outside the static directory');
      }
      content = await readFile(real);
    } catch {
      throw new HttpError(404, 'not-found', 'Not found.');
    }
    send(res, 200, content, type);
  }

  async function handleRewrite(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'method-not-allowed', 'Use POST.', { Allow: 'POST' });
    }
    assertSameOrigin(req);
    const contentType = req.headers['content-type'] ?? '';
    if (!/^application\/json\b/i.test(contentType)) {
      throw new HttpError(
        415,
        'unsupported-media-type',
        'Send the text as JSON with Content-Type: application/json.',
      );
    }
    const raw = await readBody(req, maxBodyBytes);
    const { text, direction } = parseRewriteRequest(raw, maxInputChars);

    const client = req.socket.remoteAddress ?? 'unknown';
    const verdict = limiter.hit(client);
    if (!verdict.allowed) {
      const seconds = Math.ceil(verdict.retryAfterMs / 1000);
      throw new HttpError(
        429,
        'rate-limited',
        `Too many rewrites from this device; try again in ${String(seconds)}s.`,
        { 'Retry-After': String(seconds) },
      );
    }
    if (inFlight >= maxInFlight) {
      throw new HttpError(
        429,
        'busy',
        'The host is already handling as many rewrites as it allows; try again shortly.',
        { 'Retry-After': '5' },
      );
    }

    inFlight += 1;
    let outcome: RewriteOutcome;
    try {
      // `env` is the server's own environment: nothing from the request reaches the engine
      // except the text and the direction.
      outcome = await rewrite(text, direction, env);
    } catch (error) {
      const mapped = toRewriteError(error, REQUEST_TIMEOUT_MS);
      throw new HttpError(STATUS_FOR_KIND[mapped.kind], mapped.kind, mapped.message);
    } finally {
      inFlight -= 1;
    }
    sendJson(res, 200, toResponseBody(outcome), redact);
  }

  function handleConfig(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'GET') {
      throw new HttpError(405, 'method-not-allowed', 'Use GET.', { Allow: 'GET' });
    }
    const body: ConfigResponseBody = { maxInputChars, directions: DIRECTIONS };
    sendJson(res, 200, body, redact);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    switch (url.pathname) {
      case '/api/rewrite':
        await handleRewrite(req, res);
        return;
      case '/api/config':
        handleConfig(req, res);
        return;
      default:
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new HttpError(405, 'method-not-allowed', 'Use GET.', { Allow: 'GET, HEAD' });
        }
        await serveStatic(url.pathname, res);
    }
  }

  return (req, res) => {
    const started = now();
    res.on('finish', () => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      log(`${req.method ?? '-'} ${path} -> ${String(res.statusCode)} ${String(now() - started)}ms`);
    });
    route(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendError(res, error, redact);
        return;
      }
      sendError(res, new HttpError(500, 'unknown', 'Something went wrong on the host.'), redact);
    });
  };
}

/** An HTTP server (not yet listening) serving the page and the one JSON endpoint. */
export function createWebServer(options: WebServerOptions): Server {
  const server = createServer(createWebHandler(options));
  // Slow clients cannot pin the host: headers within 10s, whole request within a minute.
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  return server;
}

export interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * The URLs a listener on `host`:`port` is reachable at, for printing at start-up. A wildcard
 * host lists every non-internal IPv4 address of this machine plus localhost. Exported for tests.
 */
export function reachableUrls(
  host: string,
  port: number,
  interfaces: Readonly<Record<string, readonly InterfaceAddress[] | undefined>>,
): string[] {
  const urls: string[] = [];
  const add = (h: string): void => {
    const formatted = h.includes(':') ? `[${h}]` : h;
    const url = `http://${formatted}:${String(port)}`;
    if (!urls.includes(url)) {
      urls.push(url);
    }
  };
  const wildcard = host === '0.0.0.0' || host === '::' || host === '';
  if (wildcard) {
    add('localhost');
    for (const list of Object.values(interfaces)) {
      for (const entry of list ?? []) {
        const v4 = entry.family === 'IPv4' || entry.family === 4;
        if (v4 && !entry.internal) {
          add(entry.address);
        }
      }
    }
    return urls;
  }
  add(host);
  if (host === '127.0.0.1' || host === '::1') {
    add('localhost');
  }
  return urls;
}

/** True when `host` accepts connections from other machines. */
export function isExposed(host: string): boolean {
  return !(host === '127.0.0.1' || host === '::1' || host === 'localhost');
}
