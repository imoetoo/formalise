/**
 * Listen options for the web-mode CLI (`./cli.ts`), separated so tests can exercise the parsing
 * without starting a server. Flags win over environment variables, which win over defaults.
 */
import { parseArgs } from 'node:util';
import { DEFAULT_HOST, DEFAULT_PORT } from './server';

export interface CliOptions {
  host: string;
  port: number;
}

/** Parse flags and environment into listen options; throws a plain Error on bad input. */
export function parseCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
    },
    strict: true,
  });
  const host = (values.host ?? env.FORMALISE_WEB_HOST ?? DEFAULT_HOST).trim();
  const portText = (values.port ?? env.FORMALISE_WEB_PORT ?? String(DEFAULT_PORT)).trim();
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65_535) {
    throw new Error(`--port must be a whole number between 1 and 65535, got "${portText}".`);
  }
  if (host === '') {
    throw new Error('--host must not be empty.');
  }
  return { host, port };
}
