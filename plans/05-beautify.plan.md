# 05 — Beautify side by side

Status: IN_PROGRESS
Depends on: 01 (was 04; relaxed 2026-09-18 because the owner chose to run the Formalise and
Beautify directions in parallel. Beautify builds against the exported interface of
`src/main/claude.ts` and `src/main/substanceCheck.ts`, whose real implementations land with
phase 03 on the parallel branch.)

## Goal
Beautify shows the boss's original beside the softened version, never writes back, and marks
any added encouragement as the tool's own (`PLAN.md` §3). The §4 Beautify example passes with
`tomorrow` intact.

## Tasks
- [x] T1 — Side-by-side display, original always visible, never editable or overwritten. Test: `npx vitest run src/renderer/src/BeautifyView.test.tsx`
- [x] T2 — Added encouragement visually separate and attributed to the tool, both inline in the softer reading and as a labelled list. Test: `npx vitest run src/renderer/src/BeautifyView.test.tsx`
- [x] T3 — No write-back path exists for Beautify: the renderer has no accept action and never sends one; the main-process flow never writes the clipboard. Test: `npx vitest run src/main/beautify.test.ts src/renderer/src/BeautifyView.test.tsx`
- [x] T4 — Beautify prompt (`src/main/prompts/beautify.ts`): fixed warm, deferential register from §4; substance preserved; additions returned separately as verbatim spans of the output. Test: `npx vitest run src/main/prompts/beautify.test.ts`
- [x] T5 — Main-process hotkey path: read selection, show original at once, rewrite, substance-check, show result; errors leave the original visible and say why; R retries with the same original. Test: `npx vitest run src/main/beautify.test.ts`
- [x] T6 — Substance-check flags shown in the Beautify view when the report has missing items. Test: `npx vitest run src/renderer/src/BeautifyView.test.tsx`
- [ ] T7 — Live acceptance for the §4 Beautify fixture: `tomorrow` survives, register is warm by
  rubric, additions are verbatim spans. Runs only with `ANTHROPIC_API_KEY`; skipped otherwise, and
  skipped with a note while the engine is the phase 01 stub. Test written; it has not yet run
  against a real engine. Test: `ANTHROPIC_API_KEY=... npx vitest run test/beautify.acceptance.test.ts`
- [ ] T8 — Desktop smoke: `npm run dev`, copy a harsh message, press Ctrl/Cmd+Shift+B, the window
  shows the original beside the softer reading with additions marked; Esc closes, R retries,
  Enter does nothing, the clipboard is unchanged afterwards. Needs a desktop with Electron's
  system libraries and an API key. Test: manual, as described

## Follow-ups
- Severity indicator and intensity levels: deferred by D2/D3 in `PLAN.md` §5.
- Formalise flow, Claude client internals and the substance-check implementation: phase 03/04 on the parallel branch.
- Native keystroke simulation for selection capture: phase 02.
- Packaging.
- (done 2026-09-18 on the Formalise branch) `readSelection` now comes from `src/main/selection.ts`; `clipboardSelection.ts` deleted.

## Log
- 2026-09-18 — From the Formalise branch: the real client now drives Beautify through
  `src/main/prompts/beautifyAdapter.ts` (this phase's prompt and reply schema unchanged; the
  additions map to kind `framing`). `test/beautify.acceptance.test.ts` no longer needs its
  stub-skip and runs whenever a key is present; it has not yet been run with one.
- 2026-09-18 — T1–T6 implemented and green: `npm run check` (51 tests passed, 5 live tests
  skipped, 7 todo) and `npm run build`. `test/beautify.acceptance.test.ts` verified to skip,
  not fail, with a key present against the stub engine. Electron 44's `clipboard` API is
  promise-based, so `readSelection` is async; the swap to `src/main/selection.ts` should keep
  that. A visual check of the built renderer through a harness page was attempted but no
  browser is available on this machine (the devtools bridge could not attach and no Chrome
  binary exists), so the DOM assertions in `BeautifyView.test.tsx` are the evidence for now
  and T8 owes the desktop smoke test.
- 2026-09-18 — Phase opened. Spot-check ritual: no task in this phase was marked `[x]` yet, so
  the baseline was phase 01/T3 (`npm run check && npm run build`) on a fresh `npm ci`; result
  recorded below. Dependency relaxed from 04 to 01 (see header). Decisions: the Beautify view
  is its own component (`BeautifyView.tsx`) that `ReviewWindow` delegates to, so no caller can
  render a Beautify payload with an accept action; additions are shown twice, inline as marked
  spans in the softer reading and as a separate list, both labelled as Formalise's; the review
  payload gains an optional `missing` list so the substance report reaches the renderer without
  the renderer importing main-process code.
