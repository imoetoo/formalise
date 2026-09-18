# 02 — Hotkey and selection capture

Status: NOT_STARTED
Depends on: 01

## Goal
Pressing the Formalise or Beautify hotkey while text is selected in WhatsApp Web, Telegram Web
or Outlook captures that text and, for Formalise, replaces it on accept. Chooses and installs
the native keystroke module (deferred from 01). Covers Windows-specific hotkey handling.

## Tasks
- [ ] T0 — Run phase 01's hotkey smoke test on a desktop: `npm run dev`, press both hotkeys, review window shows the direction. Owed from 01/T4
- [ ] T1 — Capture selected text on hotkey via clipboard + simulated copy, restoring the clipboard after. Test: TBD
- [ ] T2 — Replace selection on accept via simulated paste. Test: TBD
- [ ] T3 — Hotkey conflicts and Windows behaviour. Defaults and configurability landed in 04/T4 (decision below); still owed here: AltGr layouts on Windows and a desktop check of the new chords in the three target apps. Test: manual, in WhatsApp Web, Telegram Web and Outlook

## Follow-ups
- Simulated Ctrl+C / Ctrl+V so the user need not copy before and paste after (T1, T2). The
  clipboard-only path in `src/main/selection.ts` is the interface to implement behind.

## Log
- 2026-09-18 — Hotkey decision (04/T4, on the owner's live-test report). The captain found that
  Ctrl+Shift+F opens WhatsApp Web's search-in-chat and Ctrl+Shift+B its block action, so both
  phase 01 defaults collided with the primary target app. Checked: WhatsApp Web binds Ctrl+Shift+F,
  Ctrl+Shift+B, Ctrl+Alt+/ (search all), Ctrl+Alt+Backspace, Ctrl+Alt+Shift+U/H/[/]; Outlook
  binds Ctrl+Alt+F (forward as attachment), which ruled out the suggested Ctrl+Alt+F; Telegram Web
  publishes no Ctrl+Alt chords; Microsoft advises against Ctrl+Alt chords in general because AltGr
  layouts type characters with them. Chosen defaults: CommandOrControl+Alt+Shift+F and
  CommandOrControl+Alt+Shift+B, a chord shape WhatsApp Web itself uses so it reaches the page, with
  F and B unbound in all three apps. Both are user-configurable in `settings.json`
  (`src/main/settings.ts`) and a registration failure is shown in the review window naming the
  chord and the file. Sources: WhatsApp Help Center keyboard shortcuts page, Microsoft Support
  "Keyboard shortcuts for Outlook", usethekeyboard.com Telegram list, Wikipedia "AltGr key".
