import type { DNA, LearningEvent } from '@behavior-os/schemas';
import { DriftEngine } from './drift-engine.js';

/**
 * Cross-DNA learning transfer — applies learned patterns from one DNA to another.
 *
 * When a learning event is recorded against a DNA, this engine can suggest
 * equivalent rules for other DNAs that share similar governance contexts.
 * Transfer is read-only: it produces suggestions, not mutations.
 */
export interface CrossDnaTransferSuggestion {
  sourceDna: string;
  targetDna: string;
  eventId: string;
  originalRuleId?: string;
  proposedRuleId: string;
  proposedAction: import('@behavior-os/schemas').GovernanceAction;
  confidence: number;
  reason: string;
  evidence: string[];
}

export class CrossDnaLearningEngine {
  private drift = new DriftEngine();

  /**
   * Given a source DNA with learning events and a target DNA, produce transfer
   * suggestions for rules that would be valuable in the target.
   */
  suggestTransfers(
    sourceDna: DNA,
    targetDna: DNA,
    events: LearningEvent[],
    minConfidence = 0.5,
  ): CrossDnaTransferSuggestion[] {
    const suggestions: CrossDnaTransferSuggestion[] = [];

    // Find rules in source that have associated learning events
    const _sourceRuleIds = new Set((sourceDna.governance ?? []).map((r) => r.id));

    // Group events by pattern/type
    const byPattern = new Map<string, LearningEvent[]>();
    for (const e of events) {
      const bucket = byPattern.get(e.type) ?? [];
      bucket.push(e);
      byPattern.set(e.type, bucket);
    }

    for (const [pattern, patternEvents] of byPattern) {
      if (patternEvents.length < 2) continue;

      const confidence = Math.min(1, patternEvents.length / 5);
      if (confidence < minConfidence) continue;

      // Check if target DNA already has a similar rule
      const existingRule = targetDna.governance?.find((r) =>
        r.conditions?.some((c) => c.type === pattern),
      );

      if (existingRule) continue; // Already covered

      // Find best matching source rule
      const sourceRule = sourceDna.governance?.find((r) =>
        r.conditions?.some((c) => c.type === pattern),
      );

      suggestions.push({
        sourceDna: sourceDna.name,
        targetDna: targetDna.name,
        eventId: patternEvents[0].id,
        originalRuleId: sourceRule?.id,
        proposedRuleId: `transfer-${pattern}`,
        proposedAction: sourceRule?.action ?? 'warn',
        confidence,
        reason: `Pattern "${pattern}" triggered ${patternEvents.length} times in ${sourceDna.name}; target lacks coverage`,
        evidence: patternEvents.slice(-3).map((e) => e.content),
      });
    }

    return suggestions;
  }

  /**
   * Compute drift between two DNAs and flag areas where learning could inform transfer.
   */
  computeDriftWithLearning(
    sourceDna: DNA,
    targetDna: DNA,
    events: LearningEvent[],
  ): {
    drift: import('./drift-engine.js').DriftInfo;
    learningSuggestions: CrossDnaTransferSuggestion[];
  } {
    const drift = this.drift.compare(sourceDna, targetDna);
    const suggestions = this.suggestTransfers(sourceDna, targetDna, events);

    return { drift, learningSuggestions: suggestions };
  }
}
