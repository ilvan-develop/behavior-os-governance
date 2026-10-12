import type { LearningEvent, LearningImpact } from '@behavior-os/schemas';

/** Absolute weight for each impact level used in recommendation scoring. */
const IMPACT_SCORE: Record<LearningImpact, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Recency decay factor (0..1). Older events contribute less. */
const recencyWeight = (ageHours: number): number => Math.max(0, 1 - ageHours / 72);

export interface RankedRecommendation {
  /** Unique id. */
  id: string;
  /** Plain-language recommendation. */
  text: string;
  /** Scored between 0 and 1. Higher = more actionable. */
  score: number;
  /** Evidence: up to 3 representative event contents. */
  evidence: string[];
  /** When this recommendation was generated. */
  timestamp: string;
}

/**
 * Produces ranked recommendations from learning events.
 *
 * The score blends three orthogonal signals:
 * - `recency` — newer events matter more (decays over 72 h);
 * - `frequency` — how often the pattern repeats (saturates at 5);
 * - `impact` — severity of the events (1..4).
 *
 * Formula: `score = round((0.4 * recency + 0.3 * frequency + 0.3 * impact) * 100) / 100`.
 */
export class RecommendationEngine {
  /**
   * Produce up to `limit` recommendations sorted by descending score.
   * Pass `ageLimitHours` to ignore older events (default 168 h = 1 week).
   */
  recommend(events: LearningEvent[], limit = 5, ageLimitHours = 168): RankedRecommendation[] {
    const now = Date.now();
    const recent = events.filter(
      (e) => now - new Date(e.timestamp).getTime() < ageLimitHours * 3600000,
    );

    const byType = new Map<string, LearningEvent[]>();
    for (const e of recent) {
      const bucket = byType.get(e.type) ?? [];
      bucket.push(e);
      byType.set(e.type, bucket);
    }

    const recommendations: RankedRecommendation[] = [];
    for (const [type, events] of byType) {
      if (events.length === 0) continue;
      const recency = this.computeRecency(events, now);
      const frequency = Math.min(1, events.length / 5);
      const avgImpact =
        events.reduce((sum, e) => sum + (IMPACT_SCORE[e.impact] ?? 2), 0) / events.length / 4;
      const score = Math.round((recency * 0.4 + frequency * 0.3 + avgImpact * 0.3) * 100) / 100;

      recommendations.push({
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: this.generateText(type, events.length, avgImpact),
        score,
        evidence: events.slice(-3).map((e) => e.content),
        timestamp: new Date().toISOString(),
      });
    }

    return recommendations.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Deterministic single-event score for quick checks. */
  scoreEvent(event: LearningEvent): number {
    const ageHours = (Date.now() - new Date(event.timestamp).getTime()) / 3600000;
    const recency = recencyWeight(ageHours);
    const impact = (IMPACT_SCORE[event.impact] ?? 2) / 4;
    return Math.round((recency * 0.4 + impact * 0.6) * 100) / 100;
  }

  private computeRecency(events: LearningEvent[], now: number): number {
    if (events.length === 0) return 0;
    const avgAge =
      events.reduce(
        (sum, e) => sum + Math.max(0, (now - new Date(e.timestamp).getTime()) / 3600000),
        0,
      ) / events.length;
    return recencyWeight(avgAge);
  }

  private generateText(type: string, count: number, avgImpact: number): string {
    const labels: Record<string, string> = {
      failure: 'failure',
      fix: 'fix',
      insight: 'insight',
      optimization: 'optimization',
      pattern: 'pattern',
    };
    const label = labels[type] ?? type;
    const impactWord =
      avgImpact >= 0.75 ? 'high-impact' : avgImpact >= 0.5 ? 'medium-impact' : 'low-impact';
    return `Detected ${count} recurring ${label} events (${impactWord}). Review and consider a guardrail or template.`;
  }
}
