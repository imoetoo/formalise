// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The served page at the boundary the user hits: index.html plus app.js loaded into jsdom with
 * `fetch` faked. Checks the desktop semantics survive the trip: original beside result,
 * additions marked and attributed to the tool, missing substance flagged, Copy for Formalise
 * only, nothing that could write back for Beautify, and the text box untouched whatever
 * happens.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorResponseBody, RewriteResponseBody } from './server';

// jsdom's URL class is not Node's, so resolve the files through paths rather than URL objects.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');
const HTML = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
const APP = readFileSync(join(PUBLIC_DIR, 'app.js'), 'utf8');

const FORMALISE_IN = 'wakao! where got enough time sia';
const FORMALISE_OUT =
  'Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow me to take a while longer for this issue?';
const BEAUTIFY_IN = 'i dont care you need to get this done by tomorrow';
const BEAUTIFY_OUT =
  'I really appreciate all that you have done for me so far, perhaps just a little bit more. I understand time might be tight, but knowing how amazing you are, would you kindly do this by tomorrow?';

const FORMALISE_BODY: RewriteResponseBody = {
  direction: 'formalise',
  output: FORMALISE_OUT,
  additions: ['Hi boss,', 'due to the complexities of the tasks'],
  additionDetails: [
    { kind: 'framing', text: 'Hi boss,' },
    { kind: 'reasoning', text: 'due to the complexities of the tasks' },
  ],
  reasoning: ['due to the complexities of the tasks'],
  substance: {
    ok: false,
    found: [{ kind: 'position', text: 'where got enough time' }],
    missing: [{ kind: 'position', text: 'where got enough time' }],
  },
  segments: [
    { text: 'Hi boss,', added: true },
    { text: ' Honestly, ', added: false },
    { text: 'due to the complexities of the tasks', added: true },
    { text: ', would you kindly allow me to take a while longer for this issue?', added: false },
  ],
  model: 'claude-test',
};

const BEAUTIFY_BODY: RewriteResponseBody = {
  direction: 'beautify',
  output: BEAUTIFY_OUT,
  additions: [
    'I really appreciate all that you have done for me so far',
    'knowing how amazing you are',
  ],
  additionDetails: [
    { kind: 'framing', text: 'I really appreciate all that you have done for me so far' },
    { kind: 'framing', text: 'knowing how amazing you are' },
  ],
  reasoning: [],
  substance: { ok: true, found: [{ kind: 'deadline', text: 'by tomorrow' }], missing: [] },
  segments: [
    { text: 'I really appreciate all that you have done for me so far', added: true },
    {
      text: ', perhaps just a little bit more. I understand time might be tight, but ',
      added: false,
    },
    { text: 'knowing how amazing you are', added: true },
    { text: ', would you kindly do this by tomorrow?', added: false },
  ],
  model: 'claude-test',
};

type Answer =
  | { status: 200; body: RewriteResponseBody }
  | { status: number; body: ErrorResponseBody }
  | { reject: true };

interface Page {
  textarea: HTMLTextAreaElement;
  form: HTMLFormElement;
  button: HTMLButtonElement;
  counter: HTMLElement;
  result: HTMLElement;
  rewriteCalls: () => { text: string; direction: string }[];
  submit: (direction: 'formalise' | 'beautify', text: string) => Promise<void>;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`no element #${id}`);
  }
  return node;
}

function query(root: ParentNode, selector: string): Element {
  const node = root.querySelector(selector);
  if (node === null) {
    throw new Error(`no element ${selector}`);
  }
  return node;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Load the page with a fake `fetch` that answers `/api/rewrite` from `answers`, in order. */
function loadPage(answers: Answer[], maxInputChars = 4000): Page {
  const rewriteCalls: { text: string; direction: string }[] = [];
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/config') {
        return Promise.resolve(json(200, { maxInputChars, directions: ['formalise', 'beautify'] }));
      }
      if (url === '/api/rewrite') {
        expect(init?.method).toBe('POST');
        const headers = new Headers(init?.headers);
        expect(headers.get('content-type')).toBe('application/json');
        rewriteCalls.push(JSON.parse(init?.body as string) as { text: string; direction: string });
        const answer = answers.shift();
        if (answer === undefined) {
          throw new Error('unexpected /api/rewrite call');
        }
        if ('reject' in answer) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve(json(answer.status, answer.body));
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  );
  vi.stubGlobal('fetch', fetchMock);

  // The markup without its script tag; the script is run explicitly below, as the browser would.
  const inner = /<html[^>]*>([\s\S]*)<\/html>/.exec(HTML)?.[1] ?? '';
  document.documentElement.innerHTML = inner.replace(/<script[^>]*><\/script>/, '');
  // Same global context as the test, where vitest put jsdom's `document` and `window`.
  runInThisContext(APP, { filename: 'app.js' });

  const textarea = byId('text') as HTMLTextAreaElement;
  const form = byId('rewrite-form') as HTMLFormElement;
  const button = byId('rewrite') as HTMLButtonElement;
  const counter = byId('counter');
  const result = byId('result');

  return {
    textarea,
    form,
    button,
    counter,
    result,
    rewriteCalls: () => rewriteCalls,
    async submit(direction, text) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      (query(document, `input[value="${direction}"]`) as HTMLInputElement).checked = true;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(result.getAttribute('data-status')).not.toBe('loading');
        expect(result.getAttribute('data-status')).not.toBeNull();
      });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = '';
});

describe('served markup', () => {
  it('has a text box, the two directions, one Rewrite button and no copy control of its own', () => {
    expect(HTML).toContain('<textarea');
    expect(HTML).toContain('value="formalise"');
    expect(HTML).toContain('value="beautify"');
    expect(HTML.match(/<button/g)).toHaveLength(1);
    expect(HTML).toMatch(/<button[^>]*type="submit"/);
    expect(HTML).not.toMatch(/copy/i);
    expect(HTML).not.toMatch(/<script[^>]*>[^<]/);
  });
});

describe('Formalise on the page', () => {
  it('shows original and result side by side, marks and lists additions with the invented reason apart, flags missing substance, and offers Copy', async () => {
    const page = loadPage([{ status: 200, body: FORMALISE_BODY }]);
    await page.submit('formalise', FORMALISE_IN);

    expect(page.rewriteCalls()).toEqual([{ text: FORMALISE_IN, direction: 'formalise' }]);
    expect(page.result.getAttribute('data-direction')).toBe('formalise');
    expect(page.result.getAttribute('data-status')).toBe('ready');
    expect(page.result.querySelector('[data-testid="formalise-original"]')?.textContent).toBe(
      FORMALISE_IN,
    );
    const resultPane = page.result.querySelector('[data-testid="formalise-result"]');
    expect(resultPane?.textContent).toBe(FORMALISE_OUT);
    const marks = [...page.result.querySelectorAll('[data-testid="formalise-result"] mark')];
    expect(marks.map((m) => m.textContent)).toEqual([
      'Hi boss,',
      'due to the complexities of the tasks',
    ]);
    expect(marks.every((m) => m.getAttribute('data-added-by') === 'formalise')).toBe(true);
    expect(marks[1]?.classList.contains('tool-added--reasoning')).toBe(true);

    const reasoning = page.result.querySelector('[data-testid="formalise-reasoning"]');
    expect(reasoning?.textContent).toContain('Reason invented by Formalise');
    expect(reasoning?.textContent).toContain('due to the complexities of the tasks');
    const framing = page.result.querySelector('[data-testid="formalise-framing"]');
    expect(framing?.textContent).toContain('Hi boss,');
    expect(framing?.textContent).not.toContain('due to the complexities');

    const missing = page.result.querySelector('.missing[role="alert"]');
    expect(missing?.textContent).toContain('Missing from the professional version');
    expect(missing?.textContent).toContain('where got enough time');

    const copy = page.result.querySelector('[data-testid="formalise-copy"]');
    expect(copy).not.toBeNull();
    expect(copy?.textContent).toBe('Copy result');
    // The text box is exactly what was pasted.
    expect(page.textarea.value).toBe(FORMALISE_IN);
  });

  it('Copy puts the professional version, and only it, on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const page = loadPage([{ status: 200, body: FORMALISE_BODY }]);
    await page.submit('formalise', FORMALISE_IN);

    (query(page.result, '[data-testid="formalise-copy"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(FORMALISE_OUT);
    });
    await vi.waitFor(() => {
      expect(page.result.querySelector('.copy__status')?.textContent).toContain('Copied');
    });
    expect(page.textarea.value).toBe(FORMALISE_IN);
  });

  it('says when copying is not possible instead of pretending', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const page = loadPage([{ status: 200, body: FORMALISE_BODY }]);
    await page.submit('formalise', FORMALISE_IN);
    (query(page.result, '[data-testid="formalise-copy"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(page.result.querySelector('.copy__status')?.textContent).toContain(
        'Could not copy automatically',
      );
    });
  });
});

describe('Beautify on the page', () => {
  it('keeps their actual words visible, marks and lists what Formalise added, and has no copy or write-back control', async () => {
    const page = loadPage([{ status: 200, body: BEAUTIFY_BODY }]);
    await page.submit('beautify', BEAUTIFY_IN);

    expect(page.rewriteCalls()).toEqual([{ text: BEAUTIFY_IN, direction: 'beautify' }]);
    expect(page.result.getAttribute('data-direction')).toBe('beautify');
    expect(page.result.querySelector('[data-testid="beautify-original"]')?.textContent).toBe(
      BEAUTIFY_IN,
    );
    expect(page.result.querySelector('[data-testid="beautify-result"]')?.textContent).toBe(
      BEAUTIFY_OUT,
    );
    const marks = [...page.result.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual([
      'I really appreciate all that you have done for me so far',
      'knowing how amazing you are',
    ]);
    for (const mark of marks) {
      expect(mark.getAttribute('data-added-by')).toBe('formalise');
      expect(mark.getAttribute('title')).toBe('Added by Formalise');
    }
    const additions = page.result.querySelector('aside.additions');
    expect(additions?.getAttribute('aria-label')).toBe('Added by Formalise, not by them');
    expect(additions?.querySelectorAll('li')).toHaveLength(2);

    expect(page.result.querySelectorAll('button')).toHaveLength(0);
    expect(page.result.textContent).not.toMatch(/copy/i);
    expect(page.result.textContent).toContain('Shown here only. Nothing is written back.');
    expect(page.result.querySelector('.missing')).toBeNull();
    expect(page.textarea.value).toBe(BEAUTIFY_IN);
  });
});

describe('errors on the page', () => {
  it('shows the host error in plain words next to the untouched original', async () => {
    const message =
      'ANTHROPIC_API_KEY is not set. Export it in your shell or put it in a local .env file (never commit it). Nothing was sent. Nothing was changed; the selected text is untouched.';
    const page = loadPage([{ status: 503, body: { error: message, kind: 'no-key' } }]);
    await page.submit('formalise', FORMALISE_IN);

    expect(page.result.getAttribute('data-status')).toBe('error');
    expect(page.result.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(page.result.querySelector('[data-testid="formalise-original"]')?.textContent).toBe(
      FORMALISE_IN,
    );
    expect(page.result.querySelector('[data-testid="formalise-result"]')).toBeNull();
    expect(page.result.querySelectorAll('button')).toHaveLength(0);
    expect(page.textarea.value).toBe(FORMALISE_IN);
    expect(page.button.disabled).toBe(false);
  });

  it('explains an unreachable host and lets the user try again', async () => {
    const page = loadPage([{ reject: true }, { status: 200, body: FORMALISE_BODY }]);
    await page.submit('formalise', FORMALISE_IN);
    expect(page.result.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not reach the computer running this page',
    );
    expect(page.textarea.value).toBe(FORMALISE_IN);

    await page.submit('formalise', FORMALISE_IN);
    expect(page.result.getAttribute('data-status')).toBe('ready');
    expect(page.rewriteCalls()).toHaveLength(2);
  });

  it('does not call the host for empty text or text over the limit', async () => {
    const page = loadPage([], 10);
    await page.submit('beautify', '   ');
    expect(page.result.getAttribute('data-status')).toBe('error');
    expect(page.result.querySelector('[role="alert"]')?.textContent).toContain('Paste some text');
    expect(page.rewriteCalls()).toEqual([]);

    await vi.waitFor(() => {
      expect(page.counter.textContent).toContain('/ 10');
    });
    page.textarea.value = 'x'.repeat(11);
    page.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(page.counter.textContent).toBe('11 / 10');
    expect(page.counter.classList.contains('compose__counter--over')).toBe(true);
    expect(page.button.disabled).toBe(true);
    page.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(page.rewriteCalls()).toEqual([]);
    expect(page.textarea.value).toBe('x'.repeat(11));
  });
});
