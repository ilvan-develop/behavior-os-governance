import type { LearningEvent, LearningImpact, LearningType } from '@behavior-os/schemas';

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
