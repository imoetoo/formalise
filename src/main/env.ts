/**
 * Loads `ANTHROPIC_API_KEY` (and anything else) from a local `.env` file into `process.env`
 * at startup, so the README's "or put it in .env" is true. Rules:
 *
 * - A variable already set in the real environment always wins; the file never overrides it.
 * - A missing file is fine and is reported as skipped, not as an error.
 * - In development the file is the project root's `.env`. In a packaged build it is looked for
 *   in the app's user-data directory and then alongside the executable, in that order; the
 *   first file to define a variable wins.
 *
 * Parsing uses Node's own `util.parseEnv` (the parser behind `node --env-file`), so quoting
 * rules match what people expect from dotenv: `KEY=value` or `KEY="value"`, one per line.
 * No dotenv dependency: Electron 44 embeds Node 22+, which ships the parser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { API_KEY_ENV } from './errors';

export const DOTENV_FILENAME = '.env';

export interface DotEnvLocations {
  isPackaged: boolean;
  /** `app.getAppPath()`: the project root in development. */
  appPath: string;
  /** `app.getPath('userData')`. */
  userData: string;
  /** `process.execPath`. */
  execPath: string;
}

/** Where to look for `.env`, most specific first. */
export function dotEnvCandidates(where: DotEnvLocations): string[] {
  if (!where.isPackaged) {
    return [path.join(where.appPath, DOTENV_FILENAME)];
  }
  return [
    path.join(where.userData, DOTENV_FILENAME),
    path.join(path.dirname(where.execPath), DOTENV_FILENAME),
  ];
}

export interface DotEnvResult {
  /** Files that existed and were read, in order. */
  loaded: string[];
  /** Candidate files that do not exist. */
  skipped: string[];
  /** Variables set from a file (not already present in the environment). */
  applied: string[];
  /** Human-readable problems worth showing: unreadable files, a key written in the wrong shape. */
  problems: string[];
}

/**
 * The shape the first-time user actually wrote on 2026-09-18: the name on one line with nothing
 * after `=`, and the quoted key on the next line. `parseEnv` reads that as an empty value and
 * ignores the orphan line, so the app would just say the key is not set. Name it instead.
 */
function describeWrongShape(
  file: string,
  source: string,
  parsed: NodeJS.Dict<string>,
): string | null {
  if (!(API_KEY_ENV in parsed) || parsed[API_KEY_ENV] !== '') {
    return null;
  }
  const orphan = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#') && !line.includes('='));
  return (
    `${API_KEY_ENV} in ${file} is empty.` +
    (orphan === undefined
      ? ''
      : ` The line ${orphan} is not attached to it; put the value on the same line.`) +
    ` Expected exactly: ${API_KEY_ENV}=sk-ant-... on one line, no quotes needed.`
  );
}

export function loadDotEnv(
  candidates: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): DotEnvResult {
  const result: DotEnvResult = { loaded: [], skipped: [], applied: [], problems: [] };
  for (const file of candidates) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        result.skipped.push(file);
      } else {
        result.problems.push(`Could not read ${file}: ${(error as Error).message}`);
      }
      continue;
    }
    result.loaded.push(file);
    const parsed = parseEnv(source);
    const wrongShape = describeWrongShape(file, source, parsed);
    if (wrongShape !== null) {
      result.problems.push(wrongShape);
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (env[name] !== undefined) {
        continue; // the real environment wins
      }
      if (value === undefined || value === '') {
        continue; // an empty assignment is "not set", not an empty key
      }
      env[name] = value;
      result.applied.push(name);
    }
  }
  return result;
}
