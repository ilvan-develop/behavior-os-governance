import type { GovernanceDecision, GovernanceRule } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { CounterfactualAuditEngine } from '../src/engine/counterfactual-audit-engine.js';

function makeDecision(): GovernanceDecision {
  return {
    id: 'dec-1',
    action: 'deploy-prod',
    agentId: 'agent-1',
    verdict: 'deny',
    reason: 'Block rule fired',
    rulesEvaluated: ['block-rule', 'warn-rule'],
    firedRules: ['block-rule'],
    timestamp: new Date().toISOString(),
  };
}

function makeRules(): GovernanceRule[] {
  return [
    {
      id: 'block-rule',
      level: 'critical',
      action: 'block',
      conditions: [{ type: 'action', value: 'deploy-prod' }],
      description: 'Block production deploys without approval',
    },
    {
      id: 'warn-rule',
      level: 'medium',
      action: 'warn',
      conditions: [{ type: 'tool', value: 'shell' }],
      description: 'Warn on shell usage',
    },
  ];
}

describe('CounterfactualAuditEngine (G-017)', () => {
  it('detects when removing a load-bearing rule changes the verdict', () => {
    const engine = new CounterfactualAuditEngine();
    const decision = makeDecision();

    // Without the block rule, the deploy would be allowed
    const result = engine.wasRuleLoadBearing(decision, 'block-rule', makeRules(), (rules) =>
      rules.some((r) => r.action === 'block') ? 'deny' : 'allow',
    );

    expect(result.hypotheticalVerdict).toBe('allow');
    expect(result.actualVerdict).toBe('deny');
    expect(result.diverged).toBe(true);
    expect(result.explanation).toContain('would have been');
  });

  it('confirms when removing a non-critical rule does not change the verdict', () => {
    const engine = new CounterfactualAuditEngine();
    const decision = makeDecision();

    // Removing the warn rule doesn't affect the deny verdict
    const result = engine.wasRuleLoadBearing(decision, 'warn-rule', makeRules(), (rules) =>
      rules.some((r) => r.action === 'block') ? 'deny' : 'allow',
    );

    expect(result.hypotheticalVerdict).toBe('deny');
    expect(result.actualVerdict).toBe('deny');
    expect(result.diverged).toBe(false);
    expect(result.explanation).toContain('does NOT change');
  });

  it('replays a custom modification', () => {
    const engine = new CounterfactualAuditEngine();
    const decision = makeDecision();

    const result = engine.replay(
      decision,
      makeRules(),
      'agent was not authorized',
      () => 'escalate',
    );

    expect(result.hypotheticalVerdict).toBe('escalate');
    expect(result.actualVerdict).toBe('deny');
    expect(result.diverged).toBe(true);
    expect(result.modification).toBe('agent was not authorized');
  });

  it('records all results', () => {
    const engine = new CounterfactualAuditEngine();
    const decision = makeDecision();

    engine.wasRuleLoadBearing(decision, 'block-rule', makeRules(), (rules) =>
      rules.some((r) => r.action === 'block') ? 'deny' : 'allow',
    );
    engine.wasRuleLoadBearing(decision, 'warn-rule', makeRules(), (rules) =>
      rules.some((r) => r.action === 'block') ? 'deny' : 'allow',
    );

    expect(engine.getResults()).toHaveLength(2);
  });
});
