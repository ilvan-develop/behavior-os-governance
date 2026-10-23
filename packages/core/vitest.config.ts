import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The control-plane tests shell out to `git check-ignore` and to the real
    // lint stage. Under a full parallel `turbo test` run on Windows the lint
    // test was measured at 7.1s (2026-10-14) and at 24.4s (2026-10-21, v4
    // ladder) against a 30s ceiling — 81% of the budget with 2.1x run-to-run
    // variance, so the timeout is doubled rather than left marginal. Timeout
    // only: no assertion is relaxed.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
