import type {
  CodeFixProposal,
  EvolutionProposal,
  LearningEvent,
  LearningImpact,
  LearningType,
} from '@behavior-os/schemas';

export interface RecordOptions {
  type: LearningType;
  source: string;
  content: string;
  impact: LearningImpact;
  relatedMission?: string;
  relatedPattern?: string;
  metadata?: Record<string, unknown>;
}

export interface DetectedPattern {
  type: string;
  count: number;
  examples: string[];
  recommendation?: string;
}

/** Relative weight of each impact level when scoring confidence (0..1). */
const IMPACT_WEIGHT: Record<LearningImpact, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};

/** Occurrence count at which the frequency term of the confidence saturates. */
const SATURATION_OCCURRENCES = 5;

/** Learning types that describe a problem worth preventing via governance. */
const ACTIONABLE_TYPES: readonly LearningType[] = ['failure', 'fix'];

export class LearningEngine {
  private events: LearningEvent[] = [];
  private patterns: Map<string, DetectedPattern> = new Map();

  record(options: RecordOptions): LearningEvent {
    const event: LearningEvent = {
      id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...options,
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);
    this.detectPatterns();
    return event;
  }

  detectPatterns(): DetectedPattern[] {
    const typeCounts = new Map<string, number>();
    const examples = new Map<string, string[]>();

    for (const event of this.events) {
      typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
      const existing = examples.get(event.type) || [];
      if (existing.length < 5) {
        existing.push(event.content);
        examples.set(event.type, existing);
      }
    }

    const patterns: DetectedPattern[] = [];
    for (const [type, count] of typeCounts) {
      if (count >= 2) {
        patterns.push({
          type,
          count,
          examples: examples.get(type) || [],
          recommendation: this.generateRecommendation(type, count),
        });
      }
    }

    this.patterns.clear();
    for (const p of patterns) {
      this.patterns.set(p.type, p);
    }

    return patterns;
  }

  getEvents(): LearningEvent[] {
    return this.events;
  }

  getPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values());
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.events.filter((e) => e.impact === 'high' || e.impact === 'critical').slice(-limit);
  }

  // DNA evolution -----------------------------------------------------------
  /**
   * Confidence in [0, 1] that a recurring pattern is real rather than noise.
   *
   * `confidence = frequency * 0.6 + avgImpactWeight * 0.4` where
   * `frequency = min(1, occurrences / 5)` and the impact weights are
   * `{ low: 0.25, medium: 0.5, high: 0.75, critical: 1 }`. Five or more
   * occurrences of a high-impact problem therefore reach ~0.85, which is the
   * default bar for proposing a DNA change.
   */
  confidenceFor(occurrences: number, avgImpactWeight: number): number {
    const frequency = Math.min(1, Math.max(0, occurrences) / SATURATION_OCCURRENCES);
    const impact = Math.min(1, Math.max(0, avgImpactWeight));
    return Math.round((frequency * 0.6 + impact * 0.4) * 1000) / 1000;
  }

  /**
   * Derive DNA-change proposals from repeated `failure`/`fix` events. This is a
   * pure computation: nothing is mutated here. Proposals below `minConfidence`
   * (default 0.8) are discarded.
   */
  proposeEvolution(dnaName: string, minConfidence = 0.8): EvolutionProposal[] {
    const byType = new Map<string, LearningEvent[]>();
    for (const event of this.events) {
      if (!ACTIONABLE_TYPES.includes(event.type)) continue;
      const bucket = byType.get(event.type) ?? [];
      bucket.push(event);
      byType.set(event.type, bucket);
    }

    const proposals: EvolutionProposal[] = [];
    for (const [pattern, events] of byType) {
      const totalImpact = events.reduce((sum, e) => sum + IMPACT_WEIGHT[e.impact], 0);
      const confidence = this.confidenceFor(events.length, totalImpact / events.length);
      if (confidence < minConfidence) continue;

      proposals.push({
        id: `evo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        dnaName,
        kind: 'governance-warn',
        pattern,
        ruleId: `evo-warn-${pattern}`,
        description: `Add a warning rule for recurring "${pattern}" events (confidence ${confidence})`,
        confidence,
        occurrences: events.length,
        evidence: events.slice(-5).map((e) => e.content),
        timestamp: new Date().toISOString(),
      });
    }

    return proposals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Derive code-fix proposals from repeated `fix` events. Each proposal is a
   * read-only suggestion — no files are touched. `minConfidence` defaults to
   * 0.8; three `fix` events of impact `critical` reach ~0.84 and qualify.
   */
  proposeCodeFixes(minConfidence = 0.8): CodeFixProposal[] {
    const byType = new Map<string, LearningEvent[]>();
    for (const event of this.events) {
      if (event.type !== 'fix') continue;
      const bucket = byType.get(event.type) ?? [];
      bucket.push(event);
      byType.set(event.type, bucket);
    }

    const proposals: CodeFixProposal[] = [];
    for (const [type, events] of byType) {
      const totalImpact = events.reduce((sum, e) => sum + IMPACT_WEIGHT[e.impact], 0);
      const confidence = this.confidenceFor(events.length, totalImpact / events.length);
      if (confidence < minConfidence) continue;

      proposals.push({
        id: `fix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pattern: type,
        confidence,
        occurrences: events.length,
        suggestion: `Repeat fix "${type}" ${events.length} time(s); consider a reusable template.`,
        evidence: events.slice(-5).map((e) => e.content),
        timestamp: new Date().toISOString(),
      });
    }

    return proposals.sort((a, b) => b.confidence - a.confidence);
  }

  /** Snapshot every learning event (JSON-serializable) for persistence. */
  snapshot(): LearningEvent[] {
    return [...this.events];
  }

  /** Replace all learning events and recompute the derived patterns. */
  restore(events: readonly LearningEvent[]): void {
    this.events = Array.isArray(events) ? [...events] : [];
    this.patterns.clear();
    this.detectPatterns();
  }

  private generateRecommendation(type: string, count: number): string {
    const recommendations: Record<string, string> = {
      failure: `Detected ${count} failures. Review error patterns and add guardrails.`,
      insight: 'Consider documenting this insight in team knowledge base.',
      fix: 'Auto-fix pattern detected. Consider creating a reusable fix template.',
      optimization: 'Performance pattern detected. Consider optimization strategy.',
    };
    return recommendations[type] || `Pattern "${type}" observed ${count} times.`;
  }
}
