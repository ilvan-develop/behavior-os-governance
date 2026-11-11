#!/usr/bin/env node
/**
 * Gate: the MCP and OpenCode plugin tool surfaces must describe the same
 * tools with the same input contract.
 *
 * Requires a build (reads both `dist/` entry points). Run:
 *   pnpm build && pnpm verify:tool-parity
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMcpTools, collectPluginTools, compareSurfaces } from './tool-parity.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Prove the comparator can fail. A gate that cannot go red is not a gate, and
 * this self-test runs without a build, so the guard itself is always testable.
 */
function selfTest() {
  const tool = (name, properties, required = []) => ({
    name,
    description: name,
    properties: [...properties].sort(),
    required: [...required].sort(),
  });
  const cases = [
    {
      label: 'identical surfaces pass',
      mcp: [tool('bos_a', ['x'], ['x'])],
      plugin: [tool('bos_a', ['x'], ['x'])],
      expectFailure: false,
    },
    {
      label: 'undeclared plugin-only tool fails',
      mcp: [],
      plugin: [tool('bos_extra', [])],
      expectFailure: true,
    },
    {
      label: 'declared plugin-only tool is intentional',
      mcp: [],
      plugin: [tool('bos_start_loop', [])],
      expectFailure: false,
    },
    {
      label: 'input property drift fails',
      mcp: [tool('bos_a', ['x', 'onlyMcp'])],
      plugin: [tool('bos_a', ['x'])],
      expectFailure: true,
    },
    {
      label: 'required drift fails',
      mcp: [tool('bos_a', ['x'], ['x'])],
      plugin: [tool('bos_a', ['x'])],
      expectFailure: true,
    },
    {
      label: 'tool missing from the plugin fails',
      mcp: [tool('bos_only_mcp', [])],
      plugin: [],
      expectFailure: true,
    },
  ];

  let failed = false;
  for (const testCase of cases) {
    const { failures } = compareSurfaces(testCase.mcp, testCase.plugin);
    const detected = failures.length > 0;
    const ok = detected === testCase.expectFailure;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${testCase.label}`);
    if (!ok) failed = true;
  }
  if (failed) {
    console.error('verify-tool-parity: self-test FAIL - the comparator is blind to drift.');
    process.exit(1);
  }
  console.log('verify-tool-parity: self-test PASS - the comparator detects every drift case.');
  process.exit(0);
}

if (process.argv.includes('--self-test')) {
  selfTest();
}

try {
  const [mcpTools, pluginTools] = await Promise.all([
    collectMcpTools(repoRoot),
    collectPluginTools(repoRoot),
  ]);
  const { failures, intentional, shared } = compareSurfaces(mcpTools, pluginTools);

  if (failures.length > 0) {
    console.error('verify-tool-parity: FAIL - the two surfaces disagree.');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      `  MCP ${mcpTools.length} tools, plugin ${pluginTools.length} tools, ${shared} shared.`,
    );
    console.error('  Fix the schema that drifted, or declare the difference in INTENTIONAL.');
    process.exit(1);
  }

  console.log(
    `verify-tool-parity: PASS - ${mcpTools.length} MCP tools, ${pluginTools.length} plugin tools, ` +
      `${shared} shared with identical inputs, ${intentional.length} declared difference(s).`,
  );
  for (const note of intentional) console.log(`  ~ ${note}`);
} catch (error) {
  console.error('verify-tool-parity: FAIL - could not measure the surfaces.');
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error('  Did you run `pnpm build` first?');
  process.exit(1);
}
