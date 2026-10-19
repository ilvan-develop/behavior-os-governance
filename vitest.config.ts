import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * Every workspace package ships its own `vitest.config.ts` (include globs,
 * aliases, timeouts). Running `vitest` from the repository root used to ignore
 * all of them — which both lost package-specific settings (e.g. the plugin's
 * 20s timeout, required because it re-reads the DNA YAML files under parallel
 * load) and wrongly discovered `examples/` (outside the pnpm workspace).
 *
 * `projects` makes the root run delegate to each package config, so the root
 * `test:coverage` / `test:watch` scripts exercise exactly the workspace
 * packages with their own settings. `examples/` is intentionally not included.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'plugins/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Scope coverage to workspace sources only: `examples/` lives outside the
      // pnpm workspace and must not show up in the report.
      include: ['packages/*/src/**/*.ts', 'plugins/*/src/**/*.ts'],
      // No aggregate thresholds: coverage is aggregated across packages that
      // only partially have tests, so a single repo-wide floor would be
      // arbitrary. Per-package thresholds (see packages/core) still apply when
      // that package's own coverage run is used. Coverage options can only be
      // defined on the root config when using `projects`.
    },
  },
});
