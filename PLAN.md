# Formalise — plan

Status: DRAFT (2026-09-18) — scope agreed, not yet started

A desktop utility that sits between what you mean and what you send. Two hotkeys, two
directions.

## 1. Scope of v1

Exactly two features. Nothing else ships until both are good.

| Feature | Direction | What it does |
|---|---|---|
| **Formalise** | Outbound | Rewrites what *you* wrote — including swearing, bluntness and visible frustration — into professional language suitable for a manager. |
| **Beautify** | Inbound | Takes what your *boss* wrote and re-presents it in warmer, easier-to-absorb language, with encouragement added. |

Locked decisions (from the 2026-09-18 discussion):

- **Form:** global hotkey utility on selected text. Not a browser extension, not a
  WhatsApp/Telegram API client. It therefore works in WhatsApp Web, Telegram Web, their
  desktop clients, Outlook and Teams without knowing anything about any of them.
- **Engine:** Claude API.
- **History:** short rolling buffer for undo and comparing a few versions. No archive.
- **The tool never sends anything.** Every rewrite is reviewed by a human first.

## 2. The constraint both features share

**Register changes; substance does not.**

- Formalise must not soften a message into mush. *"This deadline is impossible, the scope
  doubled"* must not become *"I look forward to discussing the timeline."* The objection,
  the ask, the constraint and the deadline all survive.
- Beautify must not sedate a warning. *"This is unacceptable, fix it by Friday or we
  escalate"* must still read as serious and still carry Friday. A cushion is not a blindfold.

One substance check serves both: after rewriting, assert that every ask, deadline,
constraint, number and stated position in the input is still present in the output. Flag
what went missing rather than silently shipping it.

## 3. The two directions are not symmetrical

| | Formalise | Beautify |
|---|---|---|
| Whose words | Yours | Your boss's |
| Result | **Replaces** your text in the compose box | **Displayed beside** the original — never written back |
| Original | Recoverable via undo | Always shown; the boss's actual words stay visible |
| Added content | None. Nothing invented. | Encouragement may be added, but **clearly marked as the tool's, not theirs** |

The last row is the important one. If Beautify adds *"you've been doing well lately"* and
that blends into the boss's text, you will remember praise you never received. Added
encouragement is visually separate and attributed to the tool.

## 4. Worked examples — these are the acceptance tests

These two, supplied by the owner on 2026-09-18, define the voice. Any prompt change is
judged against them.

**Formalise** — colloquial Singlish in, formal English out:

> **In:** `wakao! where got enough time sia`
> **Out:** `Hi boss, Honestly, due to the complexities of the tasks, would you kindly allow
> me to take a while longer for this issue?`

**Beautify** — dismissive instruction in, warm request out, deadline intact:

> **In:** `i dont care you need to get this done by tomorrow`
> **Out:** `I really appreciate all that you have done for me so far, perhaps just a little
> bit more. I understand time might be tight, but knowing how amazing you are, would you
> kindly do this by tomorrow?`

Three things these examples establish:

1. **Input is often Singlish or heavy colloquial.** `wakao`, `sia`, `where got` — the model
   must read Singapore colloquial English natively, not treat it as noise. Test fixtures are
   written in the language actually used, never in tidy textbook English.
2. **Output may add framing.** A greeting, an acknowledgement, a softening clause and an
   explicit ask all appear that were not in the input. That is wanted.
3. **`tomorrow` survives Beautify.** The deadline outlives the warmth. This is the substance
   rule working.

### What additions are allowed

Refinement of §2, prompted by the examples above:

- **Allowed:** greetings, politeness scaffolding, acknowledgement, and turning an implied
  complaint into an explicit, polite ask.
- **Not allowed:** new facts, new commitments, new dates, or agreeing to something the input
  did not agree to.
- **Careful:** the Formalise example supplies a *reason* — "due to the complexities of the
  tasks" — that the input never stated. Invented justifications can be untrue and you own
  what you send, so the review step must surface added reasoning distinctly enough to catch
  before it goes out.

## 5. Open decisions

- **D1 — RESOLVED 2026-09-18.** Beautify reframes *and* adds encouragement, marked as the
  tool's own and never blended into the sender's words.
- **D2 — RESOLVED 2026-09-18.** No severity indicator. Beautifying the language is enough,
  provided the point still lands. The substance rule in §2 already guarantees the ask, the
  deadline and the stated position survive; the emotional temperature need not.
- **D3 — RESOLVED 2026-09-18.** One fixed register for v1, the one the §4 examples
  demonstrate: warm, deferential, fairly soft. Intensity levels are deferred until a real
  message is found that the single register handles badly.

## 6. Done-when

- Selecting text in WhatsApp Web, Telegram Web and Outlook and pressing the Formalise hotkey
  replaces it with a professional version, reviewable before it lands, undoable after.
- Beautify on a harsh message shows original and softened side by side, with any added
  encouragement marked as the tool's, and never modifies the source.
- A rewrite that drops an ask, a deadline or a stated position is flagged, both directions.
- No network, no API key, or an API error leaves the selected text untouched and says why.
- Nothing is ever sent by the tool.

## 7. Stack

Electron + React + TypeScript, built with electron-vite. Replaces the original Java 21 / Swing
plan (see §8, 2026-09-18).

- Global hotkeys: Electron `globalShortcut`, registered in the main process.
- Selection capture and replacement: Electron `clipboard` plus a native keystroke module,
  deferred until the hotkey path is proven; no native module is installed yet.
- Review window: React renderer, keyboard-first (Enter accept, Esc cancel, R retry).
- Claude API over plain HTTPS from the main process; key from `ANTHROPIC_API_KEY` in the
  environment, never in the repo.
- Tooling: strict TypeScript, ESLint + Prettier, Vitest, GitHub Actions CI.

## 8. Notes / decisions

- 2026-09-18 — Scope set to Formalise + Beautify. Browser-extension and messenger-API routes
  rejected: WhatsApp has no official personal-account API, and the unofficial libraries risk
  the account. Operating on selected text avoids the question entirely and covers more apps.
- 2026-09-18 — D1 resolved: Beautify adds clearly-marked encouragement. Owner supplied the two
  worked examples in §4; they are the acceptance tests and the source of the Singlish-input
  requirement.
- 2026-09-18 — D2 resolved: no severity marker; beautified language that still carries the
  point is sufficient. D3 resolved: one fixed register for v1, taken from the worked examples.
- 2026-09-18 — Stack changed from Java 21 / Swing to Electron + React + TypeScript, on the
  owner's request for a modern React/TypeScript stack. Electron chosen over Next.js because
  global hotkeys, clipboard/selection capture and text replacement need a desktop shell.
