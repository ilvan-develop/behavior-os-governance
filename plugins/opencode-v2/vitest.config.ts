import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Several tests reload the plugin module (vi.resetModules + dynamic import)
    // and the plugin re-reads the 21 DNA YAML files on setup. Under parallel
    // turbo load the cold first import can exceed 20s on Windows (measured
    // 20.1s during a full `pnpm test --force`), so allow 60s of headroom.
    // This changes only the timeout, never an assertion.
    // Never append test traffic to the operator's live durable audit sink. The
    // OpenCode host exports BEHAVIOR_OS_AUDIT_LOG for its own process; tests
    // must start from an in-memory log so sequence assertions are deterministic.
    env: {
      BEHAVIOR_OS_AUDIT_LOG: '',
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
