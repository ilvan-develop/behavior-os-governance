import { defineConfig } from 'vitest/config';

/**
 * Examples are a workspace package, so they own their Vitest configuration.
 *
 * Without this file, `vitest` run from `examples/` walks up to the root
 * config and tries to resolve the repository's `projects` globs relative to
 * `examples/`, which finds no projects. Keeping the config local makes the
 * package runnable on its own and from the root project list.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
