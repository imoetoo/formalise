# 01 — Bootstrap

Status: IN_PROGRESS
Depends on: none

## Goal
Turn the empty repository into a project feature work can start in: the design of record,
agent rules, an Electron + React + TypeScript scaffold with lint, typecheck, tests and CI, stub
modules with the real signatures, and the §4 acceptance examples as fixtures. No real rewrite
logic and no network call.

## Tasks
- [x] T1 — `PLAN.md` in repo, byte-identical to the source except §7 (stack) and one dated §8 line. Test: `diff` against the source copy
- [x] T2 — `AGENTS.md` with the four standing rules, house rules and plan format; `CLAUDE.md` pointer. Test: `/home/useradmin/firstmate/bin/fm-ensure-agents-md.sh .` reports unchanged
- [x] T3 — Scaffold: electron-vite, React, strict TS, ESLint + Prettier, Vitest, npm lockfile. Test: `npm run check && npm run build`
- [ ] T4 — Main process registers two global shortcuts that log and open the review window. Test: `npm run dev`, press the hotkeys, window appears with the direction shown. Code in place and building; the named test needs a desktop with Electron's system libraries, which the bootstrap environment lacked. Owed as the first task of phase 02
- [x] T5 — `src/main/claude.ts` stub: `rewrite(text, direction)` reads `ANTHROPIC_API_KEY`, throws a clear error when absent, makes no network call. Test: `npx vitest run src/main/claude.test.ts`
- [x] T6 — `src/main/substanceCheck.ts` stub with signature and placeholder tests. Test: `npx vitest run src/main/substanceCheck.test.ts`
- [x] T7 — Review window skeleton: original and result side by side, Enter accept, Esc cancel, R retry. Test: `npx vitest run src/renderer/src/ReviewWindow.test.tsx`
- [x] T8 — Acceptance fixtures from `PLAN.md` §4 and a shape-only harness. Test: `npx vitest run test/acceptance.test.ts`
- [ ] T9 — CI workflow runs install, lint, format check, typecheck, test, build on push and PR. Test: green check on the bootstrap PR
- [x] T10 — README with setup and run instructions. Test: a fresh clone can follow it to `npm run dev`

## Follow-ups
Deliberately out of scope for this phase, each owned by a later phase:
- Any real Claude API call and prompt design (03).
- Selection capture and replacement via a native keystroke module; no robotjs/nut-js installed yet (02).
- Undo history / rolling buffer (04).
- Windows-specific hotkey handling and conflicts with other apps (02).
- Packaging and installers (no phase yet; add when v1 done-when is met).
- Wire the acceptance harness in `test/acceptance.test.ts` to the real engine (03).

## Log
- 2026-09-18 — Scaffold complete. Compatibility pins worth knowing: electron-vite 5 tops out at
  Vite 7 (not 8), so `@vitejs/plugin-react` is pinned to 5.x; typescript-eslint needs TypeScript
  below 6.1, so TypeScript is pinned `~5.9`; jsdom 29 rather than 30 for Node 22.13+. electron-vite
  does not minify by default; left as is.
- 2026-09-18 — End-of-session spot-check: re-ran T1 (`cmp` of PLAN.md prefix), T2
  (`fm-ensure-agents-md.sh` unchanged), and the four named vitest files (17 passed, 7 todo). All
  green. T4's manual hotkey test could not be run here: Electron fails to load `libnspr4.so` in the
  headless worktree and installing system libraries is outside the repo.
- 2026-09-18 — Phase opened. Stack decision recorded in `PLAN.md` §7/§8: Electron + React +
  TypeScript, Electron over Next.js because hotkeys and selection replacement need a desktop
  shell.
