import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { GovernanceEngine } from '../src/engine/governance-engine.js';

describe('GovernanceEngine Advanced', () => {
  const createDNA = (rules: unknown[]): DNA => ({
    name: 'Test',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: rules as DNA['governance'],
    quality: [],
  });

  it('should evaluate rules in priority order', () => {
    const engine = new GovernanceEngine(
      createDNA([
        { id: 'low', level: 'low', action: 'log', conditions: [{ type: 'low', value: true }] },
        { id: 'high', level: 'high', action: 'block', conditions: [{ type: 'high', value: true }] },
        {
          id: 'critical',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'critical', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { low: true, high: true, critical: true },
    });

    // Should use highest severity
    expect(result.verdict).toBe('deny');
    expect(result.rulesEvaluated).toContain('critical');
  });

  it('should allow transform verdict', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'transform-rule',
          level: 'medium',
          action: 'transform',
          conditions: [{ type: 'transform', value: true }],
          description: 'Transform blocked actions',
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'unsafe-op',
      agentId: 'agent-1',
      context: { transform: true },
    });

    // Transform should convert to allowed with note
    expect(result.transformed).toBeDefined();
  });

  it('should handle empty conditions as pass-through', () => {
    const engine = new GovernanceEngine(
      createDNA([{ id: 'always-block', level: 'critical', action: 'block', conditions: [] }]),
    );

    const result = engine.evaluate({
      action: 'anything',
      agentId: 'agent-1',
      context: {},
    });

    // Empty conditions should match everything
    expect(result.verdict).toBe('deny');
  });

  it('should cache decisions for same inputs', () => {
    const engine = new GovernanceEngine(createDNA([]));

    const r1 = engine.evaluate({ action: 'test', agentId: 'agent-1', context: {} });
    const r2 = engine.evaluate({ action: 'test', agentId: 'agent-1', context: {} });

    expect(r1.action).toBe(r2.action);
    expect(r1.verdict).toBe(r2.verdict);
    expect(r1.agentId).toBe(r2.agentId);
  });

  it('should return comprehensive decision info', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'rule-1',
          level: 'high',
          action: 'warn',
          conditions: [{ type: 'test', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test-action',
      agentId: 'agent-1',
      context: { test: true },
      missionId: 'mission-1',
    });

    expect(result).toMatchObject({
      id: expect.any(String),
      action: 'test-action',
      agentId: 'agent-1',
      verdict: 'allow',
      reason: expect.stringContaining('rule-1'),
      rulesEvaluated: expect.arrayContaining(['rule-1']),
      timestamp: expect.any(String),
      missionId: 'mission-1',
    });
  });
});
