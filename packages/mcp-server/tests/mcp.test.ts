import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/version.js';

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
  it('wires the BEHAVIOROS_EVOLUTION opt-in flag into the BehaviorOS config', () => {
    // The learning→governance loop only closes when a host can pass
    // evolution.enabled; this keeps the env flag from silently disappearing.
    expect(serverSource).toContain("process.env.BEHAVIOROS_EVOLUTION === 'true'");
    expect(serverSource).toContain('evolution:');
  });

  it('promotes learning records through the same contract as the plugin host', () => {
    // Cross-host lifecycle parity: MCP bos_record_learning must accept
    // learningId/stage/evidence and route to advanceLearningRecord, exactly
    // like the plugin tool handler does.
    expect(serverSource).toContain('learningId');
    expect(serverSource).toContain('advanceLearningRecord');
    expect(serverSource).toContain("actor: 'mcp'");
  });

  it('registers exactly 85 tools', () => {
    expect(toolNames).toHaveLength(85);
  });

  it('exposes the consensus and cross-DNA transfer engines', () => {
    expect(toolNames).toContain('bos_resolve_consensus');
    expect(toolNames).toContain('bos_suggest_cross_dna_transfer');
  });

  it('exposes the pragmatic value assessment tool', () => {
    expect(toolNames).toContain('bos_assess_pragmatic_value');
  });

  it('exposes the prediction tool', () => {
    expect(toolNames).toContain('bos_predict_governance');
  });

  it('exposes the cognitive load balancer tools', () => {
    expect(toolNames).toContain('bos_register_agent_capacity');
    expect(toolNames).toContain('bos_assign_task');
    expect(toolNames).toContain('bos_complete_task');
    expect(toolNames).toContain('bos_analyze_workload');
    expect(toolNames).toContain('bos_recommend_assignment');
  });

  it('exposes the natural language rules tools', () => {
    expect(toolNames).toContain('bos_parse_rule');
    expect(toolNames).toContain('bos_parse_rules_batch');
    expect(toolNames).toContain('bos_apply_natural_language_rules');
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

  it('mirrors plugin protocol advancement on bos_list_dna and bos_get_state', () => {
    // Finding: MCP server stalled at step 1 after select_dna because bos_list_dna
    // and bos_get_state never called advanceProtocolStep — unlike the plugin host.
    expect(serverSource).toContain("advanceProtocolStep('bos_list_dna')");
    expect(serverSource).toContain("advanceProtocolStep('bos_get_state')");
  });

  it('states the real tool count in the package manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    ) as { description: string };
    expect(manifest.description).toContain(`${toolNames.length} tools`);
  });

  it('reports the published package version to MCP clients, not a literal', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(SERVER_VERSION, 'serverInfo.version must match the registry version').toBe(pkg.version);
    expect(serverSource, 'both server instances must use the shared constant').toContain(
      'version: SERVER_VERSION',
    );
    expect(
      serverSource,
      'a hardcoded serverInfo.version drifts from package.json and hides which engine a host runs',
    ).not.toMatch(/new McpServer\(\{[^}]*version: ['"]\d+\.\d+\.\d+['"]/);
  });
});
