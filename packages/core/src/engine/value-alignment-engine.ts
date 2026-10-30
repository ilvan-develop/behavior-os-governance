/**
 * G-014: Value Alignment Engine.
 *
 * Checks whether agent behavior aligns with human-defined values.
 * Provides per-value alignment scores and violation detection.
 */

interface Value {
  id: string;
  name: string;
  description: string;
  keywords: string[];
}

interface AlignmentScoreInternal {
  id: string;
  agentId: string;
  values: Value[];
  scores: Record<string, number>;
  overallScore: number;
  violations: string[];
  timestamp: string;
}

function matchValue(action: string, reason: string, value: Value): boolean {
  const text = `${action} ${reason ?? ''}`.toLowerCase();
  return value.keywords.some((kw) => text.includes(kw.toLowerCase()));
}

function computeScore(action: string, reason: string, value: Value, violations: string[]): number {
  if (matchValue(action, reason, value)) {
    // If the action matches value keywords, check if it's a violation
    const isViolation = violations.some((v) => v.includes(action) && v.includes(value.id));
    return isViolation ? 0.2 : 0.9;
  }
  return 0.7; // Neutral default
}

export class ValueAlignmentEngine {
  private values: Value[] = [];
  private scores: AlignmentScoreInternal[] = [];

  /** Register a human value. */
  registerValue(value: Value): void {
    this.values.push(value);
  }

  /** Get all registered values. */
  getValues(): Value[] {
    return [...this.values];
  }

  /**
   * Assess alignment between an agent's decisions and registered values.
   *
   * @param agentId - The agent to assess.
   * @param decisions - The agent's recent decisions.
   * @param violations - Known violation patterns (action descriptions that conflict with values).
   */
  assessAlignment(
    agentId: string,
    decisions: { action: string; verdict: string; reason?: string }[],
    violations: string[] = [],
  ): AlignmentScoreInternal {
    const scores: Record<string, number> = {};
    const detectedViolations: string[] = [];

    for (const value of this.values) {
      let valueScoreSum = 0;
      let valueScoreCount = 0;

      for (const decision of decisions) {
        if (decision.verdict === 'allow' || decision.verdict === 'warn') {
          const score = computeScore(decision.action, decision.reason ?? '', value, violations);
          valueScoreSum += score;
          valueScoreCount++;
        }
      }

      const valueScore = valueScoreCount > 0 ? valueScoreSum / valueScoreCount : 0.7;
      scores[value.id] = Math.round(valueScore * 100) / 100;

      // Detect violations
      for (const decision of decisions) {
        if (
          matchValue(decision.action, decision.reason ?? '', value) &&
          decision.verdict === 'allow'
        ) {
          // Check if this action conflicts with the value
          const conflict = violations.find(
            (v) => v.includes(decision.action) && v.includes(value.name),
          );
          if (conflict) {
            detectedViolations.push(
              `${value.name}: action '${decision.action}' conflicts with ${conflict}`,
            );
          }
        }
      }
    }

    const scoreValues = Object.values(scores);
    const overallScore =
      scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0.7;

    const result: AlignmentScoreInternal = {
      id: `align-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      values: [...this.values],
      scores,
      overallScore: Math.round(overallScore * 100) / 100,
      violations: detectedViolations,
      timestamp: new Date().toISOString(),
    };

    this.scores.push(result);
    return result;
  }

  /** Get the latest alignment score for an agent. */
  getLatestScore(agentId: string): AlignmentScoreInternal | undefined {
    const agentScores = this.scores.filter((s) => s.agentId === agentId);
    return agentScores.length > 0 ? agentScores[agentScores.length - 1] : undefined;
  }

  /** Get all alignment scores. */
  getAllScores(): AlignmentScoreInternal[] {
    return [...this.scores];
  }
}

export type { AlignmentScoreInternal, Value };
