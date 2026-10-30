/**
 * ConfidenceWeightedGateSelector (F-024)
 *
 * When applying cross-DNA pipeline phase transfers, we need to decide WHICH
 * gates from the source phase should actually be transferred to the target.
 * Not every gate is worth transferring — some may conflict with existing
 * target gates, some may be too similar, and some may be too aggressive.
 *
 * This engine uses confidence-weighted selection:
 * - Gates that significantly raise the target's threshold get high confidence
 * - Gates already present with similar values get low confidence (skip)
 * - Security/coverage gates get a boost (defense-first)
 *
 * Example: Surgical Team's 'test_coverage: 100' gate transferred to DevOps Pipeline's
 * 'test_coverage: 80' gate → confidence 0.92 (100% coverage is meaningfully stricter)
 */

import type { ConstructionPipelineGate, PipelinePhaseDefinition } from '@behavior-os/schemas';

/** A gate selection recommendation with confidence score. */
export interface GateSelection {
  gateId: string;
  gateName: string;
  sourceValue: unknown;
  targetValue: unknown;
  confidence: number;
  reason: string;
  shouldTransfer: boolean;
}

/** Result of confidence-weighted gate selection. */
export interface GateSelectionResult {
  sourcePhaseId: string;
  sourcePhaseName: string;
  targetPhaseId: string | null;
  targetPhaseName: string | null;
  selections: GateSelection[];
  /** Average confidence of selected gates. */
  averageConfidence: number;
  /** Number of gates recommended for transfer. */
  recommendedCount: number;
  /** Number of gates from source. */
  totalCount: number;
}

/**
 * Compute confidence that a source gate should transfer to a target phase.
 *
 * Confidence factors:
 * 1. Gate type importance (security/coverage = high boost)
 * 2. Threshold stricter-ness (source value > target value)
 * 3. Presence in target (absent = high, present-but-different = moderate, identical = low)
 * 4. Blocking status (blocking gates get boost)
 */
function computeGateConfidence(
  sourceGate: ConstructionPipelineGate,
  targetPhase: PipelinePhaseDefinition | null,
  _minConfidence: number,
): { confidence: number; reason: string; targetValue: unknown } {
  const gateType = sourceGate.condition?.type ?? sourceGate.id;

  if (!targetPhase) {
    // No matching target phase — all gates are valuable to transfer
    const isSecurity = gateType === 'security' || gateType === 'test_coverage';
    const confidence = isSecurity ? 0.88 : 0.75;
    return {
      confidence,
      reason: `No matching phase in target — gate "${sourceGate.name}" (${gateType}) should be transferred`,
      targetValue: undefined,
    };
  }

  // Find matching gate in target phase by condition type
  const targetGate = targetPhase.gates.find((g) => (g.condition?.type ?? g.id) === gateType);

  if (!targetGate) {
    // Gate type doesn't exist in target phase — good candidate for transfer
    const isSecurity = gateType === 'security' || gateType === 'test_coverage';
    const confidence = sourceGate.blocking ? 0.82 : isSecurity ? 0.78 : 0.7;
    return {
      confidence,
      reason: `Gate type "${gateType}" is absent from target — recommended for transfer`,
      targetValue: undefined,
    };
  }

  // Gate type exists in target — compare values
  const sourceValue = sourceGate.condition?.value;
  const targetValue = targetGate.condition?.value;
  const isSame = JSON.stringify(sourceValue) === JSON.stringify(targetValue);

  if (isSame) {
    // Identical gate — no value in transferring
    return {
      confidence: 0.1,
      reason: `Gate "${sourceGate.name}" has identical value in target — no transfer needed`,
      targetValue,
    };
  }

  // Same type, different value — only transfer if source is stricter
  if (typeof sourceValue === 'number' && typeof targetValue === 'number') {
    const delta = sourceValue - targetValue;
    if (delta > 0) {
      // Source is stricter (e.g., 100% coverage vs 80%)
      const isSecurity = gateType === 'security' || gateType === 'test_coverage';
      const confidence = Math.min(
        0.95,
        0.7 + delta * 0.05 + (isSecurity ? 0.1 : 0) + (sourceGate.blocking ? 0.05 : 0),
      );
      return {
        confidence,
        reason: `Source requires ${sourceValue} but target requires ${targetValue} — stricter threshold recommended`,
        targetValue,
      };
    }
    // Target is stricter — don't transfer
    return {
      confidence: 0.2,
      reason: `Target already has stricter ${gateType} (${targetValue} vs ${sourceValue}) — no transfer`,
      targetValue,
    };
  }

  // Non-numeric values differ — moderate confidence
  const confidence = sourceGate.blocking ? 0.65 : 0.55;
  return {
    confidence,
    reason: `Gate "${sourceGate.name}" has different non-numeric value in target — evaluation needed`,
    targetValue,
  };
}

/**
 * The ConfidenceWeightedGateSelector engine.
 *
 * Registered as F-024 in EngineRegistry.
 * Gets its own getter on BehaviorOS facade.
 */
export class ConfidenceWeightedGateSelector {
  /**
   * Select gates from a source phase that should be transferred to a target phase.
   *
   * @param sourcePhase The source phase with gates to evaluate
   * @param targetPhase The target phase (or null if no matching phase exists)
   * @param minConfidence Only return gates with confidence >= this threshold (default: 0.5)
   * @returns Gate selection result with ranked recommendations
   */
  selectGates(
    sourcePhase: PipelinePhaseDefinition,
    targetPhase: PipelinePhaseDefinition | null,
    minConfidence = 0.5,
  ): GateSelectionResult {
    const selections: GateSelection[] = [];

    for (const sourceGate of sourcePhase.gates) {
      const { confidence, reason, targetValue } = computeGateConfidence(
        sourceGate,
        targetPhase,
        minConfidence,
      );

      selections.push({
        gateId: sourceGate.id,
        gateName: sourceGate.name,
        sourceValue: sourceGate.condition?.value,
        targetValue,
        confidence,
        reason,
        shouldTransfer: confidence >= minConfidence,
      });
    }

    // Sort by confidence descending
    selections.sort((a, b) => b.confidence - a.confidence);

    const recommended = selections.filter((s) => s.shouldTransfer);

    return {
      sourcePhaseId: sourcePhase.id,
      sourcePhaseName: sourcePhase.name,
      targetPhaseId: targetPhase?.id ?? null,
      targetPhaseName: targetPhase?.name ?? null,
      selections,
      averageConfidence:
        selections.length > 0
          ? selections.reduce((sum, s) => sum + s.confidence, 0) / selections.length
          : 0,
      recommendedCount: recommended.length,
      totalCount: selections.length,
    };
  }

  /**
   * Compute confidence for all gates in a source phase vs target phase.
   * Returns a map of gateId → confidence for quick lookup.
   */
  getGateConfidences(
    sourcePhase: PipelinePhaseDefinition,
    targetPhase: PipelinePhaseDefinition | null,
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const gate of sourcePhase.gates) {
      const { confidence } = computeGateConfidence(gate, targetPhase, 0);
      result.set(gate.id, confidence);
    }
    return result;
  }

  /**
   * Suggest gates to transfer from source phase to target phase.
   * Returns only gates with confidence >= minConfidence.
   */
  suggestTransfers(
    sourcePhase: PipelinePhaseDefinition,
    targetPhase: PipelinePhaseDefinition | null,
    minConfidence = 0.5,
  ): GateSelection[] {
    const result = this.selectGates(sourcePhase, targetPhase, minConfidence);
    return result.selections.filter((s) => s.shouldTransfer);
  }
}
