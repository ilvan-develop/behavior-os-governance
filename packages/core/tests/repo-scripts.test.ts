import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the repository's task/script wiring against the exact class of bug
 * this repo hit repeatedly: a `turbo.json` task nobody implements, a script
 * that points `turbo` at a task that does not exist, a non-portable deletion,
 * or a husky hook whose deprecated bootstrap silently stops hooking.
 *
 * The file lives in `packages/core/tests` so it runs with the core suite
 * (`pnpm --filter @behavior-os/core test`), but it only reads repository
 * metadata — it never imports core.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface Manifest {
  name?: string;
  scripts?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
    auditConfig?: {
      ignoreCves?: string[];
      ignoreGhsas?: string[];
    };
  };
}

interface TurboConfig {
  tasks?: Record<string, unknown>;
}

interface BiomeConfig {
  files?: {
    includes?: string[];
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T;
}

/** Every `packages/*` and `plugins/*` package that owns a manifest. */
function workspaceManifests(): Array<{ dir: string; manifest: Manifest }> {
  const manifests: Array<{ dir: string; manifest: Manifest }> = [];
  for (const group of ['packages', 'plugins']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(groupDir, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      manifests.push({
        dir: `${group}/${entry.name}`,
        manifest: readJson<Manifest>(manifestPath),
      });
    }
  }
  return manifests;
}

const rootManifest = readJson<Manifest>(join(repoRoot, 'package.json'));
const turboConfig = readJson<TurboConfig>(join(repoRoot, 'turbo.json'));
const turboTasks = new Set(Object.keys(turboConfig.tasks ?? {}));

/** Root plus every workspace package: all manifests that can reference tasks. */
const allManifests: Array<{ dir: string; manifest: Manifest }> = [
  { dir: '.', manifest: rootManifest },
  ...workspaceManifests(),
];

const label = (dir: string): string => (dir === '.' ? 'root' : dir);

/** Returns the turbo task a command delegates to, if any (`turbo <task>`). */
function turboTaskOf(command: string): string | undefined {
  const match = /(?:^|[\s&|])turbo\s+(?:run\s+)?([a-z][a-z0-9:_-]*)/i.exec(command);
  return match?.[1];
}

/**
 * Returns the shell-specific deletion used by a command, or undefined.
 * Catches `rm -rf`/`rm -fr` (any flag combination containing both r and f) and
 * PowerShell's `Remove-Item`.
 */
function shellDeletion(command: string): string | undefined {
  if (/\bRemove-Item\b/i.test(command)) return 'Remove-Item';
  const match = /\brm\b([^&|]*)/i.exec(command);
  if (!match) return undefined;
  const flags = (match[1].match(/-[A-Za-z]+/g) ?? []).join('');
  return /r/i.test(flags) && /f/i.test(flags) ? 'rm -rf' : undefined;
}

const huskyDir = join(repoRoot, '.husky');
const requiredHooks = ['pre-commit', 'commit-msg'];

/** Regular files directly inside `.husky` (excludes husky's own `_` shims). */
function huskyHookFiles(): string[] {
  if (!existsSync(huskyDir)) return [];
  return readdirSync(huskyDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

describe('repository script wiring', () => {
  it('declares no turbo task that no workspace package implements (a)', () => {
    const implemented = new Set<string>();
    for (const { manifest } of workspaceManifests()) {
      for (const script of Object.keys(manifest.scripts ?? {})) implemented.add(script);
    }

    for (const task of turboTasks) {
      expect(
        implemented.has(task),
        `turbo.json declares task "${task}" but no workspace package defines a "${task}" script — the task is dead config and can never run`,
      ).toBe(true);
    }
  });

  it('only delegates to turbo tasks that turbo.json declares (b)', () => {
    for (const { dir, manifest } of allManifests) {
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        const task = turboTaskOf(command);
        if (!task) continue;
        expect(
          turboTasks.has(task),
          `${label(dir)} script "${name}" runs "turbo ${task}" but "${task}" is not a task in turbo.json`,
        ).toBe(true);
      }
    }
  });

  it('never deletes with a shell-specific command (c)', () => {
    for (const { dir, manifest } of allManifests) {
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        const deletion = shellDeletion(command);
        expect(
          deletion,
          `${label(dir)} script "${name}" uses "${deletion}" for deletion, which is not portable — use scripts/clean.mjs (node:fs rmSync) instead`,
        ).toBeUndefined();
      }
    }
  });

  it('never re-introduces the deprecated husky.sh bootstrap (d)', () => {
    for (const hook of huskyHookFiles()) {
      const source = readFileSync(join(huskyDir, hook), 'utf-8');
      expect(
        source.includes('husky.sh'),
        `.husky/${hook} sources husky.sh — husky v9 deprecated it and it will fail in v10; keep only the real commands`,
      ).toBe(false);
    }
  });

  it('keeps every husky hook present and non-empty (e)', () => {
    for (const hook of requiredHooks) {
      expect(
        existsSync(join(huskyDir, hook)),
        `.husky/${hook} is missing — the git hook would silently stop running`,
      ).toBe(true);
    }

    for (const hook of huskyHookFiles()) {
      const source = readFileSync(join(huskyDir, hook), 'utf-8');
      expect(
        source.trim().length,
        `.husky/${hook} is empty — the git hook would silently stop running`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('zero-visible-windows gate', () => {
  const gateSource = () => readFileSync(join(repoRoot, 'scripts', 'verify-windows.mjs'), 'utf-8');

  it('wires verify:windows into the ladder, verify:all and the agents contract (h)', () => {
    expect(
      rootManifest.scripts?.['verify:windows'],
      'verify:windows is the single definition of the window gate',
    ).toBe('node scripts/verify-windows.mjs');

    expect(
      rootManifest.scripts?.['verify:all'] ?? '',
      'the whole ladder must re-measure zero-visible-windows continuously',
    ).toContain('pnpm verify:windows');

    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf-8');
    expect(
      agents,
      'AGENTS.md documents the verification ladder; the window gate must be listed',
    ).toContain('pnpm verify:windows');
  });

  it('skips on non-Windows instead of failing the ladder (i)', () => {
    expect(
      gateSource(),
      'the window failure mode is win32-specific; other platforms must skip with exit 0',
    ).toContain("process.platform !== 'win32'");
  });

  it('runs the probe hidden and delegates attribution to the probe (j)', () => {
    const source = gateSource();
    expect(source, 'the gate itself must never open a window').toContain('windowsHide: true');
    expect(source, 'the gate delegates measurement to the probe').toContain('win-window-probe.mjs');
  });
});

describe('dependency security gate', () => {
  it('runs the high-severity audit from verify:all and CI (f)', () => {
    expect(
      rootManifest.scripts?.['security:audit'],
      'security:audit is the single definition of the dependency-audit gate',
    ).toBe('pnpm audit --audit-level=high');

    expect(
      rootManifest.scripts?.['verify:all'],
      'verify:all must run the audit gate: a clean local ladder that omits it can ship a red CI security job',
    ).toContain('pnpm run security:audit');

    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf-8');
    expect(ci, 'CI must call the same audit gate as the local ladder').toContain(
      'pnpm run security:audit',
    );
  });

  it('never hides advisories behind an audit ignore list (g)', () => {
    expect(
      rootManifest.pnpm?.auditConfig?.ignoreCves ?? [],
      'audit ignores must be empty: fix, upgrade or document the risk explicitly instead',
    ).toEqual([]);
    expect(
      rootManifest.pnpm?.auditConfig?.ignoreGhsas ?? [],
      'audit ignores must be empty: fix, upgrade or document the risk explicitly instead',
    ).toEqual([]);
  });
});

describe('generated evidence stays out of the lint gate', () => {
  it('excludes artifacts and pipeline evidence from Biome (n)', () => {
    const biome = readJson<BiomeConfig>(join(repoRoot, 'biome.json'));
    const includes = biome.files?.includes ?? [];

    // The 1,000-scenario harness rewrites artifacts/*.json with plain
    // JSON.stringify. If Biome lints them, `pnpm lint:check` passes or fails
    // depending on whether the harness ran before or after it — a gate whose
    // result depends on run order is not a gate.
    expect(
      includes,
      'generated evidence under artifacts/ must be excluded from Biome: the scenario harness writes it unformatted',
    ).toContain('!**/artifacts');
    expect(includes, 'pipeline-loop evidence is generated, not source').toContain('!**/.pipeline');
  });
});

describe('registry publish gate', () => {
  it('defines one publish gate and runs it in the ladder (k)', () => {
    expect(
      rootManifest.scripts?.['verify:publish'],
      'verify:publish is the single definition of the "packed manifests are installable" gate',
    ).toBe('node scripts/verify-publish.mjs');

    expect(
      rootManifest.scripts?.['verify:all'] ?? '',
      'the ladder must pack the packages, otherwise an uninstallable tarball passes every other gate',
    ).toContain('pnpm verify:publish');
  });

  it('verifies packed manifests before publishing, never with npm publish (l)', () => {
    const release = readFileSync(join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf-8');
    const verifyAt = release.indexOf('pnpm verify:publish');
    const publishAt = release.indexOf('changeset publish');

    expect(verifyAt, 'the release workflow must run the publish gate').toBeGreaterThan(-1);
    expect(publishAt, 'the release workflow must publish through changesets').toBeGreaterThan(-1);
    expect(verifyAt, 'the gate must run before publishing').toBeLessThan(publishAt);
    expect(
      release,
      'npm publish keeps `workspace:` ranges in the manifest and ships packages consumers cannot install',
    ).not.toMatch(/\bnpm publish\b/);
  });

  it('keeps the npm token out of the version-controlled .npmrc (m)', () => {
    for (const workflow of ['release.yml', 'tag-release.yml']) {
      const source = readFileSync(join(repoRoot, '.github', 'workflows', workflow), 'utf-8');
      expect(source, `${workflow} must run the publish gate`).toContain('pnpm verify:publish');
      expect(source, `${workflow} must authenticate from the home directory`).toContain('~/.npmrc');
    }
  });
});
