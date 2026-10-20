import type {
  CodeFixProposal,
  EvolutionProposal,
  LearningEvent,
  LearningImpact,
  LearningRecord,
  LearningStage,
  LearningTransition,
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

/**
 * Ordered governance lifecycle of a learning record. A record moves exactly one
 * stage forward per promotion; there is no skip and no regression.
 */
export const LEARNING_STAGES: readonly LearningStage[] = [
  'observation',
  'lesson',
  'candidate',
  'validated',
  'policy',
  'monitored',
];

/** Stages that may only be entered with at least one piece of evidence. */
const EVIDENCE_REQUIRED_STAGES: readonly LearningStage[] = ['validated', 'policy', 'monitored'];

export interface CreateLearningRecordOptions {
  title: string;
  content: string;
  source: string;
  impact: LearningImpact;
  relatedMission?: string;
  evidence?: string[];
  actor?: string;
}

export interface AdvanceLearningRecordOptions {
  actor?: string;
  reason?: string;
  /** Evidence appended while promoting; required to reach `validated`. */
  evidence?: string[];
}

export type LearningAdvanceResult =
  | { ok: true; record: LearningRecord }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'EVIDENCE_REQUIRED'; message: string };

/** Drop empty/duplicate evidence strings so promotion checks stay meaningful. */
function normalizeEvidence(evidence: readonly string[] | undefined): string[] {
  if (!Array.isArray(evidence)) return [];
  return [...new Set(evidence.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
}

export class LearningEngine {
  private events: LearningEvent[] = [];
  private patterns: Map<string, DetectedPattern> = new Map();
  /** Governed lifecycle records, independent of the raw event stream. */
  private records: LearningRecord[] = [];

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

  // Governed lifecycle ------------------------------------------------------
  /**
   * Open a learning record at the `observation` stage. Recording an event and
   * opening a lifecycle record are separate concerns: the event stream feeds
   * pattern detection, while a record is promoted with evidence.
   */
  createRecord(options: CreateLearningRecordOptions): LearningRecord {
    const now = new Date().toISOString();
    const record: LearningRecord = {
      id: `learn-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage: 'observation',
      title: options.title,
      content: options.content,
      source: options.source,
      impact: options.impact,
      evidence: normalizeEvidence(options.evidence),
      transitions: [],
      createdAt: now,
      updatedAt: now,
      ...(options.relatedMission ? { relatedMission: options.relatedMission } : {}),
    };
    this.records.push(record);
    return { ...record, evidence: [...record.evidence], transitions: [] };
  }

  /**
   * Promote a record exactly one stage forward.
   *
   * Refusals are explicit: an unknown id (`NOT_FOUND`), a skip/regression/other
   * out-of-order target (`INVALID_TRANSITION`), or a promotion into `validated`
   * or later without any evidence (`EVIDENCE_REQUIRED`). A refused promotion
   * leaves the record untouched.
   */
  advanceRecord(
    id: string,
    to: LearningStage,
    options: AdvanceLearningRecordOptions = {},
  ): LearningAdvanceResult {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) {
      return { ok: false, code: 'NOT_FOUND', message: `No learning record with id "${id}"` };
    }

    const fromIndex = LEARNING_STAGES.indexOf(record.stage);
    const toIndex = LEARNING_STAGES.indexOf(to);
    if (toIndex !== fromIndex + 1) {
      const next = LEARNING_STAGES[fromIndex + 1] ?? 'none';
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot move learning ${id} from "${record.stage}" to "${to}"; the next stage is "${next}"`,
      };
    }

    const evidence = [...record.evidence, ...normalizeEvidence(options.evidence)];
    if (EVIDENCE_REQUIRED_STAGES.includes(to) && evidence.length === 0) {
      return {
        ok: false,
        code: 'EVIDENCE_REQUIRED',
        message: `Promotion to "${to}" requires at least one evidence entry`,
      };
    }

    const at = new Date().toISOString();
    const transition: LearningTransition = {
      from: record.stage,
      to,
      at,
      actor: options.actor ?? 'system',
      ...(options.reason ? { reason: options.reason } : {}),
    };

    record.stage = to;
    record.evidence = evidence;
    record.transitions.push(transition);
    record.updatedAt = at;

    return {
      ok: true,
      record: {
        ...record,
        evidence: [...record.evidence],
        transitions: [...record.transitions],
      },
    };
  }

  getRecords(): LearningRecord[] {
    return this.records.map((record) => ({
      ...record,
      evidence: [...record.evidence],
      transitions: [...record.transitions],
    }));
  }

  getRecord(id: string): LearningRecord | undefined {
    return this.getRecords().find((record) => record.id === id);
  }

  /** Snapshot every lifecycle record for persistence. */
  snapshotRecords(): LearningRecord[] {
    return this.getRecords();
  }

  /** Replace all lifecycle records; tolerates snapshots written before G-014. */
  restoreRecords(records: readonly LearningRecord[] | undefined): void {
    this.records = Array.isArray(records)
      ? records.map((record) => ({
          ...record,
          evidence: [...(record.evidence ?? [])],
          transitions: [...(record.transitions ?? [])],
        }))
      : [];
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
