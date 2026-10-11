import type { DNA, GovernanceDecision, GovernanceRule } from '@behavior-os/schemas';
export interface EvaluateContext {
  action: string;
  agentId: string;
  context: Record<string, unknown>;
  missionId?: string;
}
export declare class GovernanceEngine {
  private rules;
  private decisionCache;
  private readonly CACHE_TTL_MS;
  constructor(dna: DNA);
  evaluate(context: EvaluateContext): GovernanceDecision;
  evaluateConditions(
    conditions: Array<{
      type: string;
      value: unknown;
    }>,
    context: Record<string, unknown>,
  ): boolean;
  getRules(): GovernanceRule[];
  addRule(rule: GovernanceRule): void;
  removeRule(ruleId: string): void;
  clearCache(): void;
}
//# sourceMappingURL=governance-engine.d.ts.map
