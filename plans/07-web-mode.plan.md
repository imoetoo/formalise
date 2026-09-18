# 07 — Web mode

Status: IN_PROGRESS
Depends on: 03, 06

## Goal
People without their own Claude API key can still use Formalise. The person who has the key
runs a small local web server (`npm run web`); anyone who can reach it opens the page in a
browser, pastes text into a text box, picks Formalise or Beautify and reviews the result with
the desktop semantics (`PLAN.md` §2, §3): original beside result, additions marked as the
tool's, missing substance flagged, Copy for Formalise only, never any write-back for Beautify.
The key stays on the host and is never sent to the browser; nothing pasted is stored or logged.
Boundary: a paste-box page over the existing engine. No accounts, no history, no new rewrite
behaviour, no change to the hotkey flow.

## Tasks
- [x] T1 — The engine is Electron-free and the web server imports it directly: `src/main/claude.ts`, `prompts/`, `substanceCheck.ts`, `errors.ts` and `env.ts` import nothing from `electron`, so no factoring was needed and the desktop is untouched. Test: `npm run build:web` bundles `src/web/cli.ts` for Node with the SDK as the only external, and `npx vitest run src/web/server.test.ts -t "desktop engine by default"` drives the real `rewrite()`
- [x] T2 — `src/web/server.ts`: one static page (`src/web/public/`) and one JSON endpoint, `POST /api/rewrite {text, direction}` → `{output, additions, additionDetails, reasoning, substance, segments, model}` by calling the same `rewrite()` (which runs the substance check) the desktop uses; `GET /api/config` publishes the input limit. Test: `npx vitest run src/web/server.test.ts`
- [x] T3 — Abuse limits so a shared page cannot burn the host's quota by accident: input ≤ 4000 characters, body ≤ 64 KiB refused before buffering, 6 rewrites per minute per client address (sliding window, `Retry-After`), at most 4 rewrites in flight, JSON bodies only, control characters rejected, and a same-origin check on `Origin` so another site cannot spend the quota through a visitor's browser. Test: `npx vitest run src/web/server.test.ts`
- [x] T4 — Engine errors mapped to HTTP statuses (`STATUS_FOR_KIND`) with the engine's own plain-words message; the page shows it beside the untouched original and never touches the text box. Test: `npx vitest run src/web/server.test.ts -t "maps every engine error"` and `npx vitest run src/web/page.test.ts -t "errors on the page"`
- [x] T5 — The key never leaves the host: read only from the server process environment handed to the engine, nothing in a request can substitute one, and every JSON byte sent is redacted of the key value as belt and braces; asserted over every served asset, the success body, every error body and all headers, with a deliberately leaky fake engine. Test: `npx vitest run src/web/server.test.ts -t "never leaves the host"`
- [x] T6 — The page (`index.html`, `app.js`, `styles.css`, plain JS, no build step, same-origin CSP): text area, Formalise / Beautify toggle, Rewrite button, result panel with original and result side by side, additions marked inline and listed as added by Formalise with invented reasoning louder, missing substance as a warning, Copy result for Formalise only, no copy or write-back control and the original always visible for Beautify, host errors in plain words. Test: `npx vitest run src/web/page.test.ts`
- [x] T7 — Entry points: `npm run web` (tsx, from source) and `npm run build:web` + `npm run web:start` (Vite SSR bundle in `out/web/`); default bind `127.0.0.1:8787`, `--host 0.0.0.0` or `FORMALISE_WEB_HOST` to expose, `--port` / `FORMALISE_WEB_PORT`; prints the reachable URLs, a sharing warning when exposed and a warning when the key is missing; `.env` loaded through the desktop's `src/main/env.ts`. Test: `npx vitest run src/web/options.test.ts src/web/server.test.ts -t "reachableUrls"` plus the curl sequence in the Log
- [x] T8 — No persistence: inputs and outputs are never written anywhere; the request log carries method, path, status and duration only. Test: `npx vitest run src/web/server.test.ts -t "never logs the text"`
- [x] T9 — CI builds the web bundle (`npm run build:web` step in `.github/workflows/ci.yml`); `npm run check` and `npm run build` stay green. Test: `npm run check && npm run build && npm run build:web`
- [x] T10 — Docs: README "Web mode" (start, exposing on the network and the key-sharing caveat, the paste workflow), `PLAN.md` §8 note dated 2026-09-18, `AGENTS.md` pointer. Test: manual read
- [ ] T11 — Live smoke with a key and a browser: `npm run web`, open the page, paste the two `PLAN.md` §4 fixtures, Formalise then Beautify; the result matches the desktop review window, Copy works on `localhost`, and on a LAN address (not a secure context) the fallback copy or its honest failure message shows. Needs `ANTHROPIC_API_KEY` and a browser; neither exists on this box. Test: manual, as described

## Follow-ups
- Authentication (a shared passphrase at least) before anyone exposes this beyond a trusted LAN.
- HTTPS: plain http means the Clipboard API is unavailable on LAN addresses (the page falls back to a selection copy and says so when that fails too) and the text crosses the LAN in clear.
- Hosting outside the LAN, packaging, and a history / archive are all out of scope by design.
- Per-person quotas rather than per-address: everyone behind one NAT shares a rate-limit bucket.
- A Retry button on the page (the desktop has `R`); today the user presses Rewrite again.
- Reusing the renderer's React components for the page was considered and rejected: their keyboard model (Enter accepts, U undoes) and idle screen are desktop semantics, and a plain page keeps the build to one Vite SSR bundle plus three static files.
- `UNTOUCHED` says "the selected text is untouched", which reads slightly oddly on the web where nothing is selected; the page keeps the engine's message verbatim so both modes say the same thing.

## Log
- 2026-09-18 — Spot-check (start of session): 05/T1 `npx vitest run src/renderer/src/BeautifyView.test.tsx`: 14 passed.
- 2026-09-18 — Decisions. (1) No engine split: everything under `src/main` the web server needs is already free of Electron (`grep -rn "from 'electron'" src` names only `index.ts`, `hotkeys.ts`, `window.ts`, `selection.ts` and the preload), so `src/web/server.ts` imports `../main/claude` directly and the desktop is untouched; an `src/engine/` move would have been churn without a behaviour change. (2) The server segments the output (`segmentOutput`, moved from `BeautifyView.tsx` to `src/shared/segment.ts` and re-exported so the renderer and its tests are unchanged) and returns `segments`, so the page needs no bundler and no duplicated logic. (3) Plain HTML + JS page under a `default-src 'self'` CSP rather than a Vite-built React page: the renderer components carry desktop semantics (Enter accepts, U undoes, idle screen with hotkeys) that would be wrong here. (4) `tsx` for `npm run web` (Node cannot resolve the repo's extensionless imports on its own) and a Vite SSR build for `npm run web:start`; the static files are copied next to the bundle so `<module dir>/public` resolves in both modes. (5) Same-origin check on `Origin`: a browser sends it on every cross-origin request, so a page on another site cannot make a visitor's browser spend the host's quota; non-browser clients send none and pass, which is fine because they are already on the LAN. (6) Redaction of the key value from every JSON response as belt and braces, so the promise "the server's responses do not contain the key" holds even against a confused engine; tested with a fake engine that puts the key into its error and its output.
- 2026-09-18 — T7 curl sequence, `npx tsx src/web/cli.ts --port 18787` with no key: banner printed both URLs and the missing-key warning; `GET /` 200 with CSP, nosniff, no-store; `/app.js` and `/styles.css` with their types; `/../package.json` and `/%2e%2e/package.json` 404; `/api/config` `{"maxInputChars":4000,...}`; `POST /api/rewrite` with the §4 Formalise input → 503 `no-key` with the engine's message; `text/plain` body → 415; `Origin: http://evil.example` → 403. Then `npm run build:web` → `out/web/server.mjs` (56 kB, SDK external) + `out/web/public/`; `node out/web/server.mjs --host 0.0.0.0 --port 18788` listed `localhost` and the machine's LAN address with the sharing warning; `npm run build` afterwards left `out/web` in place; `--port abc` exits 2 with the message.
- 2026-09-18 — Firstmate relayed that the install-ergonomics PR merged (`plans/06-install-ergonomics.plan.md`, `src/main/env.ts`): rebased onto `main`, kept both sides' `package.json` scripts, renumbered this phase from 06 to 07, and replaced the CLI's `process.loadEnvFile` with the desktop's `loadDotEnv` so a host can run `npm run web` with a `.env` alone and gets the same wrong-shape diagnostics.
- 2026-09-18 — Two more firstmate relays from the captain's live test landed on this branch as
  engine tasks 03/T5 (optional `ANTHROPIC_WORKSPACE_ID` header and the workspace-scope 400 as a
  typed error; web mode maps the new kind to 503) and 03/T6 (`ANTHROPIC_BASE_URL` pass-through
  and `ANTHROPIC_MODEL` override; the web banner prints the effective model and endpoint).
  Details and decisions in `plans/03-claude-client.plan.md`.
- 2026-09-18 — Spot-check (end of session): 07/T6 `npx vitest run src/web/page.test.ts`: 8
  passed. `npm run check` (183 passed, 6 skipped live, 1 todo), `npm run build` and
  `npm run build:web` green on the rebased branch.
