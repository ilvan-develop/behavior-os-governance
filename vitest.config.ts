import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Every workspace package ships its own `vitest.config.ts` (include globs,
 * aliases, timeouts). Running `vitest` from the repository root used to ignore
 * all of them — which both lost package-specific settings (e.g. the plugin's
 * longer timeout, required because it re-reads the DNA YAML files under
 * parallel load) and wrongly discovered `examples/` (then outside the pnpm
 * workspace).
 *
 * `projects` makes the root run delegate to each package config, so the root
 * `test:coverage` / `test:watch` scripts exercise exactly the workspace
 * packages with their own settings. `examples/` is now a workspace package and
 * is included; its own config keeps the package runnable in isolation.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'plugins/*/vitest.config.ts',
      'examples/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Keep the product coverage denominator to shipped packages. `examples/`
      // is a demo application (and its `main()` is intentionally not imported
      // by tests), so including it would dilute product coverage without
      // measuring product behavior.
      include: ['packages/*/src/**/*.ts', 'plugins/*/src/**/*.ts'],
      // No aggregate thresholds: coverage is aggregated across packages that
      // only partially have tests, so a single repo-wide floor would be
      // arbitrary. Per-package thresholds (see packages/core) still apply when
      // that package's own coverage run is used. Coverage options can only be
      // defined on the root config when using `projects`.
    },
  },
});
