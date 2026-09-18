// End-to-end tests for `npm run doctor` (scripts/doctor.mjs). Each case builds a throwaway
// project directory with a fake `node_modules/electron` in a given state, runs the doctor as
// a child process from that directory, and checks exit code and printed fix. esbuild is
// linked to the real one so its check passes and the Electron outcome is what varies.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const doctor = fileURLToPath(new URL('../scripts/doctor.mjs', import.meta.url));
const realEsbuild = path.dirname(
  fileURLToPath(new URL('../node_modules/esbuild/package.json', import.meta.url)),
);
const electronFix = `node ${path.join('node_modules', 'electron', 'install.js')}`;

interface FakeElectron {
  version: string;
  pathTxt?: string;
  binaryExists?: boolean;
  distVersion?: string;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeProject(electron: FakeElectron | null, { esbuild = true } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formalise-doctor-'));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fake', private: true, engines: { node: '>=22.13' } }),
  );
  fs.mkdirSync(path.join(dir, 'node_modules'));
  if (esbuild) {
    // 'junction' matters only on Windows, where directory symlinks need privileges and
    // junctions do not; other platforms ignore the type.
    fs.symlinkSync(realEsbuild, path.join(dir, 'node_modules', 'esbuild'), 'junction');
  }
  if (electron) {
    const eDir = path.join(dir, 'node_modules', 'electron');
    fs.mkdirSync(path.join(eDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(eDir, 'package.json'),
      JSON.stringify({ name: 'electron', version: electron.version, main: 'index.js' }),
    );
    fs.writeFileSync(path.join(eDir, 'index.js'), "throw new Error('must not be required');");
    if (electron.pathTxt !== undefined) {
      fs.writeFileSync(path.join(eDir, 'path.txt'), electron.pathTxt);
      if (electron.binaryExists) {
        fs.writeFileSync(path.join(eDir, 'dist', electron.pathTxt), '');
      }
    }
    if (electron.distVersion !== undefined) {
      fs.writeFileSync(path.join(eDir, 'dist', 'version'), `v${electron.distVersion}`);
    }
  }
  return dir;
}

function runDoctor(cwd: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: 'test-key',
    ...extraEnv,
  };
  if (!('ELECTRON_SKIP_BINARY_DOWNLOAD' in extraEnv)) delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const run = spawnSync(process.execPath, [doctor, ...args], { cwd, env, encoding: 'utf-8' });
  return { status: run.status, out: run.stdout + run.stderr };
}

describe('npm run doctor', () => {
  it('fails and prints the install command when Electron has no binary', () => {
    const dir = makeProject({ version: '44.4.2' });
    const { status, out } = runDoctor(dir);
    expect(status).toBe(1);
    expect(out).toContain('[FAIL] Electron');
    expect(out).toContain('Error: Electron uninstall');
    expect(out).toContain(`fix: ${electronFix}`);
    expect(out).toContain('[ok  ] esbuild');
  });

  it('as postinstall it prints the same fix but exits 0 so npm install still succeeds', () => {
    const dir = makeProject({ version: '44.4.2' });
    const { status, out } = runDoctor(dir, ['--postinstall']);
    expect(status).toBe(0);
    expect(out).toContain(`fix: ${electronFix}`);
    expect(out).toContain('npm run doctor');
  });

  it('skips the Electron check when ELECTRON_SKIP_BINARY_DOWNLOAD is set (CI)', () => {
    const dir = makeProject({ version: '44.4.2' });
    const { status, out } = runDoctor(dir, [], { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
    expect(status).toBe(0);
    expect(out).toContain('[skip] Electron');
    expect(out).toContain('All good');
  });

  it('passes when path.txt, the binary and the dist version all line up', () => {
    const dir = makeProject({
      version: '44.4.2',
      pathTxt: process.platform === 'win32' ? 'electron.exe' : 'electron',
      binaryExists: true,
      distVersion: '44.4.2',
    });
    const { status, out } = runDoctor(dir);
    expect(status).toBe(0);
    expect(out).toContain('[ok  ] Electron: 44.4.2');
    expect(out).toContain('All good');
  });

  it('fails when path.txt points at a binary that is not there', () => {
    const dir = makeProject({ version: '44.4.2', pathTxt: 'electron', binaryExists: false });
    const { status, out } = runDoctor(dir);
    expect(status).toBe(1);
    expect(out).toContain('does not exist');
    expect(out).toContain(`fix: ${electronFix}`);
  });

  it('fails when the downloaded binary is a different version from the package', () => {
    const dir = makeProject({
      version: '44.4.2',
      pathTxt: 'electron',
      binaryExists: true,
      distVersion: '43.0.0',
    });
    const { status, out } = runDoctor(dir);
    expect(status).toBe(1);
    expect(out).toContain('binary is 43.0.0 but package is 44.4.2');
    expect(out).toContain(`fix: ${electronFix}`);
  });

  it('tells you to npm install when electron or esbuild are not installed at all', () => {
    const dir = makeProject(null, { esbuild: false });
    const { status, out } = runDoctor(dir);
    expect(status).toBe(1);
    expect(out).toContain('[FAIL] Electron: node_modules/electron is missing');
    expect(out).toContain('[FAIL] esbuild: node_modules/esbuild is missing');
    expect(out).toMatch(/fix: npm(\.cmd)? install/);
  });

  it('never requires electron itself, which would start a download', () => {
    // index.js throws if required; a clean pass proves the doctor only looked at files.
    const dir = makeProject({
      version: '44.4.2',
      pathTxt: 'electron',
      binaryExists: true,
      distVersion: '44.4.2',
    });
    expect(runDoctor(dir).out).not.toContain('must not be required');
  });
});
