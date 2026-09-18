# 03 — Claude client and substance check

Status: IN_PROGRESS
Depends on: 01

## Goal
Replace the stubs in `src/main/claude.ts` and `src/main/substanceCheck.ts` with a real Claude
API client, the two prompts, and a substance check that flags any ask, deadline, constraint,
number or stated position missing from the output (`PLAN.md` §2). Wire the acceptance harness
in `test/acceptance.test.ts` to the real engine so the §4 examples are judged automatically.

## Tasks
- [x] T1 — Claude client over HTTPS via `@anthropic-ai/sdk`, key from `ANTHROPIC_API_KEY`, one model constant (`claude-sonnet-5`), bounded timeout, typed errors for no key / no network / timeout / API error / malformed response; every error leaves the text untouched. Test: `npx vitest run src/main/claude.test.ts`
- [x] T2 — Prompts in `src/main/prompts/<direction>.ts`, selected by `Direction`. Formalise written fully; Beautify's prompt is phase 05's (`prompts/beautify.ts`) adapted in `prompts/beautifyAdapter.ts`. Structured output: rewrite + additions tagged framing/reasoning so added reasoning is surfaced distinctly (`PLAN.md` §4). Test: `npx vitest run src/main/prompts/prompts.test.ts`
- [x] T3 — Substance check: deterministic heuristic layer (numbers, deadlines, constraints, explicit asks, stated positions) plus verification of the model's self-reported substance items. Test: `npx vitest run src/main/substanceCheck.test.ts`
- [ ] T4 — Acceptance harness runs the §4 Formalise fixture through the real engine when `ANTHROPIC_API_KEY` is set, judged by substance survival and register (model judge + deterministic checks), skipped otherwise. Harness written and verified to skip without a key; it has not yet been run with a key (none available in the build environment), so the prompt is unproven against the live model. Test: `ANTHROPIC_API_KEY=... npx vitest run test/acceptance.test.ts test/beautify.acceptance.test.ts`

## Follow-ups
- Run both live acceptance tests with a key and record the verdicts here (T4).
- Beautify prompt tuning (05). Its adapter does not ask the model to self-report substance, so
  only the heuristic layer checks Beautify output; consider adding `carriedBy` there.
- Position lexicon and ask patterns will need growing from real messages; each addition gets a
  fixture in `substanceCheck.test.ts`.
- Intensity levels / alternative registers (`PLAN.md` D3, deferred).

## Log
- 2026-09-18 — T1–T3 done; T4's harness written but unrun live. End-of-session spot-check:
  re-ran T3 (`npx vitest run src/main/substanceCheck.test.ts`), 19 passed. `npm run check`
  (127 passed, 6 skipped live, 1 todo) and `npm run build` green.
- 2026-09-18 — Design decisions.
  Client: official `@anthropic-ai/sdk`, non-streaming `messages.create` with a strict JSON schema
  in `output_config.format` (structured outputs, not tool use, because the whole reply is the
  object), 60 s timeout, SDK default 2 retries, system prompt marked cacheable. Errors are a typed
  hierarchy in `src/main/errors.ts` (`RewriteError` with `kind` no-key / network / timeout / api /
  refused / malformed / unknown); every message ends with "the selected text is untouched". A
  `refusal` stop reason and a `max_tokens` cut-off are errors, never half a message. The key check
  is synchronous so a missing key throws before any connection is opened. The phase 01
  `NotImplementedError` was removed: nothing threw it and lint refuses deprecated imports.
  Prompts: `DirectionPrompt` = system + user wrapper + JSON schema + parser, one per direction,
  so Beautify keeps its own reply shape (`{output, additions: string[]}`) while Formalise returns
  `{rewrite, additions:[{kind: framing|reasoning, text}], substance:[{kind, text, carriedBy}]}`.
  Reasoning additions are surfaced separately in the window (PLAN.md §4 "Careful"). The Formalise
  prompt quotes the §4 example verbatim as the voice and carries a Singlish glossary.
  Substance check: a deterministic heuristic layer (numbers with number-word normalisation,
  deadlines with equivalence classes such as tmr/tomorrow and eod/end of day, quantity and absence
  constraints, explicit asks matched by content-word stems and synonym classes, stated positions
  by family lexicon such as time-shortage / impossible / scope / escalation) plus verification of
  the model's self-reported items: an item counts as carried only if its `carriedBy` phrase really
  occurs in the output. The layers are merged by union (missing if either says so), preferring a
  spurious flag over silently shipping a dropped ask. Emotional temperature ("i dont care",
  swearing) is deliberately not substance (PLAN.md §5 D2).
- 2026-09-18 — Start-of-session spot-check: no task in this phase is `[x]` yet, so re-ran phase
  01/T5 (`npx vitest run src/main/claude.test.ts`): 4 passed. Full `npm run check` green at
  baseline (17 passed, 7 todo). Phase opened.
