import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Structural checks over the MCP server source. These back the public claim in
// docs/CLAIMS.md ("23 tools + 2 resources") and fail if the two drift apart.
const serverSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
  'utf-8',
);

const toolNames = [...serverSource.matchAll(/server\.registerTool\(\s*\n?\s*'([a-z_]+)'/g)].map(
  (match) => match[1],
);

describe('MCP server structure', () => {
  it('registers exactly 23 tools', () => {
    expect(toolNames).toHaveLength(23);
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
});
