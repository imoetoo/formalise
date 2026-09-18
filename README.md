# Formalise

A desktop utility that sits between what you mean and what you send: two hotkeys, two directions. **Formalise** rewrites your own blunt or colloquial text into professional language; **Beautify** re-presents a harsh incoming message in warmer language, shown beside the original.

The v1 design of record is [PLAN.md](PLAN.md). Work is tracked per phase under [plans/](plans/00-INDEX.plan.md); the rules agents and humans work by are in [AGENTS.md](AGENTS.md).

## Status

Phase 01 (bootstrap) only. The hotkeys register and open the review window, but selection capture, the Claude client and the rewrite itself are stubs. Nothing is sent anywhere yet. See `plans/01-bootstrap.plan.md` for what is deliberately left out and which phase owns it.

## Stack

Electron + React + TypeScript, built with [electron-vite](https://electron-vite.org). Strict TypeScript, ESLint + Prettier, Vitest. Why Electron rather than a web framework: global hotkeys, clipboard/selection capture and replacing text in another app's compose box need a desktop shell (PLAN.md §7).

## Setup

Requirements: Node 22.13 or newer and npm. On Linux, Electron also needs the usual desktop libraries (`libnspr4`, `libnss3`, `libgtk-3-0`, `libasound2` and friends); a headless box will build and test but not run the app.

```sh
git clone https://github.com/imoetoo/formalise.git
cd formalise
npm install
```

The Claude API key is read from `ANTHROPIC_API_KEY` in the environment. Export it in your shell, or copy `.env.example` to `.env` (gitignored) and fill it in. Never commit a key. With no key the app refuses to rewrite and leaves your text untouched, saying why.

## Run

```sh
npm run dev      # Electron with hot reload
npm run build    # production bundles into out/
npm run start    # run the production build
```

Hotkeys (Electron accelerator syntax, defined in `src/shared/types.ts`):

| Action    | Hotkey                 |
| --------- | ---------------------- |
| Formalise | `Ctrl/Cmd + Shift + F` |
| Beautify  | `Ctrl/Cmd + Shift + B` |

In the review window: `Enter` accepts, `Esc` cancels, `R` retries. Enter does nothing while there is no result, so an empty rewrite can never replace your text.

## Develop

```sh
npm run check        # lint + format check + typecheck + tests, what CI runs
npm run lint
npm run format       # prettier --write
npm run typecheck
npm test             # vitest run
npm run test:watch
```

Layout:

- `src/main/` Electron main process: hotkeys, review window, Claude client stub, substance check stub.
- `src/preload/` the only bridge the renderer gets (`window.formalise`).
- `src/renderer/` React review window.
- `src/shared/` types and IPC channel names used on both sides.
- `test/fixtures/acceptance.json` the two PLAN.md §4 examples; `test/acceptance.test.ts` is the acceptance harness (shape-only until phase 03 wires the engine).

CI (`.github/workflows/ci.yml`) runs install, lint, format check, typecheck, tests and build on every pull request and on pushes to `main`.
