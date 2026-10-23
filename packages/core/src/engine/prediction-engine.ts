import type { LearningEvent } from '@behavior-os/schemas';

/** A predicted future event with confidence score. */
export interface Prediction {
  id: string;
  type:
    | 'governance-block'
    | 'mission-failure'
    | 'quality-fall'
    | 'drift-significant'
    | 'pattern-repeated';
  subject: string;
  confidence: number;
  horizonHours: number;
  evidence: string[];
  recommendation: string;
  timestamp: string;
}

/**
 * Prediction engine — derives likely future events from learning history.
 *
 * Strategies:
 * - `governance-block`: recurring denies/escalates suggest a pattern that will
 *   block again without a rule change.
 * - `mission-failure`: missions with repeated failure types are likely to fail
 *   again under similar conditions.
 * - `pattern-repeated`: a learning pattern seen ≥ 3 times is promoted to a
 *   prediction that it will recur.
 *
 * Confidence = min(1, occurrences / 5) * 0.6 + normalizedRecency * 0.4.
 */
export class PredictionEngine {
  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  predict(events: LearningEvent[], limit = 5): Prediction[] {
    const predictions: Prediction[] = [];

    // Group by type for pattern analysis
    const byType = new Map<string, LearningEvent[]>();
    for (const e of events) {
      const bucket = byType.get(e.type) ?? [];
      bucket.push(e);
      byType.set(e.type, bucket);
    }

    for (const [type, typeEvents] of byType) {
      // Skip very old events (> 168h)
      const recent = typeEvents.filter((e) => this.ageHours(e.timestamp) < 168);
      if (recent.length === 0) continue;

      const confidence = this.computeConfidence(recent.length, recent);
      const recommendation = this.generateRecommendation(type, recent);

      // Pattern repetition requires at least 2 occurrences to be meaningful
      if ((type === 'failure' || type === 'fix') && recent.length >= 2) {
        predictions.push({
          id: `pred-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'pattern-repeated',
          subject: `${type} pattern "${type}" recurring ${recent.length}x`,
          confidence,
          horizonHours: 72,
          evidence: recent.slice(-3).map((e) => e.content),
          recommendation,
          timestamp: new Date().toISOString(),
        });
      }

      // If a pattern appears frequently, predict governance block
      if (recent.length >= 2 && (type === 'failure' || type === 'fix')) {
        predictions.push({
          id: `pred-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'governance-block',
          subject: `Recurring ${type} may trigger governance block`,
          confidence: Math.min(1, confidence * 1.2),
          horizonHours: 48,
          evidence: recent.slice(-2).map((e) => e.content),
          recommendation: `Consider adding a warn rule for pattern "${type}" via DNA evolution`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
  }

  private computeConfidence(occurrences: number, events: LearningEvent[]): number {
    const frequency = Math.min(1, occurrences / 5);
    const recency = this.avgRecency(events);
    return Math.round((frequency * 0.6 + recency * 0.4) * 100) / 100;
  }

  private avgRecency(events: LearningEvent[]): number {
    if (events.length === 0) return 0;
    const total = events.reduce((sum, e) => sum + this.recencyScore(e), 0);
    return total / events.length;
  }

  private recencyScore(event: LearningEvent): number {
    const ageHours = this.ageHours(event.timestamp);
    return Math.max(0, 1 - ageHours / 72);
  }

  private ageHours(timestamp: string): number {
    return (this.now() - new Date(timestamp).getTime()) / 3600000;
  }

  private generateRecommendation(type: string, _events: LearningEvent[]): string {
    if (type === 'failure') {
      return 'Review recent failures and consider adding governance rules to prevent recurrence';
    }
    if (type === 'fix') {
      return 'Apply learned fixes consistently; consider code-fix proposals';
    }
    return `Investigate recurring "${type}" pattern`;
  }
}
