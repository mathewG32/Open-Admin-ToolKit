import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Tests import packages by name; alias them to source so tests run without a build.
// (scripts/pack-test.mjs is what proves the built, packed packages work.)
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@openadminkit/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@openadminkit/express': fileURLToPath(new URL('./packages/express/src/index.ts', import.meta.url)),
      '@openadminkit/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}', 'examples/*/tests/**/*.test.{ts,tsx}'],
  },
});
