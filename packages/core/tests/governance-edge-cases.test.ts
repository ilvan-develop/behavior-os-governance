import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { GovernanceEngine } from '../src/engine/governance-engine.js';

describe('GovernanceEngine Edge Cases', () => {
  const createDNA = (rules: any[]): DNA => ({
    name: 'Edge Test',
    version: '1.0.0',
    description: 'Edge case tests',
    personas: [],
    governance: rules,
    quality: [],
  });

  it('should handle null context', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: null as any,
    });
    expect(result.verdict).toBe('allow');
  });

  it('should handle empty context', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: {},
    });
    expect(result.verdict).toBe('allow');
  });

  it('should handle very long action names', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const longAction = 'x'.repeat(1000);
    const result = engine.evaluate({
      action: longAction,
      agentId: 'agent-1',
      context: {},
    });
    expect(result.action).toBe(longAction);
  });

  it('should handle Unicode in action names', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: '测试操作',
      agentId: 'agent-1',
      context: {},
    });
    expect(result.action).toBe('测试操作');
  });

  it('should handle special characters in agentId', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent@123!#$%',
      context: {},
    });
    expect(result.agentId).toBe('agent@123!#$%');
  });

  it('should handle very long rule IDs', () => {
    const longRuleId = 'rule-' + 'x'.repeat(1000);
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: longRuleId,
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'test', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { test: true },
    });

    expect(result.rulesEvaluated).toContain(longRuleId);
  });

  it('should handle zero thresholds in conditions', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'zero-test',
          level: 'low',
          action: 'warn',
          conditions: [{ type: 'count', value: 0 }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { count: 0 },
    });

    expect(result.verdict).toBe('allow');
  });

  it('should handle boolean false values', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'false-test',
          level: 'low',
          action: 'log',
          conditions: [{ type: 'enabled', value: false }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { enabled: false },
    });

    expect(result.verdict).toBe('allow');
  });

  it('should handle undefined condition values', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'undefined-test',
          level: 'low',
          action: 'warn',
          conditions: [{ type: 'flag', value: undefined }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { flag: undefined },
    });

    expect(result.verdict).toBe('allow');
  });

  it('should handle NaN values in context', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { nan: NaN },
    });
    expect(result.verdict).toBe('allow');
  });

  it('should handle infinite values', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { inf: Infinity, negInf: -Infinity },
    });
    expect(result.verdict).toBe('allow');
  });

  it('should handle large number of rules', () => {
    const rules = Array.from({ length: 100 }, (_, i) => ({
      id: `rule-${i}`,
      level: 'low' as const,
      action: 'log' as const,
      conditions: [{ type: `condition-${i}`, value: true }],
    }));

    const engine = new GovernanceEngine(createDNA(rules));

    // Only first rule should match
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { 'condition-0': true },
    });

    expect(result.rulesEvaluated.length).toBeGreaterThan(0);
  });

  it('should handle duplicate rule IDs', () => {
    const engine = new GovernanceEngine(
      createDNA([
        { id: 'dup', level: 'high', action: 'block', conditions: [] },
        { id: 'dup', level: 'low', action: 'log', conditions: [] },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: {},
    });

    // Should not crash
    expect(result).toBeDefined();
  });

  it('should handle missing missionId', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: {},
      missionId: undefined,
    });

    expect(result.missionId).toBeUndefined();
  });

  it('should preserve all original fields in decision', () => {
    const engine = new GovernanceEngine(createDNA([]));
    const originalAction = 'original-action';
    const originalAgentId = 'original-agent';
    const originalContext = { key: 'value', num: 42 };

    const result = engine.evaluate({
      action: originalAction,
      agentId: originalAgentId,
      context: originalContext,
    });

    expect(result.action).toBe(originalAction);
    expect(result.agentId).toBe(originalAgentId);
  });
});
