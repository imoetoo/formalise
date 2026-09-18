# Formalise

A desktop utility that sits between what you mean and what you send: two hotkeys, two directions. **Formalise** rewrites your own blunt or colloquial text into professional language; **Beautify** re-presents a harsh incoming message in warmer language, shown beside the original.

The v1 design of record is [PLAN.md](PLAN.md). Work is tracked per phase under [plans/](plans/00-INDEX.plan.md); the rules agents and humans work by are in [AGENTS.md](AGENTS.md).

## Status

Both directions run end to end against the real Claude API (`claude-sonnet-5` by default, one constant in `src/main/claude.ts`, overridable with `ANTHROPIC_MODEL`). Formalise: copy your text, press the hotkey, review the professional version with any dropped substance flagged and any invented reasoning called out, press Enter to put it on your clipboard, paste it, U to undo. Beautify: copy the message you received, press its hotkey, read it beside the softer version; nothing is written back.

Selection capture is clipboard-only for now: you copy before the hotkey and paste after accepting. Simulated Ctrl+C / Ctrl+V through a native module is phase 02. Nothing is ever sent by the tool. See `plans/` for what each phase owns and what is deliberately left out.

## Stack

Electron + React + TypeScript, built with [electron-vite](https://electron-vite.org). Strict TypeScript, ESLint + Prettier, Vitest. Why Electron rather than a web framework: global hotkeys, clipboard/selection capture and replacing text in another app's compose box need a desktop shell (PLAN.md §7).

## Setup

Requirements: Node 22.13 or newer and npm. On Linux, Electron also needs the usual desktop libraries (`libnspr4`, `libnss3`, `libgtk-3-0`, `libasound2` and friends); a headless box will build and test but not run the app.

```sh
git clone https://github.com/imoetoo/formalise.git
cd formalise
npm install
npm run doctor
```

`npm run doctor` (also run automatically at the end of `npm install`) checks that Node is new
enough and that the Electron and esbuild binaries are actually present, and prints the exact
command to run for anything that is not. Fix what it reports before `npm run dev`.

Two things about dependencies that the doctor covers. Electron 44 no longer downloads its binary
in a postinstall step; if it is missing, `npm run dev` dies with the unhelpful
`Error: Electron uninstall`, and the fix is `node node_modules/electron/install.js`. Since npm 12,
dependency install scripts are blocked unless the project approves them; `package.json` does that
for `esbuild` and `electron` under `allowScripts`, so you should never see the
"packages had install scripts blocked" warning for this project (`npm help install-scripts`).

The Claude API key is read from `ANTHROPIC_API_KEY` in the environment. Export it in your shell, or copy `.env.example` to `.env` (gitignored) and fill it in; the app loads `.env` from the project folder at start-up (`src/main/env.ts`), and a value already set in the environment always wins over the file. Never commit a key. With no key the app refuses to rewrite and leaves your text untouched, saying why.

In `.env` the value must be on the same line as the name, and quotes are not needed:

```sh
ANTHROPIC_API_KEY=sk-ant-...
```

Not this, which reads as an empty key and is the shape a first install actually produced:

```sh
ANTHROPIC_API_KEY=
"sk-ant-..."
```

`npm run doctor` reads `.env` the same way the app does and points out that shape.

To use an Anthropic-compatible gateway instead of the API directly, set `ANTHROPIC_BASE_URL` to the gateway's base URL and `ANTHROPIC_API_KEY` to the key the gateway gave you; the client is built without a hard-coded URL, so the SDK simply sends requests there. The SDK appends `/v1/messages` itself, so the value is everything before `/v1`: for OpenCode Zen, whose Anthropic-compatible endpoint is `https://opencode.ai/zen/v1/messages`, that is `ANTHROPIC_BASE_URL=https://opencode.ai/zen`. If the gateway does not expose the default model id (`claude-sonnet-5`, the one constant in `src/main/claude.ts`), set `ANTHROPIC_MODEL` to the id it does expose. Both are optional and both go in the environment or in `.env`. The app and the web server print the effective model and endpoint at start-up.

If your key is an organisation-level key rather than one scoped to a workspace, the API rejects every request with `400 This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header`. Either create a workspace-scoped key in the Anthropic Console, or set `ANTHROPIC_WORKSPACE_ID` (in the environment or in `.env`, next to the key) to your workspace's id; the app then sends it as the `anthropic-workspace-id` header on every request. With a workspace-scoped key leave it unset.

### Windows

Use a normal (non-administrator) PowerShell or Terminal window, and clone into a folder you own,
such as `C:\Users\<you>\src`. An administrator shell opens in `C:\Windows\system32`; do not clone
there.

PowerShell may refuse to run `npm` at all with "npm.ps1 cannot be loaded because running scripts is
disabled on this system". That is PowerShell's execution policy blocking npm's `.ps1` shim. Either
allow locally created scripts for your user, once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

or call the batch shims instead, which the policy does not apply to: `npm.cmd install`,
`npm.cmd run dev`, `npx.cmd ...`.

Set the API key for the current PowerShell session:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
npm run dev
```

or copy `.env.example` to `.env` in the project folder and put the key there, which survives new
windows. `npm run doctor` tells you whether the key is visible.

## Run

```sh
npm run dev      # Electron with hot reload
npm run build    # production bundles into out/
npm run start    # run the production build
```

Default hotkeys (Electron accelerator syntax, defaults in `src/shared/types.ts`):

| Action    | Hotkey                       |
| --------- | ---------------------------- |
| Formalise | `Ctrl/Cmd + Alt + Shift + F` |
| Beautify  | `Ctrl/Cmd + Alt + Shift + B` |

Why not something shorter: WhatsApp Web owns `Ctrl+Shift+F` (search in chat) and `Ctrl+Shift+B` (block), and Outlook owns `Ctrl+Alt+F` (forward as attachment), so the obvious chords collide with the very apps the tool targets. On Windows keyboards that use AltGr, `Ctrl+Alt+<key>` chords can type characters; if yours does, change the hotkeys.

Hotkeys are configurable. On first run the app writes `settings.json` into Electron's user-data directory (Linux `~/.config/formalise/`, macOS `~/Library/Application Support/formalise/`, Windows `%APPDATA%\formalise\`):

```json
{
  "hotkeys": {
    "formalise": "CommandOrControl+Alt+Shift+F",
    "beautify": "CommandOrControl+Alt+Shift+B"
  }
}
```

Values must be Electron accelerators with at least one modifier. An invalid value falls back to the default, and a hotkey another application already owns is reported in the review window together with the path of the file to edit. Restart after editing.

Flow, Formalise: select your text and copy it (`Ctrl/Cmd+C`), press the hotkey, review. `Enter` copies the professional version to your clipboard for pasting, `Esc` cancels, `R` retries, `U` undoes the last accepted rewrite (the last five are kept in memory). Enter does nothing while there is no result, so an empty rewrite can never replace your text. The window flags substance the rewrite dropped (an ask, deadline, constraint, number or stated position) and lists everything the tool added, with any invented reason marked separately.

Flow, Beautify: copy the message you received, press the hotkey, read the softer version beside the original. `Esc` closes, `R` retries; there is no accept and nothing is written back.

## Web mode

For people who do not have their own Claude API key. The person who has the key runs a small web server on their machine; anyone who can reach it opens the page in a browser, pastes text into the box, picks Formalise or Beautify and reviews the result. The key stays on the host and is never sent to the browser. Nothing pasted is stored or logged.

Start it from source, or build once and run the bundle:

```sh
npm run web                          # from source, http://127.0.0.1:8787
npm run build:web && npm run web:start   # built bundle in out/web/
```

The server prints the URLs it is reachable at. By default it binds `127.0.0.1`, so only your own browser can reach it. To share it with other people on your network:

```sh
npm run web -- --host 0.0.0.0        # or FORMALISE_WEB_HOST=0.0.0.0
npm run web -- --port 9000           # or FORMALISE_WEB_PORT=9000
```

Exposing it means everyone who can reach that address rewrites with your `ANTHROPIC_API_KEY` and your quota. There is no login: do this only on a network you trust, and stop the server (`Ctrl+C`) when you are done. The key (and `ANTHROPIC_WORKSPACE_ID`, `ANTHROPIC_BASE_URL` or `ANTHROPIC_MODEL` if you need them; see Setup) is read from your environment or your `.env` with the same loader as the desktop app; the page and its script never see it, and every response is checked so the key value cannot appear in it. To keep one shared page from burning the quota by accident, the server accepts at most 4000 characters per request, 6 rewrites a minute per device and 4 rewrites in flight at once, and it refuses requests that another web page tried to make through a visitor's browser.

The paste workflow: paste your message into the text box, choose **Formalise** (your own words, made professional) or **Beautify** (a message you received, read softer), press **Rewrite**. The result appears beside your original with the same review as the desktop window: substance the rewrite dropped is flagged in red, everything Formalise added is marked and listed as its own, and an invented reason is called out louder than a greeting. For Formalise, **Copy result** puts the professional version on your clipboard for pasting (on a plain-http LAN address the browser may refuse; the page then says so and you select and copy by hand). For Beautify there is no copy and nothing is written back: their actual words stay on the left. If the host has no key, cannot reach the API, or the API errors, the page says so in plain words and your text in the box is left exactly as you pasted it.

Limits and things deliberately left out (authentication, HTTPS, hosting outside your network, history) are recorded in `plans/07-web-mode.plan.md`.

## Troubleshooting

**`Error: Electron uninstall` from `npm run dev`.** electron-vite could not find
`node_modules/electron/path.txt`, which means Electron's binary was never downloaded (Electron 44
fetches it lazily, and nothing in `npm install` triggers that). Run:

```sh
node node_modules/electron/install.js
npm run doctor
```

The doctor should then report the binary (`node_modules/electron/dist/electron.exe` on Windows,
`dist/electron` on Linux, `dist/Electron.app` on macOS). If the download itself fails, check
proxy or firewall settings; `@electron/get` honours `HTTPS_PROXY`.

**"packages had install scripts blocked because they are not covered by allowScripts".** Your npm is
12 or newer and a dependency with an install script is not approved in `package.json`. For this
project `esbuild` and `electron` already are; if the warning names another package, review it and
run `npm install-scripts approve <pkg>` then `npm rebuild <pkg>`.

**`npm run doctor` reports esbuild failing.** Run `npm rebuild esbuild`.

**The app says your key "is an organisation-level key that is not scoped to a workspace".** The API
answered `400 ... must include the anthropic-workspace-id header`. Create a workspace-scoped key in
the Anthropic Console and use that, or set `ANTHROPIC_WORKSPACE_ID` to the workspace's id (shell or
`.env`) and restart. Nothing was sent and your text was left untouched.

**The app says `ANTHROPIC_API_KEY is not set` although `.env` exists.** Open `.env`: the key must be
on the same line as `ANTHROPIC_API_KEY=`, with no quotes and nothing on the following line. In
development the file is the one in the project folder (where `package.json` is); a packaged build
looks in its user-data directory and then next to the executable. `npm run doctor` shows what it
found.

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

- `src/main/` Electron main process: `claude.ts` (Claude client), `prompts/` (one prompt per direction), `substanceCheck.ts`, `selection.ts` (clipboard-backed capture and write path), `formalise.ts` and `beautify.ts` (the two flows), `undo.ts`, `settings.ts`, `hotkeys.ts`, `window.ts`.
- `src/preload/` the only bridge the renderer gets (`window.formalise`).
- `src/renderer/` React review window: `formalise/FormaliseReview.tsx` and `BeautifyView.tsx`.
- `src/shared/` types and IPC channel names used on both sides, and `segment.ts`, the addition marker both the renderer and the web server use.
- `src/web/` web mode: `server.ts` (the HTTP server and `POST /api/rewrite` over the same engine), `cli.ts` (`npm run web`), `public/` (the paste-box page, plain HTML/JS/CSS served as-is). Bundled by `vite.web.config.ts` into `out/web/` for `npm run web:start`.
- `test/fixtures/acceptance.json` the two PLAN.md §4 examples. `test/acceptance.test.ts` and `test/beautify.acceptance.test.ts` run them through the real engine when `ANTHROPIC_API_KEY` is set and skip otherwise, judging substance survival and register rather than exact text.

CI (`.github/workflows/ci.yml`) runs install, lint, format check, typecheck, tests, the Electron build and the web-mode build on every pull request and on pushes to `main`.
