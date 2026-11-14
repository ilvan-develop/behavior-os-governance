import type { GovernanceDecision } from '@behavior-os/schemas';
import { describe, expect, it, vi } from 'vitest';
import type { LearningEngine, PolicyEnforcementEvaluation } from '../src/engine/learning-engine.js';
import type { MetricsEngine } from '../src/engine/metrics-engine.js';
import { GovernanceEvaluationService } from '../src/services/governance-evaluation-service.js';

/**
 * Unit tests for the policy-merge logic extracted from
 * `BehaviorOS.evaluateGovernance()` in Phase 3. The integration path is already
 * covered by `policy-versioning.test.ts`; these tests isolate the service so a
 * regression in the merge/lenient rules fails here without spinning up a DNA,
 * a store or a full BehaviorOS instance.
 */

interface RecordedGovernance {
  verdict: string;
  rulesEvaluated: number;
  latencyMs: number;
  firedRules?: Array<{ id: string; action: string }>;
}

function dnaDecision(overrides: Partial<GovernanceDecision> = {}): GovernanceDecision {
  return {
    id: 'gov-unit-1',
    action: 'deploy production',
    verdict: 'allow',
    reason: 'Allowed by DNA',
    rulesEvaluated: ['dna-allow'],
    timestamp: '2026-11-13T00:00:00.000Z',
    agentId: 'architect',
    ...overrides,
  };
}

function makeService(evaluation: PolicyEnforcementEvaluation) {
  const learning = {
    evaluateActivePolicies: vi.fn(() => evaluation),
  } as unknown as LearningEngine;

  const recorded: RecordedGovernance[] = [];
  const metrics = {
    recordGovernance: (
      verdict: string,
      rulesEvaluated: number,
      latencyMs: number,
      firedRules?: Array<{ id: string; action: string }>,
    ) => {
      recorded.push({ verdict, rulesEvaluated, latencyMs, firedRules });
    },
  } as unknown as MetricsEngine;

  const firedRuleActions = vi.fn((decision: GovernanceDecision) =>
    (decision.firedRules ?? []).map((id) => ({ id, action: 'block' })),
  );

  const service = new GovernanceEvaluationService(
    () => learning,
    () => metrics,
    firedRuleActions,
  );
  return { service, recorded, firedRuleActions };
}

const NO_POLICIES: PolicyEnforcementEvaluation = { verdict: 'allow', matches: [] };

describe('GovernanceEvaluationService', () => {
  it('returns the DNA decision unchanged when no policy matches', () => {
    const { service, recorded } = makeService(NO_POLICIES);
    const decision = dnaDecision();

    const result = service.evaluate(decision, 'deploy production', Date.now());

    expect(result).toBe(decision);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.verdict).toBe('allow');
    expect(recorded[0]?.rulesEvaluated).toBe(1);
  });

  it('merges a blocking policy into the decision as a deny', () => {
    const { service, recorded, firedRuleActions } = makeService({
      verdict: 'deny',
      matches: [
        {
          policyId: 'policy:freeze',
          versionId: 'v1',
          action: 'block',
          severity: 'critical',
          ruleId: 'policy:v1',
          reason: 'Friday deploy freeze is active',
        },
      ],
    });

    const result = service.evaluate(dnaDecision(), 'deploy production', Date.now());

    expect(result.verdict).toBe('deny');
    expect(result.reason).toContain('Active policy');
    expect(result.reason).toContain('Friday deploy freeze is active');
    expect(result.rulesEvaluated).toContain('policy:v1');
    expect(result.firedRules).toContain('policy:v1');
    expect(recorded[0]?.verdict).toBe('deny');
    expect(firedRuleActions).toHaveBeenCalledWith(result);
  });

  it('escalates an allow when an active policy requires escalation', () => {
    const { service } = makeService({
      verdict: 'escalate',
      matches: [
        {
          policyId: 'policy:review',
          versionId: 'v2',
          action: 'require',
          severity: 'high',
          ruleId: 'policy:v2',
          reason: 'Human review required',
        },
      ],
    });

    const result = service.evaluate(dnaDecision(), 'deploy production', Date.now());

    expect(result.verdict).toBe('escalate');
  });

  it('keeps an allow but surfaces policy warnings, and records the warn bucket', () => {
    const { service, recorded } = makeService({
      verdict: 'warn',
      matches: [
        {
          policyId: 'policy:warn',
          versionId: 'v3',
          action: 'warn',
          severity: 'low',
          ruleId: 'policy:v3',
          reason: 'Deploying near a holiday',
        },
      ],
    });

    const result = service.evaluate(dnaDecision(), 'deploy production', Date.now());

    expect(result.verdict).toBe('allow');
    expect(result.warnings).toContain('Deploying near a holiday');
    // A warned-but-allowed decision is counted in the `warn` bucket.
    expect(recorded[0]?.verdict).toBe('warn');
  });

  it('does not soften a policy deny under lenient governance (human activation wins)', () => {
    const { service } = makeService({
      verdict: 'deny',
      matches: [
        {
          policyId: 'policy:freeze',
          versionId: 'v1',
          action: 'block',
          severity: 'critical',
          ruleId: 'policy:v1',
          reason: 'Friday deploy freeze is active',
        },
      ],
    });

    const result = service.evaluate(dnaDecision(), 'deploy production', Date.now(), 'lenient');

    expect(result.verdict).toBe('deny');
  });

  it('softens a DNA deny into an escalation under lenient governance', () => {
    const { service } = makeService(NO_POLICIES);
    const decision = dnaDecision({ verdict: 'deny', reason: 'DNA blocked it' });

    const result = service.evaluate(decision, 'deploy production', Date.now(), 'lenient');

    expect(result.verdict).toBe('escalate');
    expect(result.reason).toContain('softened by lenient governance level');
  });

  it('leaves a DNA deny untouched outside lenient governance', () => {
    const { service } = makeService(NO_POLICIES);
    const decision = dnaDecision({ verdict: 'deny', reason: 'DNA blocked it' });

    const result = service.evaluate(decision, 'deploy production', Date.now(), 'strict');

    expect(result.verdict).toBe('deny');
    expect(result.reason).toBe('DNA blocked it');
  });
});
