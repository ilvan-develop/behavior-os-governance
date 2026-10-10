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
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(dna: DNA) {
    this.rules = dna.governance;
  }

  evaluate(context: EvaluateContext): GovernanceDecision {
    const cacheKey = `${context.action}|${context.agentId}|${JSON.stringify(context.context)}`;

    // Check cache with TTL
    const cached = this.decisionCache.get(cacheKey);
    if (cached) {
      const cachedTime = parseInt(cached.id.split('-')[1] ?? '0', 10);
      if (Date.now() - cachedTime < this.CACHE_TTL_MS) {
        return cached;
      }
      this.decisionCache.delete(cacheKey);
    }

    const evaluatedRules: string[] = [];
    let verdict: GovernanceVerdict = 'allow';
    let reason = 'No rules violated';
    let transformed = false;
    const warnings: string[] = [];

    // Sort rules by level for priority processing
    const sortedRules = [...this.rules].sort((a, b) => {
      const levelOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (levelOrder[b.level] ?? 0) - (levelOrder[a.level] ?? 0);
    });

    for (const rule of sortedRules) {
      evaluatedRules.push(rule.id);
      const matches = this.evaluateConditions(rule.conditions, context.context);

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
            warnings.push(`Warning from rule: ${rule.id}`);
            if (verdict === 'allow') {
              reason = warnings.join('; ');
            }
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
      warnings: warnings.length > 0 ? warnings : undefined,
      ...(transformed ? { transformed: true } : {}),
    };

    this.decisionCache.set(cacheKey, result);
    return result;
  }

  evaluateConditions(
    conditions: Array<{ type: string; value: unknown }>,
    context: Record<string, unknown>,
  ): boolean {
    return conditions.every((cond) => {
      const ctxValue = context[cond.type];
      const condValue = cond.value;

      // Handle numeric comparisons (>= for thresholds)
      if (typeof condValue === 'number' && typeof ctxValue === 'number') {
        return ctxValue >= condValue;
      }

      // Handle boolean comparisons
      if (typeof condValue === 'boolean') {
        return ctxValue === condValue;
      }

      // Handle string comparisons
      if (typeof condValue === 'string') {
        return ctxValue === condValue;
      }

      // Default to strict equality
      return ctxValue === condValue;
    });
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

  clearCache(): void {
    this.decisionCache.clear();
  }
}
