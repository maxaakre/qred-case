import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the TypeScript tests: a compiled copy in dist/ would run every test twice.
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Tests share one Postgres container and truncate between tests.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 120_000,
    // `npm run test:coverage`. The generated types and the process entry are not logic to test.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      // Process entries, not logic: they only wire config to the code that is tested.
      exclude: ['src/generated/**', 'src/server.ts', 'scripts/token.ts'],
      reporter: ['text-summary', 'html'],
      // A floor a little under today's numbers: CI fails if coverage drops, not on noise.
      thresholds: { statements: 90, branches: 83, functions: 90, lines: 90 },
    },
  },
});
