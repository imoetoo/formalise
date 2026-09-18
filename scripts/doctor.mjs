#!/usr/bin/env node
// Install doctor: checks that a fresh clone can actually run `npm run dev`, and prints the
// exact fix for each thing that is wrong. Plain Node so it works before any build step.
//
// Runs two ways (see `scripts` in package.json):
//   npm run doctor    - report and exit 1 on any failure
//   postinstall       - `--postinstall`: same report, always exit 0, so a broken Electron
//                       binary is explained at install time rather than as electron-vite's
//                       opaque "Error: Electron uninstall" at dev time.
//
// Background. Electron 44 no longer ships a postinstall script; its binary is only fetched
// when something calls `require('electron')`, which electron-vite never does: it resolves
// `node_modules/electron/path.txt` itself and throws "Electron uninstall" when it is absent.
// Since npm 12 dependency install scripts are also blocked unless `allowScripts` in
// package.json approves them; esbuild's is approved there. The checks below mirror exactly
// what electron-vite and esbuild look for, without triggering a download.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const postinstall = process.argv.includes('--postinstall');
const projectDir = process.cwd();
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

/** @type {{ name: string, status: 'ok' | 'skip' | 'warn' | 'fail', detail: string, fix?: string }[]} */
const results = [];
const record = (name, status, detail, fix) => results.push({ name, status, detail, fix });

const requireFromProject = createRequire(path.join(projectDir, 'package.json'));
const resolvePackageDir = (name) => {
  try {
    return path.dirname(requireFromProject.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));

// 1. Node version against engines.node (">=X.Y" form only; anything else is left to npm).
function checkNode() {
  let wanted;
  try {
    wanted = readJson(path.join(projectDir, 'package.json')).engines?.node;
  } catch {
    record(
      'package.json',
      'fail',
      `no readable package.json in ${projectDir}`,
      'run this from the project root',
    );
    return;
  }
  const match = /^>=\s*(\d+)(?:\.(\d+))?/.exec(wanted ?? '');
  if (!match) {
    record('Node', 'skip', `engines.node "${wanted ?? ''}" is not a ">=X.Y" range`);
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  const wantMajor = Number(match[1]);
  const wantMinor = Number(match[2] ?? 0);
  const ok = major > wantMajor || (major === wantMajor && minor >= wantMinor);
  record(
    'Node',
    ok ? 'ok' : 'fail',
    `running ${process.versions.node}, project wants ${wanted}`,
    ok ? undefined : `install Node ${wantMajor}.${wantMinor} or newer from https://nodejs.org`,
  );
}

// 2. Electron binary, resolved the way electron-vite does it. Never require('electron'):
//    that would start the download as a side effect.
function checkElectron() {
  const dir = resolvePackageDir('electron');
  if (!dir) {
    record('Electron', 'fail', 'node_modules/electron is missing', `${npmCmd} install`);
    return;
  }
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    record('Electron', 'skip', 'ELECTRON_SKIP_BINARY_DOWNLOAD is set; binary not expected (CI)');
    return;
  }
  const fix = `node ${path.join('node_modules', 'electron', 'install.js')}`;
  const version = readJson(path.join(dir, 'package.json')).version;
  const pathFile = path.join(dir, 'path.txt');
  if (!fs.existsSync(pathFile)) {
    record(
      'Electron',
      'fail',
      `electron@${version} is installed but its binary was never downloaded (no path.txt), so ` +
        '`npm run dev` fails with "Error: Electron uninstall"',
      fix,
    );
    return;
  }
  const relative = fs.readFileSync(pathFile, 'utf-8');
  const binary = path.join(dir, 'dist', relative);
  if (!fs.existsSync(binary)) {
    record('Electron', 'fail', `path.txt points at ${binary}, which does not exist`, fix);
    return;
  }
  let distVersion = '';
  try {
    distVersion = fs
      .readFileSync(path.join(dir, 'dist', 'version'), 'utf-8')
      .trim()
      .replace(/^v/, '');
  } catch {
    // an older dist layout; the binary exists, which is what electron-vite needs
  }
  if (distVersion && distVersion !== version) {
    record('Electron', 'fail', `binary is ${distVersion} but package is ${version}`, fix);
    return;
  }
  record('Electron', 'ok', `${version} binary at ${binary}`);
}

// 3. esbuild binary, by asking esbuild itself to transform one expression. With install
//    scripts blocked, esbuild still works from its platform package, so this is a real check
//    rather than a guess about whether postinstall ran; when the binary is missing esbuild's
//    own error is shown, and the fix is to rebuild it (its script is approved in allowScripts).
function checkEsbuild() {
  const dir = resolvePackageDir('esbuild');
  if (!dir) {
    record('esbuild', 'fail', 'node_modules/esbuild is missing', `${npmCmd} install`);
    return;
  }
  const version = readJson(path.join(dir, 'package.json')).version;
  const probe =
    "const e = require('esbuild'); e.transformSync('1 + 1'); process.stdout.write(e.version);";
  const run = spawnSync(process.execPath, ['-e', probe], {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  const reported = (run.stdout ?? '').trim();
  if (run.status === 0 && reported === version) {
    record('esbuild', 'ok', `${version} binary runs`);
    return;
  }
  const firstErrorLine =
    (run.stderr ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('at ') && !l.startsWith('[eval]')) ?? `exit ${run.status}`;
  record(
    'esbuild',
    'fail',
    run.status === 0 ? `reports ${reported || '(nothing)'}, package is ${version}` : firstErrorLine,
    `${npmCmd} rebuild esbuild   (its install script is approved in package.json "allowScripts")`,
  );
}

// 4. API key: informational. The app runs without one and says why, so this never fails. The
//    .env file is parsed the way the app parses it (node:util parseEnv), so an empty value with
//    the key on the next line, a shape seen on a first install, is named here.
function checkApiKey() {
  const keyName = 'ANTHROPIC_API_KEY';
  const setHint = isWindows
    ? `$env:${keyName} = "sk-ant-..."   (PowerShell), or put ${keyName}=sk-ant-... on one line in .env`
    : `export ${keyName}=sk-ant-...   or put ${keyName}=sk-ant-... on one line in .env`;
  if (process.env[keyName]) {
    record('API key', 'ok', `${keyName} is set in the environment (this wins over .env)`);
    return;
  }
  const envFile = path.join(projectDir, '.env');
  if (!fs.existsSync(envFile)) {
    record(
      'API key',
      'warn',
      `${keyName} is not set and there is no .env; rewrites will refuse until it is`,
      setHint,
    );
    return;
  }
  const source = fs.readFileSync(envFile, 'utf-8');
  const parsed = parseEnv(source);
  if (parsed[keyName]) {
    record('API key', 'ok', `${keyName} will be read from .env at start-up`);
    return;
  }
  const orphan = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && !l.includes('='));
  record(
    'API key',
    'warn',
    keyName in parsed
      ? `.env has ${keyName}= with nothing after it` +
          (orphan ? `; the line ${orphan} is not attached to it` : '')
      : `.env exists but does not define ${keyName}`,
    `edit .env so it reads exactly ${keyName}=sk-ant-... on one line, no quotes needed`,
  );
}

checkNode();
checkElectron();
checkEsbuild();
checkApiKey();

const failures = results.filter((r) => r.status === 'fail');
const label = { ok: 'ok  ', skip: 'skip', warn: 'warn', fail: 'FAIL' };
if (!postinstall || failures.length > 0) {
  console.log('formalise doctor');
  for (const r of results) {
    console.log(`  [${label[r.status]}] ${r.name}: ${r.detail}`);
    if (r.fix) console.log(`         fix: ${r.fix}`);
  }
}
if (failures.length > 0) {
  console.log(
    postinstall
      ? '\nFix the items above, then run `npm run doctor` to confirm before `npm run dev`.'
      : `\n${failures.length} problem${failures.length === 1 ? '' : 's'} found.`,
  );
  process.exitCode = postinstall ? 0 : 1;
} else if (!postinstall) {
  console.log('\nAll good: `npm run dev` should start.');
}
