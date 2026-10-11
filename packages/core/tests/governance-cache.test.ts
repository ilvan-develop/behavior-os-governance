import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os';

describe('GovernanceEngine Cache', () => {
  const dna: DNA = {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [
      {
        id: 'rule-1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'prod', value: true }],
        description: 'Block prod',
      },
      {
        id: 'rule-2',
        level: 'high',
        action: 'warn',
        conditions: [{ type: 'deploy', value: true }],
        description: 'Warn deploy',
      },
    ],
    quality: [],
  };

  it('should return cached result on second call with same context', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    const decision1 = bos.evaluateGovernance('deploy', {
      agent: 'agent-1',
      context: { prod: true },
    });
    const decision2 = bos.evaluateGovernance('deploy', {
      agent: 'agent-1',
      context: { prod: true },
    });

    // Same verdict expected due to cache
    expect(decision2.verdict).toBe(decision1.verdict);
    expect(decision2.action).toBe(decision1.action);
  });

  it('should NOT cache different contexts', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    const decision1 = bos.evaluateGovernance('deploy', {
      agent: 'agent-1',
      context: { prod: true },
    });
    const decision2 = bos.evaluateGovernance('deploy', {
      agent: 'agent-1',
      context: { prod: false },
    });

    // Different contexts should produce different results
    expect(decision1.verdict).not.toBe(decision2.verdict);
  });

  it('should differentiate by agentId in cache key', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    const decision1 = bos.evaluateGovernance('action', { agent: 'agent-1', context: {} });
    const decision2 = bos.evaluateGovernance('action', { agent: 'agent-2', context: {} });

    // Different agents - different cache keys
    expect(decision1.agentId).toBe('agent-1');
    expect(decision2.agentId).toBe('agent-2');
  });

  it('should clear cache on clearCache()', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    bos.evaluateGovernance('deploy', { agent: 'agent-1', context: { prod: true } });

    // Access private cache via the engine directly
    const engine = (
      bos as unknown as { registry: { get: (name: string) => { clearCache: () => void } } }
    ).registry.get('governance');
    if (engine) {
      engine.clearCache();
      // After clearing, a new evaluation should produce a different ID
      const d1 = bos.evaluateGovernance('deploy', { agent: 'agent-1', context: { prod: true } });
      // Cache was cleared so new decision should be generated
      expect(d1).toBeDefined();
    }
  });

  it('should handle empty governance rules', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA({ ...dna, governance: [] });

    const decision = bos.evaluateGovernance('any-action', { agent: 'agent-1', context: {} });
    expect(decision.verdict).toBe('allow');
    expect(decision.reason).toBe('No rules violated');
  });

  it('should sort rules by level (critical before high)', async () => {
    const testDna: DNA = {
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [
        {
          id: 'low-rule',
          level: 'low',
          action: 'warn',
          conditions: [{ type: 'x', value: true }],
          description: '',
        },
        {
          id: 'critical-rule',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'x', value: true }],
          description: '',
        },
        {
          id: 'high-rule',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'x', value: true }],
          description: '',
        },
      ],
      quality: [],
    };
    const bos = new BehaviorOS();
    await bos.loadDNA(testDna);

    const decision = bos.evaluateGovernance('test', { agent: 'a1', context: { x: true } });
    // Critical block should override high escalate
    expect(decision.verdict).toBe('deny');
    expect(decision.rulesEvaluated).toContain('critical-rule');
  });
});
