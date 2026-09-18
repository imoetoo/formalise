# Formalise — agent memory

Project-intrinsic knowledge for any agent working in this repo. The v1 design of record is
`PLAN.md`; its §4 worked examples are the acceptance tests and live as fixtures in
`test/fixtures/acceptance.json`. Read `PLAN.md` before changing behaviour.

## Standing rules

1. **Track everything in plan files.** All work is tracked in per-phase files
   `plans/NN-<slug>.plan.md`, listed in `plans/00-INDEX.plan.md`. No work happens that is not
   a task in a phase file. Format is defined below.
2. **Spot-check ritual.** At the start and end of every session, pick one task already marked
   `[x]` in the current phase, re-run its named test, and record the result in that phase's
   Log. If it fails, flip the task back to `[ ]` before doing anything else.
3. **Technical decisions ignore development cost.** Rank: correctness > robustness >
   performance > operability. Never pick the cheaper option because it is cheaper.
4. **Bug fixes start with an end-to-end reproduction.** Reproduce at the boundary the user
   hits (hotkey, review window, or the acceptance harness) before touching code, and never
   ship a fix on a unit test alone.

## House rules

- Never commit an API key. `ANTHROPIC_API_KEY` comes from the environment; `.env` is
  gitignored. See `src/main/claude.ts`.
- The tool never sends anything. Every rewrite passes through the review window first.
- Register changes, substance does not (`PLAN.md` §2). Any prompt or engine change is judged
  against the §4 examples via the acceptance harness in `test/acceptance.test.ts`.
- Fixtures are written in the language actually used (Singlish, colloquial), never tidied
  into textbook English.
- Beautify never writes back; added encouragement is always attributed to the tool
  (`PLAN.md` §3).
- No native modules (robotjs, nut-js) until the hotkey path is proven; see
  `plans/02-hotkey-selection.plan.md`. Until then capture and replacement are clipboard-only
  through `src/main/selection.ts`; Beautify is handed only its read half.
- Hotkey defaults avoid chords WhatsApp Web, Telegram Web and Outlook bind; the record of what
  was checked is in `plans/02-hotkey-selection.plan.md`. Users override them in `settings.json`
  (`src/main/settings.ts`).

## Plan file format

Each `plans/NN-<slug>.plan.md`:

```
# NN — <Phase name>

Status: NOT_STARTED | IN_PROGRESS | DONE
Depends on: <phase numbers or none>

## Goal
One paragraph.

## Tasks
- [ ] T1 — <task>. Test: `<exact command or test name>`
- [x] T2 — <task>. Test: `<exact command or test name>`

## Follow-ups
Things noticed but deliberately out of scope for this phase.

## Log
- YYYY-MM-DD — <what happened, spot-check results, decisions>
```

`plans/00-INDEX.plan.md` lists every phase with its Status and one line of scope. Update the
index whenever a phase's Status changes.

## Build, test, run

- Commands: see `scripts` in `package.json`. `npm run check` runs lint, format check,
  typecheck and tests, which is what CI runs (`.github/workflows/ci.yml`).
- Layout: `src/main` (Electron main: hotkeys, settings, window, Claude client in `claude.ts`,
  one prompt per direction in `prompts/`, substance check, the two flows in `formalise.ts` and
  `beautify.ts`, selection abstraction in `selection.ts`), `src/preload` (IPC bridge),
  `src/renderer` (React review window, one component per direction), `src/shared` (types and
  IPC channel names used on both sides), `test/` (fixtures and the acceptance harnesses).
- The model is named once, `DEFAULT_MODEL` in `src/main/claude.ts`. Every engine error is a
  `RewriteError` from `src/main/errors.ts`; callers show its message and touch nothing.
- Live acceptance tests need `ANTHROPIC_API_KEY` and skip without it; CI has no key, so a prompt
  change is only proven by running them locally with a key and recording the result in the
  phase log.
- Unit tests sit next to the code as `*.test.ts(x)`. Renderer tests declare
  `// @vitest-environment jsdom` at the top of the file.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
