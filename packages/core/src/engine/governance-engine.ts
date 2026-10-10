import type {
  DNA,
  GovernanceDecision,
  GovernanceRule,
  GovernanceVerdict,
} from '@behavior-os/schemas';

export interface EvaluateContext {
  action: string;
  agentId: string;
  context: Record<string, unknown>;
  missionId?: string;
}

export class GovernanceEngine {
  private rules: GovernanceRule[];
  private decisionCache: Map<string, GovernanceDecision> = new Map();

  constructor(dna: DNA) {
    this.rules = dna.governance;
  }

  evaluate(context: EvaluateContext): GovernanceDecision {
    const cacheKey = `${context.action}|${context.agentId}|${JSON.stringify(context.context)}`;
    const cached = this.decisionCache.get(cacheKey);
    if (cached) return cached;

    const evaluatedRules: string[] = [];
    let verdict: GovernanceVerdict = 'allow';
    let reason = 'No rules violated';
    let transformed = false;

    for (const rule of this.rules) {
      evaluatedRules.push(rule.id);
      const matches = rule.conditions.every((cond) => context.context[cond.type] === cond.value);

      if (matches) {
        switch (rule.action) {
          case 'block':
            verdict = 'deny';
            reason = `Blocked by rule: ${rule.id} (${rule.description || rule.level})`;
            break;
          case 'escalate':
            if (verdict !== 'deny') {
              verdict = 'escalate';
              reason = `Escalated by rule: ${rule.id}`;
            }
            break;
          case 'warn':
            reason = `Warning from rule: ${rule.id}`;
            break;
          case 'log':
            // Log only - no verdict change
            break;
          case 'transform':
            transformed = true;
            break;
        }
      }
    }

    const result: GovernanceDecision = {
      id: `gov-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action: context.action,
      verdict,
      reason,
      rulesEvaluated: evaluatedRules,
      timestamp: new Date().toISOString(),
      agentId: context.agentId,
      missionId: context.missionId,
      ...(transformed ? { transformed: true } : {}),
    };

    this.decisionCache.set(cacheKey, result);
    return result;
  }

  getRules(): GovernanceRule[] {
    return this.rules;
  }

  addRule(rule: GovernanceRule): void {
    this.rules.push(rule);
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }
}
