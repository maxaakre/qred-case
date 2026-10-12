import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Tests share one Postgres container and truncate between tests.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 120_000,
    // `npm run test:coverage`. The generated types and the process entry are not logic to test.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/server.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
