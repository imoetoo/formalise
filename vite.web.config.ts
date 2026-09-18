// `npm run build:web`: bundle the web-mode server (src/web/cli.ts) for Node into out/web/ and
// copy the static page next to it, so `npm run web:start` needs neither TypeScript nor tsx.
// Dependencies (the Anthropic SDK) stay external and are loaded from node_modules at run time.
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'src/web/cli.ts',
    outDir: 'out/web',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: {
      output: { entryFileNames: 'server.mjs', format: 'es' },
    },
  },
  plugins: [
    {
      name: 'formalise-copy-web-public',
      closeBundle() {
        cpSync(resolve('src/web/public'), resolve('out/web/public'), { recursive: true });
      },
    },
  ],
});
