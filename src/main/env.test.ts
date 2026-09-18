import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dotEnvCandidates, loadDotEnv } from './env';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function tmpFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formalise-env-'));
  dirs.push(dir);
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, contents);
  return file;
}

describe('loadDotEnv', () => {
  it('sets variables from the file into the given environment', () => {
    const file = tmpFile('ANTHROPIC_API_KEY=sk-ant-file\nOTHER=x\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv([file], env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-file');
    expect(env.OTHER).toBe('x');
    expect(result.loaded).toEqual([file]);
    expect(result.applied).toEqual(['ANTHROPIC_API_KEY', 'OTHER']);
    expect(result.problems).toEqual([]);
  });

  it('never overrides a variable already set in the real environment', () => {
    const file = tmpFile('ANTHROPIC_API_KEY=sk-ant-file\n');
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'sk-ant-real' };
    const result = loadDotEnv([file], env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-real');
    expect(result.applied).toEqual([]);
  });

  it('treats a missing file as fine', () => {
    const missing = path.join(os.tmpdir(), 'formalise-env-does-not-exist', '.env');
    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv([missing], env);
    expect(result).toEqual({ loaded: [], skipped: [missing], applied: [], problems: [] });
    expect(env).toEqual({});
  });

  it('strips quotes like node --env-file does', () => {
    const file = tmpFile('ANTHROPIC_API_KEY="sk-ant-quoted"\n');
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv([file], env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-quoted');
  });

  it('the first file to define a variable wins when several are given', () => {
    const first = tmpFile('ANTHROPIC_API_KEY=sk-ant-first\n');
    const second = tmpFile('ANTHROPIC_API_KEY=sk-ant-second\nONLY_SECOND=1\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv([first, second], env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-first');
    expect(env.ONLY_SECOND).toBe('1');
    expect(result.loaded).toEqual([first, second]);
  });

  it('names the wrong shape: empty assignment with the quoted key on the next line', () => {
    const file = tmpFile('ANTHROPIC_API_KEY=\n"sk-ant-orphan"\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv([file], env);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('is empty');
    expect(result.problems[0]).toContain('"sk-ant-orphan"');
    expect(result.problems[0]).toContain('ANTHROPIC_API_KEY=sk-ant-... on one line');
  });

  it('an untouched .env.example copy (empty value) is not set and not a problem beyond emptiness', () => {
    const file = tmpFile('# comment\nANTHROPIC_API_KEY=\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv([file], env);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).not.toContain('is not attached');
  });
});

describe('dotEnvCandidates', () => {
  it('is the project root in development', () => {
    expect(
      dotEnvCandidates({
        isPackaged: false,
        appPath: '/proj',
        userData: '/home/u/.config/formalise',
        execPath: '/proj/node_modules/electron/dist/electron',
      }),
    ).toEqual([path.join('/proj', '.env')]);
  });

  it('is user data then beside the executable when packaged', () => {
    expect(
      dotEnvCandidates({
        isPackaged: true,
        appPath: '/opt/Formalise/resources/app.asar',
        userData: '/home/u/.config/formalise',
        execPath: '/opt/Formalise/formalise',
      }),
    ).toEqual([
      path.join('/home/u/.config/formalise', '.env'),
      path.join('/opt/Formalise', '.env'),
    ]);
  });
});
