# 03 — Claude client and substance check

Status: NOT_STARTED
Depends on: 01

## Goal
Replace the stubs in `src/main/claude.ts` and `src/main/substanceCheck.ts` with a real Claude
API client, the two prompts, and a substance check that flags any ask, deadline, constraint,
number or stated position missing from the output (`PLAN.md` §2). Wire the acceptance harness
in `test/acceptance.test.ts` to the real engine so the §4 examples are judged automatically.

## Tasks
- [ ] T1 — Claude client over HTTPS, key from `ANTHROPIC_API_KEY`, clear errors on no key / no network / API error. Test: TBD
- [ ] T2 — Formalise and Beautify prompts; added reasoning surfaced distinctly (`PLAN.md` §4). Test: `test/acceptance.test.ts`
- [ ] T3 — Substance check implementation. Test: `src/main/substanceCheck.test.ts`

## Follow-ups

## Log
