/**
 * `npm run web` / `npm run web:start`: start the web-mode server (`./server.ts`) and print where
 * it is reachable. Binds 127.0.0.1 unless told otherwise, because exposing it on the network
 * shares this machine's key usage with everyone who can reach it (README, "Web mode").
 *
 *   --host <address>   FORMALISE_WEB_HOST   default 127.0.0.1; 0.0.0.0 for the local network
 *   --port <number>    FORMALISE_WEB_PORT   default 8787
 *
 * The key is read from ANTHROPIC_API_KEY in this process's environment, or from a `.env` file in
 * the working directory when the variable is not already set (the same loader as the desktop,
 * `src/main/env.ts`). It is never sent to the browser.
 */
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeEngineConfig } from '../main/claude';
import { DOTENV_FILENAME, loadDotEnv } from '../main/env';
import { API_KEY_ENV } from '../main/errors';
import { parseCliOptions, type CliOptions } from './options';
import { createWebServer, isExposed, reachableUrls } from './server';

/** Load `.env` from the working directory when present; variables already set win. */
function loadEnvFile(): void {
  const result = loadDotEnv([join(process.cwd(), DOTENV_FILENAME)]);
  for (const file of result.loaded) {
    console.log(`[formalise web] read ${file}`);
  }
  for (const problem of result.problems) {
    console.error(`[formalise web] ${problem}`);
  }
}

function main(): void {
  loadEnvFile();
  let options: CliOptions;
  try {
    options = parseCliOptions(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`[formalise web] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  const staticDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
  const server = createWebServer({
    staticDir,
    env: process.env,
    log: (line) => {
      console.log(`[formalise web] ${line}`);
    },
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[formalise web] port ${String(options.port)} is already in use on ${options.host}; pass --port to pick another.`,
      );
    } else {
      console.error(`[formalise web] could not start: ${error.message}`);
    }
    process.exitCode = 1;
  });

  server.listen(options.port, options.host, () => {
    const hasKey = (process.env[API_KEY_ENV] ?? '').trim() !== '';
    console.log('Formalise web mode. Open one of these in a browser:');
    for (const url of reachableUrls(options.host, options.port, networkInterfaces())) {
      console.log(`  ${url}`);
    }
    if (isExposed(options.host)) {
      console.log(
        `Listening on ${options.host}: everyone who can reach these URLs rewrites with this machine's ${API_KEY_ENV} and quota.`,
      );
    } else {
      console.log(
        'Only this machine can reach it. Pass --host 0.0.0.0 to share it on your network.',
      );
    }
    console.log(
      hasKey
        ? `${API_KEY_ENV} is set and stays on this machine; it is never sent to the browser.`
        : `WARNING: ${API_KEY_ENV} is not set. The page will open but every rewrite will fail until you export the key and restart.`,
    );
    for (const line of describeEngineConfig(process.env)) {
      console.log(`Engine ${line}`);
    }
    console.log('Nothing pasted into the page is stored or logged. Press Ctrl+C to stop.');
  });

  const shutdown = (): void => {
    console.log('[formalise web] stopping');
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      process.exit(0);
    }, 2_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
