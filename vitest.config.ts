import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Tests share one Postgres container and truncate between tests.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 120_000,
  },
});
