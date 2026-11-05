import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: [
      {
        find: /^\.\.\/src\/index\.js$/,
        replacement: path.resolve(__dirname, 'src/index.ts'),
      },
    ],
  },
});
