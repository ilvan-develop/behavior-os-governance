#!/usr/bin/env node
/**
 * Capability manifest generator.
 *
 * A single measured description of the surfaces this repository ships: the
 * MCP tools/resources, the OpenCode plugin tools (and the intentional
 * plugin-only difference), the DNA patterns, the engine count and the SQLite
 * table count. Every value is derived from the file that defines it — nothing
 * here is typed by hand.
 *
 * Usage:
 *   node scripts/capabilities.mjs            # print the manifest
 *   node scripts/capabilities.mjs --write    # refresh docs/analysis/capabilities.json
 *
 * `scripts/verify-capabilities.mjs` fails the build when the committed file
 * drifts from the source.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = 'docs/analysis/capabilities.json';
export const MANIFEST_SCHEMA_VERSION = 1;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Sorted, de-duplicated strings. */
function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function read(root, relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * Every `bos_*` tool the plugin registers, across its `index.ts` and the
 * per-domain registrar files under `src/tools/`. The registrar files are
 * import-time sources of truth: a tool that lives in `tools/missions.ts`
 * must be counted exactly as much as one that lives inline.
 */
function readAllPluginToolFiles(root) {
  const index = read(root, 'plugins/opencode-v2/src/index.ts');
  const toolsDir = join(root, 'plugins/opencode-v2/src/tools');
  const registrarFiles = readdirSync(toolsDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => read(root, join('plugins/opencode-v2/src/tools', f)));
  return [index, ...registrarFiles];
}

function allMatches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Measure every capability from source. Pure: it only reads files under
 * `root`, so the generator and the verifier share exactly one derivation.
 */
export function measureCapabilities(root = repoRoot) {
  const server = read(root, 'packages/mcp-server/src/server.ts');
  const exposed = read(root, 'plugins/opencode-v2/src/exposed-engines.ts');
  const sqlite = read(root, 'packages/core/src/persistence/sqlite-store.ts');

  const mcpTools = sortedUnique(allMatches(server, /server\.registerTool\(\s*'(bos_[a-z0-9_]+)'/g));
  const mcpResources = sortedUnique(allMatches(server, /server\.registerResource\(\s*'([^']+)'/g));
  const pluginSources = readAllPluginToolFiles(root);
  const pluginTools = sortedUnique(
    pluginSources.flatMap((source) => [
      ...allMatches(source, /name:\s*'(bos_[a-z0-9_]+)'/g),
      ...allMatches(source, /addJson\(\s*'(bos_[a-z0-9_]+)'/g),
    ]),
  );
  const pluginExposedTools = sortedUnique(allMatches(exposed, /name:\s*'(bos_[a-z0-9_]+)'/g));
  const allPluginTools = sortedUnique([...pluginTools, ...pluginExposedTools]);
  const mcpToolSet = new Set(mcpTools);
  const pluginOnlyTools = allPluginTools.filter((name) => !mcpToolSet.has(name));

  const engineFiles = readdirSync(join(root, 'packages/core/src/engine')).filter((file) =>
    file.endsWith('.ts'),
  );
  // engineFiles = engines + the BehaviorOS facade + its pure type module + the
  // engine registry.
  const engineCount = engineFiles.length - 3;

  const dnas = readdirSync(join(root, 'dnas'))
    .filter((file) => file.endsWith('.yaml'))
    .map((file) => file.slice(0, -'.yaml'.length))
    .sort();

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    mcp: { tools: mcpTools, resources: mcpResources },
    plugin: { tools: allPluginTools, pluginOnlyTools },
    dnas: { count: dnas.length, names: dnas },
    engines: { count: engineCount },
    tables: { count: [...sqlite.matchAll(/CREATE TABLE/g)].length },
  };
}

/** Pretty, deterministic JSON so a refresh produces a stable diff. */
export function formatManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const manifest = measureCapabilities();
  const json = formatManifest(manifest);
  if (process.argv.includes('--write')) {
    mkdirSync(join(repoRoot, 'docs/analysis'), { recursive: true });
    writeFileSync(join(repoRoot, MANIFEST_PATH), json, 'utf8');
    console.log(`capabilities: wrote ${MANIFEST_PATH}`);
  } else {
    process.stdout.write(json);
  }
}
