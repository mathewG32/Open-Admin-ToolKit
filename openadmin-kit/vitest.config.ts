import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Tests import packages by name; alias them to source so tests run without a build.
export default defineConfig({
  resolve: {
    alias: {
      '@openadminkit/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@openadminkit/express': fileURLToPath(new URL('./packages/express/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'examples/*/tests/**/*.test.ts'],
  },
});
