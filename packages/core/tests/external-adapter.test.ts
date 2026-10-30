import { describe, expect, it } from 'vitest';
import { ExternalSystemAdapter } from '../src/engine/external-adapter-engine.js';

describe('ExternalSystemAdapter (G-019)', () => {
  it('exports audit logs to a SIEM', () => {
    const engine = new ExternalSystemAdapter();
    const logs = [
      { action: 'deploy', agentId: 'agent-1', verdict: 'allow', timestamp: '2024-01-01T00:00:00Z' },
      {
        action: 'read-env',
        agentId: 'agent-2',
        verdict: 'deny',
        timestamp: '2024-01-01T00:01:00Z',
      },
    ];

    const result = engine.exportAuditLogs(logs, 'siem-prod');
    expect(result.exported).toBe(2);
    expect(result.target).toBe('siem-prod');
    expect(result.batchId).toMatch(/^batch-/);
  });

  it('imports policies from external systems', () => {
    const engine = new ExternalSystemAdapter();
    const externalRules = [
      {
        id: 'rule-1',
        action: 'block',
        conditions: [{ type: 'resource', value: 'secrets' }],
        description: 'Block secret access',
      },
    ];

    const imported = engine.importPolicies(externalRules, 'OPA');
    expect(imported).toHaveLength(1);
    expect(imported[0].source).toBe('OPA');
    expect(imported[0].ruleId).toBe('rule-1');

    expect(engine.getImportedPolicies()).toHaveLength(1);
  });

  it('receives events from external message buses', () => {
    const engine = new ExternalSystemAdapter();

    const event = engine.receiveEvent({
      source: 'kafka-topic-1',
      type: 'security-alert',
      payload: { severity: 'high', message: 'unauthorized access' },
    });

    expect(event.id).toMatch(/^ext-/);
    expect(event.source).toBe('kafka-topic-1');
    expect(event.payload.severity).toBe('high');

    expect(engine.getEvents()).toHaveLength(1);
  });

  it('clears all state', () => {
    const engine = new ExternalSystemAdapter();
    engine.receiveEvent({ source: 'test', type: 'test', payload: {} });
    engine.clear();
    expect(engine.getEvents()).toHaveLength(0);
    expect(engine.getImportedPolicies()).toHaveLength(0);
  });
});
