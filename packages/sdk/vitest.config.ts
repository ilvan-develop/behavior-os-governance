import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@behavior-os/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@behavior-os/schemas': path.resolve(__dirname, '../schemas/src/index.ts'),
    },
  },
});
