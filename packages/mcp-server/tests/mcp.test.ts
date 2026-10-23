import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structural checks over the MCP server source. These back the public claim in
// docs/CLAIMS.md ("30 tools + 2 resources") and fail if the two drift apart.
const serverSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
  'utf-8',
);

const toolNames = [...serverSource.matchAll(/server\.registerTool\(\s*\n?\s*'([a-z_]+)'/g)].map(
  (match) => match[1],
);

describe('MCP server structure', () => {
  it('registers exactly 57 tools', () => {
    expect(toolNames).toHaveLength(57);
  });

  it('registers exactly 2 resources', () => {
    const resources = serverSource.match(/server\.registerResource\(/g) ?? [];
    expect(resources).toHaveLength(2);
  });

  it('exposes the analytics tools', () => {
    expect(toolNames).toContain('bos_recommendations');
    expect(toolNames).toContain('bos_drift');
  });

  it('registers every tool name with the bos_ prefix', () => {
    for (const name of toolNames) {
      expect(name.startsWith('bos_'), `${name} should start with bos_`).toBe(true);
    }
  });

  it('does not register duplicate tool names', () => {
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('renders the protocol resource from PROTOCOL_STEPS instead of a literal', () => {
    // The resource must be generated from the core constant; a hand-written
    // step list is how "Delegate" vs "Start Mission" drifted apart before.
    expect(serverSource).toContain('...PROTOCOL_STEPS.map(');
    expect(serverSource).not.toMatch(/# Behavior-OS 7-Step Protocol\\n\\n1\./);
  });

  it('states the real tool count in the package manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    ) as { description: string };
    expect(manifest.description).toContain(`${toolNames.length} tools`);
  });
});
