import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real child processes are spawned by the execution tests.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@behavior-os/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@behavior-os/schemas': path.resolve(__dirname, '../schemas/src/index.ts'),
    },
  },
});
