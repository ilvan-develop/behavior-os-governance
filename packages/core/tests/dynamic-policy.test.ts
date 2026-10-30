import { describe, expect, it } from 'vitest';
import { DynamicPolicyEngine } from '../src/engine/dynamic-policy-engine.js';

const baseFactors = {
  denialRate: 0.1,
  anomalyDeviation: 0.05,
  toolDiversity: 0.2,
  offHoursRatio: 0.1,
  recentFailures: 0.05,
};

describe('DynamicPolicyEngine (G-011)', () => {
  it('assesses low risk with mild factors', () => {
    const engine = new DynamicPolicyEngine();
    const result = engine.assessRisk('agent-1', baseFactors);
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(0.25);
    expect(result.adjustedThresholds.denyThreshold).toBe(0.15);
  });

  it('assesses high risk with severe factors', () => {
    const engine = new DynamicPolicyEngine();
    const result = engine.assessRisk('agent-2', {
      denialRate: 0.8,
      anomalyDeviation: 0.7,
      toolDiversity: 0.5,
      offHoursRatio: 0.5,
      recentFailures: 0.8,
    });
    expect(result.level).toBe('high');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.adjustedThresholds.denyThreshold).toBe(0.3);
  });

  it('assesses critical risk with extreme factors', () => {
    const engine = new DynamicPolicyEngine();
    const result = engine.assessRisk('agent-3', {
      denialRate: 1.0,
      anomalyDeviation: 1.0,
      toolDiversity: 1.0,
      offHoursRatio: 1.0,
      recentFailures: 1.0,
    });
    expect(result.level).toBe('critical');
    expect(result.score).toBe(1.0);
  });

  it('creates a dynamic policy with correct multiplier', () => {
    const engine = new DynamicPolicyEngine();
    const lowAssessment = engine.assessRisk('agent-1', baseFactors);
    const lowPolicy = engine.createDynamicPolicy('agent-1', lowAssessment, ['rule-1']);
    expect(lowPolicy.enforcementMultiplier).toBe(0.75);
    expect(lowPolicy.elevatedScrutiny).toBe(false);

    const highAssessment = engine.assessRisk('agent-2', {
      denialRate: 0.8,
      anomalyDeviation: 0.7,
      toolDiversity: 0.5,
      offHoursRatio: 0.5,
      recentFailures: 0.8,
    });
    const highPolicy = engine.createDynamicPolicy('agent-2', highAssessment, ['rule-1']);
    expect(highPolicy.enforcementMultiplier).toBe(1.5);
    expect(highPolicy.elevatedScrutiny).toBe(true);
  });

  it('stores policies per agent', () => {
    const engine = new DynamicPolicyEngine();
    const assessment = engine.assessRisk('agent-1', baseFactors);
    engine.createDynamicPolicy('agent-1', assessment, ['rule-1']);

    expect(engine.getPolicy('agent-1')).toBeDefined();
    expect(engine.getPolicy('agent-2')).toBeUndefined();
    expect(engine.getPolicies()).toHaveLength(1);
  });

  it('records assessments', () => {
    const engine = new DynamicPolicyEngine();
    engine.assessRisk('agent-1', baseFactors);
    engine.assessRisk('agent-1', baseFactors);
    expect(engine.getAssessments()).toHaveLength(2);
  });
});
