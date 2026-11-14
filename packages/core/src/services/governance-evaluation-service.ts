import type { GovernanceDecision } from '@behavior-os/schemas';
import type { LearningEngine } from '../engine/learning-engine.js';
import type { MetricsEngine } from '../engine/metrics-engine.js';

/**
 * Encapsulates the governance evaluation policy that was inlined in
 * `BehaviorOS.evaluateGovernance()`. The service merges DNA rules with
 * active governed policies, applies the lenient-mode softening, and
 * records metrics — without touching the facade's state directly.
 */
export class GovernanceEvaluationService {
  constructor(
    private readonly getLearningEngine: () => LearningEngine,
    private readonly getMetricsEngine: () => MetricsEngine,
    private readonly getFiredRuleActions: (
      decision: GovernanceDecision,
    ) => Array<{ id: string; action: string }>,
  ) {}

  /**
   * Merge active governed policy matches into a DNA decision, apply
   * lenient-mode softening, and record metrics. Returns the final
   * decision.
   */
  evaluate(
    dnaDecision: GovernanceDecision,
    action: string,
    startedAt: number,
    governanceLevel?: string,
  ): GovernanceDecision {
    const policyEvaluation = this.getLearningEngine().evaluateActivePolicies(action);
    const policyDenied = policyEvaluation.verdict === 'deny';

    const decision =
      policyEvaluation.matches.length === 0
        ? dnaDecision
        : (() => {
            const policyRules = policyEvaluation.matches.map((m) => m.ruleId);
            const policyReason = policyEvaluation.matches.map((m) => m.reason).join('; ');
            const verdict =
              policyEvaluation.verdict === 'deny'
                ? ('deny' as const)
                : policyEvaluation.verdict === 'escalate' && dnaDecision.verdict === 'allow'
                  ? ('escalate' as const)
                  : dnaDecision.verdict;
            const policyWarnings = policyEvaluation.matches
              .filter((m) => m.action === 'warn')
              .map((m) => m.reason);
            return {
              ...dnaDecision,
              verdict,
              reason: `${dnaDecision.reason} | Active policy: ${policyReason}`,
              rulesEvaluated: [...dnaDecision.rulesEvaluated, ...policyRules],
              firedRules: [...(dnaDecision.firedRules ?? []), ...policyRules],
              ...(policyWarnings.length > 0
                ? { warnings: [...(dnaDecision.warnings ?? []), ...policyWarnings] }
                : {}),
            };
          })();

    const finalDecision =
      !policyDenied && decision.verdict === 'deny' && governanceLevel === 'lenient'
        ? {
            ...decision,
            verdict: 'escalate' as const,
            reason: `${decision.reason} (softened by lenient governance level)`,
          }
        : decision;

    const warned = finalDecision.verdict === 'allow' && (finalDecision.warnings?.length ?? 0) > 0;
    this.getMetricsEngine().recordGovernance(
      warned ? 'warn' : finalDecision.verdict,
      finalDecision.rulesEvaluated.length,
      Date.now() - startedAt,
      this.getFiredRuleActions(finalDecision),
    );
    return finalDecision;
  }
}
