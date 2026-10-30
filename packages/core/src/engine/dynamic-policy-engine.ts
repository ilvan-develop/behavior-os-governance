/**
 * G-011: Dynamic Policy Adjustment Engine.
 *
 * Computes a risk score from multiple factors and adjusts enforcement
 * thresholds dynamically. High-risk contexts get stricter enforcement;
 * low-risk contexts can relax non-critical rules.
 */

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface RiskAssessment {
  id: string;
  agentId: string;
  level: RiskLevel;
  score: number;
  factors: string[];
  adjustedThresholds: Record<string, number>;
  timestamp: string;
}

interface DynamicPolicy {
  id: string;
  agentId: string;
  baseRuleIds: string[];
  riskLevel: RiskLevel;
  enforcementMultiplier: number;
  elevatedScrutiny: boolean;
  activeSince: string;
}

function riskLevelForScore(score: number): RiskLevel {
  if (score >= 0.8) return 'critical';
  if (score >= 0.5) return 'high';
  if (score >= 0.25) return 'medium';
  return 'low';
}

function riskMultiplier(level: RiskLevel): number {
  switch (level) {
    case 'critical':
      return 2.0;
    case 'high':
      return 1.5;
    case 'medium':
      return 1.0;
    case 'low':
      return 0.75;
  }
}

export class DynamicPolicyEngine {
  private policies = new Map<string, DynamicPolicy>();
  private assessments: RiskAssessment[] = [];

  /**
   * Assess the risk level for an agent given a set of risk factors.
   */
  assessRisk(
    agentId: string,
    factors: {
      denialRate: number;
      anomalyDeviation: number;
      toolDiversity: number;
      offHoursRatio: number;
      recentFailures: number;
    },
  ): RiskAssessment {
    const weighted =
      factors.denialRate * 0.3 +
      factors.anomalyDeviation * 0.25 +
      factors.toolDiversity * 0.15 +
      factors.offHoursRatio * 0.1 +
      factors.recentFailures * 0.2;

    const score = Math.round(Math.min(1, Math.max(0, weighted)) * 100) / 100;
    const level = riskLevelForScore(score);

    const adjustedThresholds: Record<string, number> = {
      denyThreshold: level === 'critical' ? 0.5 : level === 'high' ? 0.3 : 0.15,
      escalateThreshold: level === 'critical' ? 0.6 : level === 'high' ? 0.5 : 0.35,
      warnThreshold: 0.2,
    };

    const assessment: RiskAssessment = {
      id: `risk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      level,
      score,
      factors: [
        `denialRate=${factors.denialRate.toFixed(2)}`,
        `anomalyDeviation=${factors.anomalyDeviation.toFixed(2)}`,
        `toolDiversity=${factors.toolDiversity.toFixed(2)}`,
        `offHoursRatio=${factors.offHoursRatio.toFixed(2)}`,
        `recentFailures=${factors.recentFailures.toFixed(2)}`,
      ],
      adjustedThresholds,
      timestamp: new Date().toISOString(),
    };

    this.assessments.push(assessment);
    return assessment;
  }

  /**
   * Create a dynamic policy for an agent based on a risk assessment.
   */
  createDynamicPolicy(
    agentId: string,
    riskAssessment: RiskAssessment,
    baseRuleIds: string[],
  ): DynamicPolicy {
    const multiplier = riskMultiplier(riskAssessment.level);
    const elevated = riskAssessment.level === 'high' || riskAssessment.level === 'critical';

    const policy: DynamicPolicy = {
      id: `dyn-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      baseRuleIds,
      riskLevel: riskAssessment.level,
      enforcementMultiplier: multiplier,
      elevatedScrutiny: elevated,
      activeSince: new Date().toISOString(),
    };

    this.policies.set(agentId, policy);
    return policy;
  }

  getPolicy(agentId: string): DynamicPolicy | undefined {
    return this.policies.get(agentId);
  }

  getAssessments(): RiskAssessment[] {
    return [...this.assessments];
  }

  getPolicies(): DynamicPolicy[] {
    return [...this.policies.values()];
  }
}

export type { DynamicPolicy, RiskAssessment, RiskLevel };
