import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // `rate-limit.test.ts` imports the real server inside `beforeAll`, which
    // loads the 21 DNA patterns and registers 30 tools before connecting an
    // in-memory client. Under a parallel `turbo test --force` run on Windows
    // that cold import exceeded Vitest's 10s default hook timeout (measured
    // 2026-10-21: `Hook timed out in 10000ms` while the package's own run took
    // 43s). `core` and `opencode-v2` already carry the same headroom for the
    // same measured reason. Timeout only — no assertion is relaxed.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
