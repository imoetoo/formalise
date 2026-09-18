# 04 — Review window

Status: IN_PROGRESS
Depends on: 02, 03

## Goal
The review window from 01 wired end to end for Formalise: shows original and rewrite, surfaces
substance-check flags and added reasoning, Enter replaces the selection, Esc leaves it
untouched, R retries. Adds the short rolling undo buffer (`PLAN.md` §1). Selection capture and
replacement go through an abstraction whose first implementation is clipboard-only (copy first,
paste after); simulated keystrokes stay in phase 02.

## Tasks
- [x] T1 — End-to-end Formalise flow: hotkey -> `readSelection()` -> `rewrite()` -> review window -> accept/cancel/retry over IPC, with the loading and error states. Test: `npx vitest run src/main/selection.test.ts src/renderer/src/formalise/FormaliseReview.test.tsx`
- [x] T2 — Substance flags (what went missing) and added reasoning marked as the tool's own in the window; Enter disabled while there is no result. Test: `npx vitest run src/renderer/src/formalise/FormaliseReview.test.tsx`
- [x] T3 — Rolling in-memory undo buffer; U in the window restores the previous text to the write path. Test: `npx vitest run src/main/undo.test.ts`
- [x] T4 — Hotkeys that do not collide with WhatsApp Web, Telegram Web or Outlook; user-configurable in `settings.json` under `app.getPath('userData')`, defaults written on first run, validated as Electron accelerators; a failed registration is shown in the review window naming the accelerator and the file. Test: `npx vitest run src/main/settings.test.ts`
- [x] T5 — README hotkey table and flow updated; `npm run check` and `npm run build` green. Test: `npm run check && npm run build`
- [ ] T6 — Desktop smoke test of the whole flow: `npm run dev`, copy Singlish text, press the Formalise hotkey, window shows loading then the result with flags and additions, Enter puts it on the clipboard, U restores the original, Esc closes; a deliberately colliding hotkey in `settings.json` is reported in the window. Needs a desktop with Electron's system libraries and an API key; the build environment has neither. Test: manual, as described

## Follow-ups
- Simulated Ctrl+C / Ctrl+V through a native module so the user need not copy and paste by hand (02/T1, 02/T2).
- Windows-specific hotkey behaviour, including AltGr layouts where Ctrl+Alt chords type characters (02/T3).
- Packaging and installers.
- Beautify side by side, prompt tuning and marked encouragement (05).
- Intensity levels (`PLAN.md` D3).

## Log
- 2026-09-18 — T1–T5 done, T6 owed (no display, no key here). Decisions: the Formalise flow is a
  controller (`src/main/formalise.ts`) mirroring Beautify's, injected with the selection adapter so
  it is unit-tested with a fake clipboard; a run counter stops a stale response from overwriting a
  newer retry; accept is refused until a result exists (mirrors the renderer's disabled Enter);
  after accept the window stays open showing the paste instruction and the undo hint, since with
  clipboard-only replacement the user must act; undo writes the previous original back to the
  clipboard and reports it. The renderer's Formalise view is its own component
  (`src/renderer/src/formalise/FormaliseReview.tsx`) with explicit `status` states idle / loading /
  ready / error / accepted; invented reasoning is rendered as a marked group above framing inside
  the one "Added by Formalise" aside. `ReviewPayload` and `ReviewDecision` were extended
  additively (`status`, `reasoning`, `canUndo`, `notice`, `hotkeys`; `undo`). Hotkey decision and
  the settings file: see plans/02 Log. Rebased onto the merged Beautify PR; Beautify now reads
  through `src/main/selection.ts` and `clipboardSelection.ts` is gone, as its notes intended.
