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
- [ ] T3 — Hotkey conflicts and Windows behaviour. Test: TBD

## Follow-ups

## Log
