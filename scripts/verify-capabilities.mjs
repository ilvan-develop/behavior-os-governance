#!/usr/bin/env node
/**
 * Capability manifest gate.
 *
 * Fails when docs/analysis/capabilities.json no longer matches what the source
 * actually registers. Run `node scripts/capabilities.mjs --write` to refresh it
 * after an intentional surface change.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatManifest,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  measureCapabilities,
} from './capabilities.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const current = measureCapabilities();
const expected = formatManifest(current);

let committed;
try {
  committed = readFileSync(join(repoRoot, MANIFEST_PATH), 'utf8');
} catch {
  console.error(`verify-capabilities: ${MANIFEST_PATH} is missing.`);
  console.error('  Run: node scripts/capabilities.mjs --write');
  process.exit(1);
}

if (committed === expected) {
  console.log(
    `verify-capabilities: PASS - ${current.mcp.tools.length} MCP tools, ` +
      `${current.mcp.resources.length} resources, ${current.plugin.tools.length} plugin tools, ` +
      `${current.plugin.pluginOnlyTools.length} plugin-only, ${current.engines.count} engines, ` +
      `${current.dnas.count} DNAs, ${current.tables.count} tables.`,
  );
  process.exit(0);
}

// Actionable diff: name the surface that drifted instead of dumping raw JSON.
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const before = parse(committed);
if (!before || before.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
  console.error(
    `verify-capabilities: committed manifest has an unsupported schema version ` +
      `(expected ${MANIFEST_SCHEMA_VERSION}).`,
  );
  console.error('  Run: node scripts/capabilities.mjs --write');
  process.exit(1);
}

function compareList(label, previous, next) {
  const previousSet = new Set(previous ?? []);
  const nextSet = new Set(next);
  const removed = [...previousSet].filter((item) => !nextSet.has(item));
  const added = [...nextSet].filter((item) => !previousSet.has(item));
  if (removed.length === 0 && added.length === 0) return;
  console.error(`  ${label}:`);
  if (added.length > 0) console.error(`    + ${added.join(', ')}`);
  if (removed.length > 0) console.error(`    - ${removed.join(', ')}`);
}

console.error('verify-capabilities: FAIL - the committed manifest is stale.');
compareList('MCP tools', before.mcp?.tools, current.mcp.tools);
compareList('MCP resources', before.mcp?.resources, current.mcp.resources);
compareList('plugin tools', before.plugin?.tools, current.plugin.tools);
compareList('plugin-only tools', before.plugin?.pluginOnlyTools, current.plugin.pluginOnlyTools);
compareList('DNAs', before.dnas?.names, current.dnas.names);
if (before.engines?.count !== current.engines.count) {
  console.error(`  engines: ${before.engines?.count} -> ${current.engines.count}`);
}
if (before.tables?.count !== current.tables.count) {
  console.error(`  tables: ${before.tables?.count} -> ${current.tables.count}`);
}
console.error('  Run: node scripts/capabilities.mjs --write');
process.exit(1);
