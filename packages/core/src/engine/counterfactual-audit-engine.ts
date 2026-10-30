import type { GovernanceDecision, GovernanceRule } from '@behavior-os/schemas';

/**
 * G-017: Counterfactual Audit Trail.
 *
 * Replays governance decisions under hypothetical modifications
 * ("what if rule X had been absent?", "what if the agent was different?")
 * to support forensic analysis.
 */

interface CounterfactualResult {
  id: string;
  originalDecisionId: string;
  modification: string;
  hypotheticalVerdict: 'allow' | 'deny' | 'escalate' | 'warn' | 'transform';
  actualVerdict: 'allow' | 'deny' | 'escalate' | 'warn' | 'transform';
  diverged: boolean;
  explanation: string;
  timestamp: string;
}

export class CounterfactualAuditEngine {
  private results: CounterfactualResult[] = [];

  replay(
    original: GovernanceDecision,
    modifiedRules: GovernanceRule[],
    modification: string,
    reevaluate: (rules: GovernanceRule[]) => 'allow' | 'deny' | 'escalate' | 'warn' | 'transform',
  ): CounterfactualResult {
    const hypotheticalVerdict = reevaluate(modifiedRules);
    const actualVerdict = original.verdict;
    const diverged = hypotheticalVerdict !== actualVerdict;

    let explanation: string;
    if (!diverged) {
      explanation = `Counterfactual replay: removing/modifying [${modification}] does NOT change the verdict (${actualVerdict}).`;
    } else {
      explanation = `Counterfactual replay: without [${modification}], the verdict would have been '${hypotheticalVerdict}' instead of '${actualVerdict}'.`;
    }

    const result: CounterfactualResult = {
      id: `cf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      originalDecisionId: original.id,
      modification,
      hypotheticalVerdict,
      actualVerdict,
      diverged,
      explanation,
      timestamp: new Date().toISOString(),
    };

    this.results.push(result);
    return result;
  }

  wasRuleLoadBearing(
    original: GovernanceDecision,
    ruleId: string,
    allRules: GovernanceRule[],
    reevaluate: (rules: GovernanceRule[]) => 'allow' | 'deny' | 'escalate' | 'warn' | 'transform',
  ): CounterfactualResult {
    const withoutRule = allRules.filter((r) => r.id !== ruleId);
    return this.replay(original, withoutRule, `rule "${ruleId}" removed`, reevaluate);
  }

  getResults(): CounterfactualResult[] {
    return [...this.results];
  }
}

export type { CounterfactualResult };
