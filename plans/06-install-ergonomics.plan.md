# 06 — Install ergonomics

Status: DONE
Depends on: 01

## Goal
A fresh clone installs and starts first time, on Windows included. Three hurdles were hit on
2026-09-18: PowerShell's execution policy refusing `npm.ps1`; npm 12 silently blocking esbuild's
(and, on older Electron, Electron's) postinstall scripts so `npm run dev` died with
`Error: Electron uninstall`; and cloning from an administrator shell into `C:\Windows\system32`.
This phase pre-approves the install scripts in the project, adds a doctor that names the exact
fix when the Electron or esbuild binary is missing, and documents the Windows path. Install and
setup ergonomics only; no app behaviour changes.

## Tasks
- [x] T1 — `allowScripts` in `package.json` approving `electron` and `esbuild`, name-only, per `npm help install-scripts` (npm 12.0.2). Test: `npx -y npm@12.0.2 install-scripts ls` prints "No packages with unreviewed install scripts."
- [x] T2 — `scripts/doctor.mjs`: `npm run doctor` and `postinstall` (`--postinstall`, warn only, exit 0). Checks Node vs `engines.node`, the Electron binary via `path.txt`/`dist` exactly as electron-vite resolves it without requiring `electron`, esbuild by running a transform, and the API key as a note. Skips Electron when `ELECTRON_SKIP_BINARY_DOWNLOAD` is set. Test: `npx vitest run test/doctor.test.ts`
- [x] T3 — End-to-end: in a worktree with no Electron binary, `npx electron-vite dev` throws `Error: Electron uninstall`; `npm run doctor` fails naming `node node_modules/electron/install.js`; after running it the doctor passes and electron-vite gets past that error. Test: the sequence above, recorded in the Log
- [x] T4 — README: `npm run doctor` in Setup, a Windows subsection (non-admin shell in a user folder, execution policy or `npm.cmd`, `$env:ANTHROPIC_API_KEY` or `.env`), and a Troubleshooting section with the `Electron uninstall` entry. Test: each of the three hurdles in the captain's report has a matching instruction; commands quoted from the captain's session and npm's docs
- [x] T6 — `.env` actually loads: `src/main/env.ts`, called first thing in `src/main/index.ts`; project root in development, user-data then beside the executable when packaged; real environment wins; missing file fine; the empty-value-with-quoted-key-on-next-line shape is named in the log and by `npm run doctor`. README and `.env.example` say one line, no quotes. Test: `npx vitest run src/main/env.test.ts`
- [x] T5 — CI stays green: postinstall runs under `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` and exits 0. Test: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm run check`

## Follow-ups
- Walk the README Windows subsection on a real fresh Windows clone; this phase was built and
  tested on Linux, and the Windows commands are taken from the captain's session, not re-run.
- `ELECTRON_SKIP_BINARY_DOWNLOAD` is honoured by the doctor and by CI's intent, but Electron 44's
  own `install.js` no longer reads it (no postinstall to skip). Harmless today; revisit if the
  Electron package restores a postinstall.
- `npm install-scripts prune` would drop the `electron` entry, since electron 44.4.2 has no
  install script (it was removed between 39.x and 44.0.0). The entry is kept deliberately so an
  Electron with a postinstall is covered. Do not run `prune` casually.
- The doctor could offer to run Electron's installer itself rather than print the command; kept
  to printing because a 100 MB download as a side effect of `npm install` is a policy choice
  above this phase.

## Log
- 2026-09-18 — Research, against npm's own docs (tarball of npm@12.0.2, `docs/content/commands/
  npm-install-scripts.md`, `using-npm/config.md`, `lib/utils/resolve-allow-scripts.js`):
  dependency install scripts are blocked by default since **npm 12.0.0 (2026-07-08)**, listed
  under Breaking Changes: "Dependency lifecycle scripts are now blocked by default unless allowed
  by the root package's `allowScripts` policy". The `allowScripts` field and the
  `approve-scripts`/`deny-scripts` commands arrived opt-in in 11.17.0, were namespaced as
  `npm install-scripts` in 11.18.0. Precedence: `--allow-scripts` CLI/env (rejected in project
  installs) > `package.json#allowScripts` > `.npmrc allow-scripts`. Entries are `pkg: true`
  (any version), `pkg@1.2.3: true` (pinned), `pkg: false` (denied); semver ranges and dist-tags
  are ignored with a warning. The root project's own scripts are never gated, so the postinstall
  doctor runs. Chosen: name-only entries, because versions are already pinned by the lockfile and
  a pinned approval silently lapses on every bump, recreating the exact hurdle.
- 2026-09-18 — Finding: electron 44.4.2 ships no `postinstall` at all (39.x still had
  `node install.js`); its binary is fetched only when `require('electron')` runs, which
  electron-vite never does. So `Error: Electron uninstall` hits every fresh clone regardless of
  npm version unless something runs `node_modules/electron/install.js`. Under npm 12.0.2 here,
  `install-scripts ls` listed only `esbuild@0.25.12` and `esbuild@0.28.2` as blocked; after
  adding `allowScripts`, "No packages with unreviewed install scripts."
- 2026-09-18 — Reproduction at the boundary (Rule 4): `npx electron-vite dev` in this worktree
  → `Error: Electron uninstall` at `getElectronPath`. Then the fix sequence for T3 (see the
  later entry).
- 2026-09-18 — Spot-check (start of session): 01/T3 `npm run check && npm run build`
  deferred until after `npm ci`, because typecheck failed in untouched files against a stale
  worktree `node_modules` while CI on `main` is green; result recorded below.
- 2026-09-18 — Firstmate relayed a fourth hurdle from the captain's live run: README and
  `MissingApiKeyError` both say the key can live in `.env`, but nothing loaded it. Added
  `src/main/env.ts` on Node built-ins (`util.parseEnv`, the parser behind `node --env-file`,
  present in Node 22+, which Electron 44 embeds) rather than the `dotenv` package: no new
  dependency, identical quoting rules to `--env-file`, and the load is a plain file read so it
  can take an explicit target environment in tests. `process.loadEnvFile` was rejected because
  it writes straight to `process.env` and throws on a missing file, which made the precedence
  test indirect. Verified in Node 22.22.1 that the real environment wins and that a missing file
  is `ENOENT`. The captain's first `.env` had `ANTHROPIC_API_KEY=` on one line and the quoted key
  on the next; `parseEnv` reads that as empty and drops the orphan line, so both the loader and
  the doctor now name that shape.
- 2026-09-18 — T3 end to end, on this Linux worktree: `npx electron-vite dev` → `Error: Electron
  uninstall`; `npm run doctor` → exit 1, `[FAIL] Electron ... fix: node
  node_modules/electron/install.js`; ran that command (about 1 s, the zip was cached);
  `npm run doctor` → all ok, exit 0; `npx electron-vite dev` → built main, preload, renderer,
  "starting electron app...", then Electron itself failed on the missing `libnspr4.so` of a
  headless box, which is past the boundary this phase owns.
- 2026-09-18 — T5: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` ran the postinstall doctor
  (`[skip] Electron`, exit 0); `npm run check` and `npm run build` green with the variable set.
  Under npm 9.2.0 (this box) the postinstall also ran and printed the Electron fix, exit 0.
- 2026-09-18 — T6 caveat: the `.env` loader is proven by `src/main/env.test.ts` (precedence,
  missing file, quotes, the wrong shape) and is compiled into `out/main/index.js`; the app
  itself cannot start on this headless box, so "start the app with a `.env` and rewrite" is owed
  to the captain's next Windows run alongside the README walkthrough follow-up.
- 2026-09-18 — Spot-checks: start of session, 01/T3 `npm run check && npm run build` failed
  typecheck in two untouched files against a stale worktree `node_modules`; after `npm ci` it
  passed (lint, format, typecheck, 144 tests, build), so the task stays `[x]`. End of session,
  01/T5 `npx vitest run src/main/claude.test.ts`: 16 passed.
