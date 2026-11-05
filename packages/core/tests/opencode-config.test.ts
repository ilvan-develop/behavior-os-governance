import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the OpenCode V2 control plane against configuration drift.
 *
 * `scripts/verify-opencode.mjs` is the executable gate used by CI and
 * `pnpm verify:all`. This suite keeps the same invariants inside the normal
 * test run, where a failure names the broken layer directly.
 *
 * The reference for V2 field names and semantics is
 * `https://opencode.ai/v2/docs/`; the repository wiring is documented in
 * `docs/OPENCODE_V2.md`.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface PermissionRule {
  action: string;
  resource: string;
  effect: 'allow' | 'ask' | 'deny';
}

interface OpenCodeConfig {
  $schema?: string;
  instructions?: string[];
  permissions?: PermissionRule[];
  formatter?: unknown;
  watcher?: { ignore?: string[] };
  mcp?: unknown;
  permission?: unknown;
  tools?: unknown;
}

interface Manifest {
  scripts?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf-8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

function unquote(value: string): string | boolean {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

/**
 * Minimal frontmatter reader for the flat YAML used by agents, commands and
 * skills. It deliberately supports only the shapes this repository writes.
 */
function parseFrontmatter(relativePath: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const text = readText(relativePath);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  expect(match, `${relativePath} must start with YAML frontmatter`).not.toBeNull();
  const block = match?.[1] ?? '';
  const body = match?.[2] ?? '';
  const data: Record<string, unknown> = {};
  let currentKey: string | undefined;

  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey && Array.isArray(data[currentKey])) {
      const entry: Record<string, unknown> = {};
      const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(listItem[1]);
      if (keyValue) entry[keyValue[1]] = unquote(keyValue[2]);
      (data[currentKey] as Array<Record<string, unknown>>).push(entry);
      continue;
    }

    const nested = /^\s+([A-Za-z0-9_/-]+):\s*(.*)$/.exec(line);
    if (nested && currentKey) {
      const value = data[currentKey];
      if (Array.isArray(value)) {
        const last = value.at(-1);
        if (last && typeof last === 'object') {
          (last as Record<string, unknown>)[nested[1]] = unquote(nested[2]);
        }
      } else if (value && typeof value === 'object') {
        (value as Record<string, unknown>)[nested[1]] = unquote(nested[2]);
      }
      continue;
    }

    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyValue) {
      currentKey = keyValue[1];
      data[currentKey] = keyValue[2] === '' ? [] : unquote(keyValue[2]);
    }
  }

  return { data, body };
}

function markdownIds(relativeDir: string): string[] {
  const dir = join(repoRoot, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/, ''));
}

const config = readJson<OpenCodeConfig>('opencode.json');
const permissions = config.permissions ?? [];

describe('OpenCode V2 project configuration', () => {
  it('declares the V2 schema and loads only real instruction files', () => {
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.instructions?.length).toBeGreaterThan(0);
    for (const instruction of config.instructions ?? []) {
      expect(existsSync(join(repoRoot, instruction)), `${instruction} is missing`).toBe(true);
    }
  });

  it('uses ordered permission rules with the last match winning', () => {
    expect(permissions.length).toBeGreaterThanOrEqual(10);

    for (const [index, rule] of permissions.entries()) {
      expect(typeof rule.action, `rule ${index} action`).toBe('string');
      expect(typeof rule.resource, `rule ${index} resource`).toBe('string');
      expect(['allow', 'ask', 'deny'], `rule ${index} effect`).toContain(rule.effect);
    }

    const broadIndex = permissions.findIndex(
      (rule) => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'ask',
    );
    expect(broadIndex, 'a broad "shell * ask" rule is required').toBeGreaterThanOrEqual(0);

    for (const [index, rule] of permissions.entries()) {
      if (rule.action !== 'shell' || rule.resource === '*') continue;
      expect(
        index,
        `shell exception "${rule.resource}" must come after the broad ask rule`,
      ).toBeGreaterThan(broadIndex);
    }
  });

  it('allows the verification ladder and denies release actions', () => {
    const find = (action: string, resource: string) =>
      permissions.find((rule) => rule.action === action && rule.resource === resource);

    for (const gate of [
      'pnpm typecheck',
      'pnpm test',
      'pnpm build',
      'pnpm verify:*',
      'pnpm smoke:*',
    ]) {
      expect(find('shell', gate)?.effect, `${gate} must be allowed`).toBe('allow');
    }

    for (const blocked of ['git push *', 'pnpm publish *', 'npm publish *']) {
      expect(find('shell', blocked)?.effect, `${blocked} must be denied`).toBe('deny');
    }
  });

  it('keeps secrets and external access gated', () => {
    const find = (action: string, resource: string) =>
      permissions.find((rule) => rule.action === action && rule.resource === resource);

    expect(find('read', '*.env')?.effect).toBe('deny');
    expect(find('read', '*.env.*')?.effect).toBe('deny');
    expect(find('read', '*.env.example')?.effect).toBe('allow');
    expect(find('external_directory', '*')?.effect).toBe('ask');
    expect(find('webfetch', '*')?.effect).toBe('ask');
  });

  it('uses V2 fields and does not register a duplicate MCP server', () => {
    expect(config.formatter).toBe(true);
    expect(config.watcher?.ignore?.length).toBeGreaterThan(0);
    expect(config.mcp, 'the plugin is the native integration').toBeUndefined();
    expect(config.permission, 'V1 permission field must not be used').toBeUndefined();
    expect(config.tools, 'V1 tools field must not be used').toBeUndefined();
  });
});

describe('OpenCode agents', () => {
  const required = ['researcher', 'planner', 'reviewer', 'auditor'];

  it('defines every required agent', () => {
    const ids = markdownIds('.opencode/agents');
    for (const id of required) expect(ids, `${id}.md is missing`).toContain(id);
  });

  it('uses valid modes and no legacy fields', () => {
    for (const id of markdownIds('.opencode/agents')) {
      const { data, body } = parseFrontmatter(`.opencode/agents/${id}.md`);
      expect(typeof data.description, `${id} description`).toBe('string');
      expect(['primary', 'subagent', 'all'], `${id} mode`).toContain(data.mode);
      expect(body.trim().length, `${id} system prompt`).toBeGreaterThan(100);
      for (const legacy of ['permission', 'tools', 'maxSteps', 'prompt', 'temperature']) {
        expect(data[legacy], `${id} must not use V1 field ${legacy}`).toBeUndefined();
      }
    }
  });

  it('gives read-only agents least-privilege permissions', () => {
    for (const id of required) {
      const { data } = parseFrontmatter(`.opencode/agents/${id}.md`);
      const rules = (data.permissions ?? []) as PermissionRule[];
      expect(
        rules.some(
          (rule) => rule.action === 'edit' && rule.resource === '*' && rule.effect === 'deny',
        ),
        `${id} must deny edit on "*"`,
      ).toBe(true);
      expect(
        rules.some(
          (rule) => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'deny',
        ),
        `${id} must deny shell on "*"`,
      ).toBe(true);

      const broadIndex = rules.findIndex((rule) => rule.resource === '*');
      for (const [index, rule] of rules.entries()) {
        if (rule.resource === '*') continue;
        expect(index, `${id} exception ${rule.resource} must follow broad rules`).toBeGreaterThan(
          broadIndex,
        );
      }
    }
  });

  it('keeps audit and review independent from the author', () => {
    const modes: Record<string, unknown> = {};
    for (const id of required) modes[id] = parseFrontmatter(`.opencode/agents/${id}.md`).data.mode;
    expect(modes.planner).toBe('primary');
    expect(modes.researcher).toBe('subagent');
    expect(modes.reviewer).toBe('subagent');
    expect(modes.auditor).toBe('subagent');
  });
});

describe('OpenCode commands', () => {
  const required = ['govern', 'verify', 'audit', 'mission', 'learn', 'review'];
  const agentIds = new Set([
    ...markdownIds('.opencode/agents'),
    'build',
    'plan',
    'general',
    'explore',
  ]);

  it('defines every required command', () => {
    const ids = markdownIds('.opencode/commands');
    for (const id of required) expect(ids, `${id}.md is missing`).toContain(id);
  });

  it('keeps the template in the body and references real agents', () => {
    for (const id of markdownIds('.opencode/commands')) {
      const { data, body } = parseFrontmatter(`.opencode/commands/${id}.md`);
      expect(typeof data.description, `${id} description`).toBe('string');
      expect(body.trim().length, `${id} template`).toBeGreaterThan(40);
      expect(data.template, `${id} must not put the template in frontmatter`).toBeUndefined();
      if (data.agent !== undefined) {
        expect(agentIds.has(String(data.agent)), `${id} references unknown agent`).toBe(true);
      }
      if (data.subagent !== undefined) expect(typeof data.subagent).toBe('boolean');
    }
  });

  it('runs review and audit in isolated child sessions', () => {
    const review = parseFrontmatter('.opencode/commands/review.md').data;
    const audit = parseFrontmatter('.opencode/commands/audit.md').data;
    expect(review.agent).toBe('reviewer');
    expect(review.subagent).toBe(true);
    expect(audit.agent).toBe('auditor');
    expect(audit.subagent).toBe(true);
  });
});

describe('OpenCode skills', () => {
  const required = [
    'behavior-os',
    'verification-first',
    'engineering-cycle',
    'docs-research',
    'release',
  ];

  it('defines every required skill as a discoverable directory', () => {
    const dir = join(repoRoot, '.opencode', 'skills');
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const id of required) {
      expect(ids, `${id} skill directory is missing`).toContain(id);
      expect(existsSync(join(dir, id, 'SKILL.md')), `${id}/SKILL.md is missing`).toBe(true);
    }
  });

  it('gives each skill an ID, a name and a description', () => {
    const dir = join(repoRoot, '.opencode', 'skills');
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const id of ids) {
      const { data, body } = parseFrontmatter(`.opencode/skills/${id}/SKILL.md`);
      expect(id, `${id} must be lowercase kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(typeof data.name, `${id} name`).toBe('string');
      expect(typeof data.description, `${id} description`).toBe('string');
      expect(body.trim().length, `${id} body`).toBeGreaterThan(80);
    }
  });

  it('keeps the seven protocol steps in the behavior-os skill', () => {
    const body = readText('.opencode/skills/behavior-os/SKILL.md');
    for (const step of [
      'bos_select_dna',
      'bos_list_dna',
      'bos_get_state',
      'bos_create_mission',
      'bos_start_mission',
      'bos_run_audit',
      'bos_record_learning',
    ]) {
      expect(body, `behavior-os skill must document ${step}`).toContain(step);
    }
  });
});

describe('plugin and MCP separation', () => {
  it('loads the versioned plugin build', () => {
    const loader = readText('.opencode/plugins/behavioros.ts');
    expect(loader).toContain('plugins/opencode-v2/dist/index.js');
    expect(readJson<Manifest>('plugins/opencode-v2/package.json').scripts?.build).toBeTruthy();
  });

  it('exposes exactly 72 unique bos_* tools', () => {
    const source = readText('plugins/opencode-v2/src/index.ts');
    const names = [...source.matchAll(/name:\s*'(bos_[a-z0-9_]+)'/g)].map((match) => match[1]);
    expect(names).toHaveLength(72);
    expect(new Set(names).size).toBe(72);
  });

  it('keeps .mcp.json for external clients only', () => {
    expect(config.mcp).toBeUndefined();
    // `.mcp.json` is generated locally by `behavioros init` for external MCP
    // clients and is git-ignored; validate it only when it is present.
    if (!existsSync(join(repoRoot, '.mcp.json'))) return;
    const mcp = readJson<McpConfig>('.mcp.json');
    const server = mcp.mcpServers?.behavioros;
    expect(server?.command).toBe('node');
    expect(server?.args?.at(-1)).toMatch(/packages[\\/]mcp-server[\\/]dist[\\/]server\.js$/);
  });
});

describe('control-plane verification gates', () => {
  it('wires verify:opencode and the full ladder', () => {
    const manifest = readJson<Manifest>('package.json');
    expect(manifest.scripts?.['verify:opencode']).toContain('scripts/verify-opencode.mjs');
    expect(existsSync(join(repoRoot, 'scripts', 'verify-opencode.mjs'))).toBe(true);
    expect(existsSync(join(repoRoot, 'scripts', 'smoke-mcp.mjs'))).toBe(true);

    const all = manifest.scripts?.['verify:all'] ?? '';
    for (const gate of [
      'pnpm typecheck',
      'pnpm lint:check',
      'pnpm test',
      'pnpm build',
      'pnpm verify:governance',
      'pnpm verify:plugin',
      'pnpm smoke:mcp',
      'pnpm verify:opencode',
    ]) {
      expect(all, `verify:all must run ${gate}`).toContain(gate);
    }
  });

  it('documents the wiring in docs/OPENCODE_V2.md', () => {
    const docs = readText('docs/OPENCODE_V2.md');
    for (const term of [
      'opencode.json',
      '.opencode/agents',
      '.opencode/commands',
      '.opencode/skills',
      'pnpm verify:opencode',
    ]) {
      expect(docs, `docs must mention ${term}`).toContain(term);
    }
  });

  it('keeps control-plane files trackable by git', () => {
    // The exact regression this guard exists for: .opencode/* used to be
    // git-ignored, so agents, commands and skills never reached other machines.
    const files = [
      ...readdirSync(join(repoRoot, '.opencode', 'agents'), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => `.opencode/agents/${entry.name}`),
      ...readdirSync(join(repoRoot, '.opencode', 'commands'), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => `.opencode/commands/${entry.name}`),
      ...readdirSync(join(repoRoot, '.opencode', 'skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `.opencode/skills/${entry.name}/SKILL.md`),
      '.opencode/plugins/behavioros.ts',
    ];

    expect(files.length).toBeGreaterThanOrEqual(10);
    // Batch all checks into a single `git check-ignore` call to avoid per-file
    // spawn overhead on Windows, which causes this test to exceed the 5s timeout.
    // git exits 0 when at least one listed path is ignored; here all paths must
    // be trackable, so any exit 0 fails the check.
    const result = spawnSync('git', ['check-ignore', '--quiet', ...files], {
      cwd: repoRoot,
      stdio: 'ignore',
      windowsHide: true,
    });
    // A non-zero exit means none of the listed files is ignored, which is the
    // passing condition. An exit of 0 would mean at least one control-plane
    // file is git-ignored and would never reach another machine.
    expect(result.status).not.toBe(0);
  });
});
