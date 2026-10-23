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
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
