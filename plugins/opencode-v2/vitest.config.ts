import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Several tests reload the plugin module (vi.resetModules + dynamic import)
    // and the plugin re-reads the 21 DNA YAML files on setup. Under parallel
    // turbo load that disk I/O can exceed the 5s default, so allow more headroom.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
