import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The integration tests start the real API on the fixture Tree, with the server's test set-up.
export default defineConfig({
  resolve: {
    alias: { '@rodokmen/shared': fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['../test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
