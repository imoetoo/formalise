import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Default environment is node (main-process code). Renderer tests opt into jsdom with a
// `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
  },
});
