import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { DynamicDNAManager } from '../src/engine/dynamic-dna.js';

describe('DynamicDNAManager', () => {
  const baseDna: DNA = {
    name: 'Base DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [
      {
        id: 'rule-1',
        level: 'high',
        action: 'warn',
        conditions: [{ type: 'test', value: true }],
        description: 'Test rule',
      },
    ],
    quality: [],
  };

  it('creates a dynamic DNA', () => {
    const manager = new DynamicDNAManager();
    const dynamic = manager.createDynamicDNA('dynamic-1', baseDna);
    expect(dynamic.baseDna.name).toBe('Base DNA');
    expect(dynamic.overrides).toHaveLength(0);
  });

  it('adds a rule override', () => {
    const manager = new DynamicDNAManager();
    manager.createDynamicDNA('dynamic-1', baseDna);
    const result = manager.addOverride(
      'dynamic-1',
      'rule-1',
      'block',
      undefined,
      'Test reason',
      'agent-1',
    );
    expect(result.success).toBe(true);
  });

  it('gets effective DNA with overrides', () => {
    const manager = new DynamicDNAManager();
    manager.createDynamicDNA('dynamic-1', baseDna);
    manager.addOverride('dynamic-1', 'rule-1', 'block', undefined, 'Test', 'agent-1');

    const effective = manager.getEffectiveDNA('dynamic-1');
    expect(effective).not.toBeNull();
    if (!effective) throw new Error('Expected effective DNA');
    const rule = effective.governance.find((r) => r.id === 'rule-1');
    expect(rule?.action).toBe('block');
  });

  it('adds a temporary rule', () => {
    const manager = new DynamicDNAManager();
    manager.createDynamicDNA('dynamic-1', baseDna);
    const result = manager.addTempRule(
      'dynamic-1',
      { id: 'temp-1', level: 'critical', action: 'block', conditions: [], description: 'Temp' },
      'Reason',
      'agent-1',
      new Date(Date.now() + 3600000).toISOString(),
    );
    expect(result.success).toBe(true);
  });

  it('adds a custom quality gate', () => {
    const manager = new DynamicDNAManager();
    manager.createDynamicDNA('dynamic-1', baseDna);
    const result = manager.addCustomGate(
      'dynamic-1',
      'gate-1',
      'test_coverage',
      95,
      'gte',
      'Reason',
      'agent-1',
    );
    expect(result.success).toBe(true);
  });

  it('removes expired temp rules', () => {
    const manager = new DynamicDNAManager();
    manager.createDynamicDNA('dynamic-1', baseDna);
    manager.addTempRule(
      'dynamic-1',
      { id: 'temp-1', level: 'high', action: 'warn', conditions: [], description: 'Expired' },
      'Reason',
      'agent-1',
      new Date(Date.now() - 3600000).toISOString(), // expired
    );

    const effective = manager.getEffectiveDNA('dynamic-1');
    expect(effective?.governance.find((r) => r.id === 'temp-1')).toBeUndefined();
  });
});
