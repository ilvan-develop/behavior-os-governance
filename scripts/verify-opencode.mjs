#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guard for the OpenCode V2 control plane.
 *
 * It verifies that the repository's OpenCode configuration, agents, commands,
 * skills, plugin loader and MCP separation are wired exactly as documented in
 * `docs/OPENCODE_V2.md`. It does not start OpenCode: runtime resolution is
 * covered by `pnpm verify:plugin` and by an interactive session.
 *
 * Exits non-zero on the first failed check so it can gate CI.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];

function check(name, run) {
  try {
    const detail = run();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const file = join(repoRoot, relativePath);
  if (!existsSync(file)) fail(`${relativePath} is missing`);
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function readText(relativePath) {
  const file = join(repoRoot, relativePath);
  if (!existsSync(file)) fail(`${relativePath} is missing`);
  return readFileSync(file, 'utf-8');
}

function unquote(value) {
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

/** Minimal frontmatter reader for the flat YAML used by OpenCode files. */
function parseFrontmatter(relativePath) {
  const text = readText(relativePath);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) fail(`${relativePath} has no YAML frontmatter`);
  const data = {};
  let currentKey;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey && Array.isArray(data[currentKey])) {
      const entry = {};
      const itemMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(item[1]);
      if (itemMatch) entry[itemMatch[1]] = unquote(itemMatch[2]);
      data[currentKey].push(entry);
      continue;
    }
    const nested = /^\s+([A-Za-z0-9_/-]+):\s*(.*)$/.exec(line);
    if (nested && currentKey) {
      const value = data[currentKey];
      if (Array.isArray(value) && value.length > 0) {
        const last = value[value.length - 1];
        if (last && typeof last === 'object') last[nested[1]] = unquote(nested[2]);
      } else if (value && typeof value === 'object') {
        value[nested[1]] = unquote(nested[2]);
      }
      continue;
    }
    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyValue) {
      currentKey = keyValue[1];
      data[currentKey] = keyValue[2] === '' ? [] : unquote(keyValue[2]);
    }
  }
  return { data, body: match[2] };
}

function markdownFiles(relativeDir) {
  const dir = join(repoRoot, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
}

const AGENT_IDS = new Set(['researcher', 'planner', 'reviewer', 'auditor']);
const BUILTIN_AGENTS = new Set(['build', 'plan', 'general', 'explore']);
const REQUIRED_COMMANDS = ['govern', 'verify', 'audit', 'mission', 'learn', 'review'];
const REQUIRED_SKILLS = [
  'behavior-os',
  'verification-first',
  'engineering-cycle',
  'docs-research',
  'release',
];
const READ_ONLY_AGENTS = ['researcher', 'planner', 'reviewer', 'auditor'];

/* ------------------------------------------------------------------ config */

const config = readJson('opencode.json');

check('opencode.json declares the V2 schema', () => {
  if (config.$schema !== 'https://opencode.ai/config.json') {
    fail('$schema must be https://opencode.ai/config.json');
  }
  return config.$schema;
});

check('instruction files exist', () => {
  if (!Array.isArray(config.instructions) || config.instructions.length === 0) {
    fail('instructions must be a non-empty array');
  }
  for (const instruction of config.instructions) {
    if (!existsSync(resolve(repoRoot, instruction))) fail(`instruction ${instruction} is missing`);
  }
  return config.instructions.join(', ');
});

check('formatter and watcher are configured', () => {
  if (config.formatter !== true) fail('formatter must be true to use the installed Biome');
  if (!Array.isArray(config.watcher?.ignore) || config.watcher.ignore.length === 0) {
    fail('watcher.ignore must list generated directories');
  }
  return `formatter=true, ${config.watcher.ignore.length} ignored paths`;
});

check('permissions use ordered V2 rules', () => {
  if (!Array.isArray(config.permissions) || config.permissions.length < 10) {
    fail('permissions must be a non-empty ordered array');
  }
  for (const [index, rule] of config.permissions.entries()) {
    if (typeof rule.action !== 'string' || typeof rule.resource !== 'string') {
      fail(`permission rule ${index} must have string action and resource`);
    }
    if (!['allow', 'ask', 'deny'].includes(rule.effect)) {
      fail(`permission rule ${index} has invalid effect ${rule.effect}`);
    }
  }
  return `${config.permissions.length} ordered rules`;
});

check('broad shell rules precede exceptions', () => {
  const broad = config.permissions.findIndex(
    (rule) => rule.action === 'shell' && rule.resource === '*' && rule.effect === 'ask',
  );
  if (broad === -1) fail('missing broad "shell * ask" rule');
  for (const [index, rule] of config.permissions.entries()) {
    if (rule.action === 'shell' && rule.resource !== '*' && index < broad) {
      fail(`shell exception "${rule.resource}" appears before the broad rule and can never win`);
    }
  }
  return 'last-match-wins order verified';
});

check('release actions are denied', () => {
  const denied = (resource) =>
    config.permissions.some(
      (rule) => rule.action === 'shell' && rule.resource === resource && rule.effect === 'deny',
    );
  for (const resource of ['git push *', 'pnpm publish *', 'npm publish *']) {
    if (!denied(resource)) fail(`missing deny rule for "${resource}"`);
  }
  return 'push and publish denied';
});

check('secrets stay unreadable', () => {
  for (const resource of ['*.env', '*.env.*']) {
    const rule = config.permissions.find(
      (entry) => entry.action === 'read' && entry.resource === resource,
    );
    if (rule?.effect !== 'deny') fail(`read ${resource} must be denied`);
  }
  const example = config.permissions.find(
    (entry) => entry.action === 'read' && entry.resource === '*.env.example',
  );
  if (example?.effect !== 'allow') fail('read *.env.example must be allowed');
  return '.env denied, .env.example allowed';
});

check('verification gates are allowed', () => {
  for (const resource of ['pnpm test', 'pnpm build', 'pnpm verify:*', 'pnpm smoke:*']) {
    const rule = config.permissions.find(
      (entry) => entry.action === 'shell' && entry.resource === resource,
    );
    if (rule?.effect !== 'allow') fail(`${resource} must be allowed`);
  }
  return 'test/build/verify/smoke allowed';
});

check('V2 MCP is intentionally not configured', () => {
  if (config.mcp !== undefined) {
    fail('opencode.json must not register MCP: it would duplicate the plugin tools');
  }
  if (config.permission !== undefined || config.tools !== undefined) {
    fail('legacy V1 permission/tools fields must not be used');
  }
  return 'plugin is the only native integration';
});

/* ------------------------------------------------------------------ agents */

const agentFiles = markdownFiles('.opencode/agents');
const agents = new Map();

check('required agents exist', () => {
  for (const id of AGENT_IDS) {
    if (!agentFiles.includes(`${id}.md`)) fail(`.opencode/agents/${id}.md is missing`);
  }
  return [...AGENT_IDS].sort().join(', ');
});

for (const file of agentFiles) {
  const id = file.replace(/\.md$/, '');
  const parsed = parseFrontmatter(join('.opencode', 'agents', file));
  agents.set(id, parsed);
  check(`agent ${id} is valid`, () => {
    if (typeof parsed.data.description !== 'string' || parsed.data.description.trim() === '') {
      fail('description is required');
    }
    if (!['primary', 'subagent', 'all'].includes(parsed.data.mode)) {
      fail('mode must be primary, subagent or all');
    }
    if (parsed.body.trim().length < 100) fail('system prompt is too short to be useful');
    for (const legacy of ['permission', 'tools', 'maxSteps', 'prompt', 'temperature']) {
      if (legacy in parsed.data) fail(`legacy V1 field "${legacy}" must not be used`);
    }
    return `${parsed.data.mode}`;
  });
}

check('read-only agents deny edit and shell', () => {
  for (const id of READ_ONLY_AGENTS) {
    const parsed = agents.get(id);
    if (!parsed) fail(`${id} was not parsed`);
    const rules = Array.isArray(parsed.data.permissions) ? parsed.data.permissions : [];
    const hasRule = (action, resource, effect) =>
      rules.some(
        (rule) => rule.action === action && rule.resource === resource && rule.effect === effect,
      );
    if (!hasRule('edit', '*', 'deny')) fail(`${id} must deny edit on "*"`);
    if (!hasRule('shell', '*', 'deny')) fail(`${id} must deny shell on "*"`);
    for (const [index, rule] of rules.entries()) {
      if (rule.resource !== '*' && index < rules.findIndex((entry) => entry.resource === '*')) {
        fail(`${id} has an exception before its broad deny rule`);
      }
    }
  }
  return READ_ONLY_AGENTS.join(', ');
});

/* ---------------------------------------------------------------- commands */

const commandFiles = markdownFiles('.opencode/commands');

check('required commands exist', () => {
  for (const id of REQUIRED_COMMANDS) {
    if (!commandFiles.includes(`${id}.md`)) fail(`.opencode/commands/${id}.md is missing`);
  }
  return REQUIRED_COMMANDS.join(', ');
});

for (const file of commandFiles) {
  const id = file.replace(/\.md$/, '');
  const parsed = parseFrontmatter(join('.opencode', 'commands', file));
  check(`command /${id} is executable`, () => {
    if (typeof parsed.data.description !== 'string' || parsed.data.description.trim() === '') {
      fail('description is required');
    }
    if (parsed.body.trim().length < 40) fail('prompt template is empty or too short');
    if ('template' in parsed.data) fail('Markdown commands must keep the template in the body');
    if (parsed.data.agent !== undefined) {
      const agentId = String(parsed.data.agent);
      if (!agents.has(agentId) && !BUILTIN_AGENTS.has(agentId)) {
        fail(`references unknown agent "${agentId}"`);
      }
    }
    if (parsed.data.subagent !== undefined && typeof parsed.data.subagent !== 'boolean') {
      fail('subagent must be a boolean');
    }
    return parsed.data.agent ? `agent=${parsed.data.agent}` : 'current agent';
  });
}

check('audit and review run as isolated subagents', () => {
  for (const id of ['audit', 'review']) {
    const parsed = parseFrontmatter(join('.opencode', 'commands', `${id}.md`));
    if (parsed.data.agent === undefined) fail(`/${id} must select a read-only agent`);
    if (parsed.data.subagent !== true) fail(`/${id} must run in a child session`);
  }
  return '/audit -> auditor, /review -> reviewer';
});

/* ------------------------------------------------------------------ skills */

const skillsDir = join(repoRoot, '.opencode', 'skills');
const skillIds = existsSync(skillsDir)
  ? readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

check('required skills exist', () => {
  for (const id of REQUIRED_SKILLS) {
    if (!skillIds.includes(id)) fail(`.opencode/skills/${id}/SKILL.md is missing`);
  }
  return REQUIRED_SKILLS.join(', ');
});

for (const id of skillIds) {
  const skillFile = join('.opencode', 'skills', id, 'SKILL.md');
  if (!existsSync(join(repoRoot, skillFile))) {
    results.push({ name: `skill ${id}`, ok: false, detail: 'SKILL.md is missing' });
    continue;
  }
  const parsed = parseFrontmatter(skillFile);
  check(`skill ${id} is discoverable`, () => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail('directory id must be lowercase kebab-case');
    if (parsed.data.name === undefined) fail('frontmatter name is required');
    if (typeof parsed.data.description !== 'string' || parsed.data.description.trim() === '') {
      fail('frontmatter description is required so the model can discover it');
    }
    if (parsed.body.trim().length < 80) fail('skill body is too short to be useful');
    return String(parsed.data.name);
  });
}

check('behavior-os skill lists the real protocol steps', () => {
  const body = readText(join('.opencode', 'skills', 'behavior-os', 'SKILL.md'));
  const steps = [
    'bos_select_dna',
    'bos_list_dna',
    'bos_get_state',
    'bos_create_mission',
    'bos_start_mission',
    'bos_run_audit',
    'bos_record_learning',
  ];
  for (const step of steps) {
    if (!body.includes(step)) fail(`behavior-os skill does not mention ${step}`);
  }
  return `${steps.length} steps`;
});

/* ------------------------------------------------------------ plugin + MCP */

check('plugin loader points at the versioned build', () => {
  const loader = readText(join('.opencode', 'plugins', 'behavioros.ts'));
  if (!loader.includes('plugins/opencode-v2/dist/index.js')) {
    fail('loader must re-export plugins/opencode-v2/dist/index.js');
  }
  return 'auto-discovered loader';
});

check('plugin exposes 37 unique bos_* tools', () => {
  const source = readText(join('plugins', 'opencode-v2', 'src', 'index.ts'));
  const names = [...source.matchAll(/name:\s*'([a-z0-9_]+)'/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith('bos_'));
  if (names.length !== 37) fail(`expected 37 bos_* tools, found ${names.length}`);
  if (new Set(names).size !== names.length) fail('duplicate bos_* tool names');
  return `${names.length} tools`;
});

check('plugin package can build the loader target', () => {
  const manifest = readJson('plugins/opencode-v2/package.json');
  if (manifest.scripts?.build === undefined) fail('plugin package has no build script');
  if (readJson('tsconfig.json') === undefined) fail('root tsconfig is missing');
  return manifest.scripts.build;
});

check('external MCP config never enters V2 config', () => {
  if (config.mcp !== undefined) {
    fail('opencode.json must not register MCP: it would duplicate the plugin tools');
  }
  // `.mcp.json` is generated locally by `behavioros init` for external MCP
  // clients and is git-ignored; validate it only when it exists.
  if (!existsSync(join(repoRoot, '.mcp.json'))) {
    return '.mcp.json absent (local, external clients only)';
  }
  const mcp = readJson('.mcp.json');
  const server = mcp.mcpServers?.behavioros;
  if (!server) fail('.mcp.json must define mcpServers.behavioros');
  if (server.command !== 'node') fail('behavioros MCP server must run with node');
  if (!Array.isArray(server.args) || server.args.length === 0) fail('server args are missing');
  if (!String(server.args.at(-1)).endsWith('packages/mcp-server/dist/server.js')) {
    fail('server entrypoint must be packages/mcp-server/dist/server.js');
  }
  return 'local .mcp.json for external clients';
});

check('MCP smoke script exists', () => {
  if (!existsSync(join(repoRoot, 'scripts', 'smoke-mcp.mjs'))) fail('smoke-mcp.mjs is missing');
  return 'scripts/smoke-mcp.mjs';
});

/* ------------------------------------------------------------- repository */

check('root scripts expose the control-plane gates', () => {
  const manifest = readJson('package.json');
  if (typeof manifest.scripts?.['verify:opencode'] !== 'string') {
    fail('package.json needs a verify:opencode script');
  }
  if (typeof manifest.scripts?.['verify:all'] !== 'string') {
    fail('package.json needs a verify:all script');
  }
  const ladder = ['typecheck', 'lint:check', 'test', 'build'];
  for (const gate of ladder) {
    if (!String(manifest.scripts['verify:all']).includes(`pnpm ${gate}`)) {
      fail(`verify:all must run pnpm ${gate}`);
    }
  }
  for (const gate of ['verify:governance', 'verify:plugin', 'smoke:mcp', 'verify:opencode']) {
    if (!String(manifest.scripts['verify:all']).includes(`pnpm ${gate}`)) {
      fail(`verify:all must run pnpm ${gate}`);
    }
  }
  return 'verify:opencode + verify:all';
});

check('documentation exists and names the real gate', () => {
  const docs = readText(join('docs', 'OPENCODE_V2.md'));
  for (const term of [
    'opencode.json',
    '.opencode/agents',
    '.opencode/commands',
    '.opencode/skills',
  ]) {
    if (!docs.includes(term)) fail(`docs/OPENCODE_V2.md does not mention ${term}`);
  }
  if (!docs.includes('pnpm verify:opencode')) fail('docs must document pnpm verify:opencode');
  return 'docs/OPENCODE_V2.md';
});

check('control-plane files are not git-ignored', () => {
  const files = [
    ...markdownFiles('.opencode/agents').map((file) => `.opencode/agents/${file}`),
    ...markdownFiles('.opencode/commands').map((file) => `.opencode/commands/${file}`),
    ...skillIds.flatMap((id) =>
      existsSync(join(repoRoot, '.opencode', 'skills', id, 'SKILL.md'))
        ? [`.opencode/skills/${id}/SKILL.md`]
        : [],
    ),
    '.opencode/plugins/behavioros.ts',
  ];
  if (files.length === 0) fail('no control-plane files found to check');
  // Batch all checks into a single `git check-ignore` call: one hidden spawn
  // instead of one per file. git exits 0 when at least one listed path is
  // ignored, and 1 when none are — so exit 1 is the expected green result.
  const batch = spawnSync('git', ['check-ignore', '--quiet', ...files], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (batch.status === 0) {
    // At least one file is (wrongly) ignored — identify which with per-file calls.
    for (const file of files) {
      const ignored =
        spawnSync('git', ['check-ignore', '--quiet', file], {
          cwd: repoRoot,
          stdio: 'ignore',
          windowsHide: true,
        }).status === 0;
      if (ignored) fail(`${file} is git-ignored and would never reach another machine`);
    }
    fail('git check-ignore reported an ignored file but no per-file call matched');
  }
  return `${files.length} files trackable`;
});

/* ------------------------------------------------------------------ report */

console.log('OpenCode V2 control plane');
for (const result of results) {
  console.log(
    `  ${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  );
}

const failed = results.filter((result) => !result.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.error('\nOpenCode control-plane verification failed.');
  process.exit(1);
}
