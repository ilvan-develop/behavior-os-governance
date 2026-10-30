/**
 * Integration test: verifies that the event-monitor wiring actually
 * invokes Phase 4 engines when real events flow through a real
 * BehaviorOS instance (no mocks).
 */
import { spawn } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '..', '..', '..');

function runScript(
  script: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const tmpFile = path.join(repoRoot, 'plugins', 'opencode-v2', 'tests', '_integration_tmp.cjs');
    writeFileSync(tmpFile, script);

    let stdout = '';
    let stderr = '';
    const child = spawn('node', [tmpFile], {
      cwd: repoRoot,
      env: { ...process.env, BEHAVIOROS_AUTONOMOUS: 'false' },
    });

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      try {
        unlinkSync(tmpFile);
      } catch {}
      resolve({ stdout, stderr, exitCode: code });
    });

    setTimeout(() => {
      try {
        unlinkSync(tmpFile);
      } catch {}
      child.kill();
      resolve({ stdout, stderr, exitCode: -1 });
    }, 15000);
  });
}

const SCRIPT = `
const repoRoot = '${repoRoot.replace(/\\/g, '/')}';
const { BehaviorOS } = require(repoRoot + '/packages/core/dist/index.js');
const { subscribeToGovernanceEvents } = require(repoRoot + '/plugins/opencode-v2/dist/event-monitor.js');

async function run() {
  const bos = new BehaviorOS({ persistence: undefined });
  // Load a DNA so counterfactual audit has rules to inspect
  await bos.loadDNA({
    name: 'test',
    version: '1.0.0',
    description: 'test DNA',
    personas: [],
    governance: [{ id: 'rule-1', level: 'medium', action: 'block', conditions: [] }],
    quality: []
  });
  bos.resolveAgentIdentity();
  const calls = {};
  const engines = [
    'temporal', 'anomaly', 'circuit', 'experiential', 'dynamic', 'value',
    'external', 'memory', 'hybrid', 'counterfactual', 'explainable', 'collective',
  ];
  for (const e of engines) calls[e] = 0;

  // Wrap engine getters
  const wrap = (name, method) => {
    const orig = bos[method].bind(bos);
    bos[method] = () => { calls[name]++; return orig(); };
  };
  wrap('temporal', 'getTemporalPattern');
  wrap('anomaly', 'getAnomalyDetection');
  wrap('circuit', 'getCircuitBreakerIntelligence');
  wrap('experiential', 'getExperientialLearning');
  wrap('dynamic', 'getDynamicPolicy');
  wrap('value', 'getValueAlignment');
  wrap('external', 'getExternalSystemAdapter');
  wrap('memory', 'getMemoryConsolidation');
  wrap('hybrid', 'getHybridEvaluation');
  wrap('counterfactual', 'getCounterfactualAudit');
  wrap('explainable', 'getExplainableReport');
  wrap('collective', 'getCollectiveIntelligence');

  // Simulate OpenCode event stream — includes a denial to exercise counterfactual + collective paths
  const events = [
    { type: 'session.tool.called', tool: 'bash', verdict: 'allow', sessionID: 's1', timestamp: new Date().toISOString() },
    { type: 'session.tool.failed', tool: 'write', error: 'err', sessionID: 's1', timestamp: new Date().toISOString() },
    { type: 'session.permission.requested', action: 'write', verdict: 'allow', sessionID: 's1', timestamp: new Date().toISOString() },
    { type: 'session.permission.requested', action: 'deploy', verdict: 'deny', reason: 'production blocked', sessionID: 's1', timestamp: new Date().toISOString() },
  ];
  let i = 0;
  const mockEvent = { subscribe: async function* () { while (i < events.length) yield events[i++]; } };
  const cleanup = await subscribeToGovernanceEvents({ event: mockEvent }, bos);
  await new Promise(r => setTimeout(r, 100));
  cleanup();

  console.log('RESULT:' + JSON.stringify(calls));
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
`;

describe('Engine integration through real event flow', () => {
  it('Phase 4 engines are invoked by event-monitor with real BehaviorOS', async () => {
    const { stdout, stderr, exitCode } = await runScript(SCRIPT);
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT:'));
    expect(line, `No RESULT line. stdout=${stdout} stderr=${stderr} exit=${exitCode}`).toBeTruthy();
    const calls = JSON.parse(line?.replace('RESULT:', '') ?? '{}');
    // Phase 2 engines (tool/event routing)
    expect(calls.temporal, 'temporal').toBeGreaterThan(0);
    expect(calls.anomaly, 'anomaly').toBeGreaterThan(0);
    expect(calls.circuit, 'circuit').toBeGreaterThan(0);
    expect(calls.experiential, 'experiential').toBeGreaterThan(0);
    expect(calls.dynamic, 'dynamic').toBeGreaterThan(0);
    expect(calls.value, 'value').toBeGreaterThan(0);
    // Phase 4 engines (added via event-monitor wiring)
    expect(calls.external, 'external-system-adapter').toBeGreaterThan(0);
    expect(calls.memory, 'memory-consolidation').toBeGreaterThan(0);
    expect(calls.hybrid, 'hybrid-evaluation').toBeGreaterThan(0);
    expect(calls.counterfactual, 'counterfactual-audit').toBeGreaterThan(0);
    expect(calls.explainable, 'explainable-report').toBeGreaterThan(0);
    expect(calls.collective, 'collective-intelligence').toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  }, 20000);
});
