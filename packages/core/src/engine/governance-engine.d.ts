import type { DNA, GovernanceDecision, GovernanceRule } from '@behavior-os/schemas';
export interface EvaluateContext {
  action: string;
  agentId: string;
  context: Record<string, unknown>;
  missionId?: string;
}
export declare class GovernanceEngine {
  private rules;
  constructor(dna: DNA);
  evaluate(context: EvaluateContext): GovernanceDecision;
  getRules(): GovernanceRule[];
  addRule(rule: GovernanceRule): void;
  removeRule(ruleId: string): void;
}
//# sourceMappingURL=governance-engine.d.ts.map
