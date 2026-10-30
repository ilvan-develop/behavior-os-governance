/**
 * CrossDnaPipelineTransferEngine (R-023)
 *
 * Extends cross-DNA learning to construction pipelines specifically.
 * Finds structural similarities in pipeline phases and gates between
 * different DNA patterns, and suggests transferable phase patterns.
 *
 * Example: Surgical Team's "sterile-field testing phase" (100% coverage,
 * zero vulnerabilities) → transferred to DevOps Pipeline with confidence 0.87
 */
import type { ConstructionPipeline, DNA, PipelinePhaseDefinition } from '@behavior-os/schemas';

/** A suggested transfer of a pipeline phase from one DNA to another. */
export interface PhaseTransferSuggestion {
  /** Unique identifier for this suggestion. */
  id: string;
  /** Source DNA name. */
  sourceDna: string;
  /** Target DNA name. */
  targetDna: string;
  /** Phase ID being transferred. */
  phaseId: string;
  /** Phase name. */
  phaseName: string;
  /** Confidence score 0-1. */
  confidence: number;
  /** Why this transfer is recommended. */
  justification: string;
  /** The gate IDs from the source phase that are transferable. */
  transferableGates: string[];
  /** Impact assessment. */
  impact: 'low' | 'medium' | 'high';
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * Compute similarity between two pipeline phase definitions.
 * Based on: phase type, gate types, required skills.
 */
function computePhaseSimilarity(a: PipelinePhaseDefinition, b: PipelinePhaseDefinition): number {
  let score = 0;

  if (a.type === b.type) score += 0.3;

  // Compare gate condition types
  const aGateTypes = new Set(a.gates.map((g) => g.condition?.type ?? g.id));
  const bGateTypes = new Set(b.gates.map((g) => g.condition?.type ?? g.id));
  const intersection = [...aGateTypes].filter((t) => bGateTypes.has(t));
  const union = new Set([...aGateTypes, ...bGateTypes]);
  const gateSim = union.size === 0 ? 1 : intersection.length / union.size;
  score += gateSim * 0.4;

  // Compare required skills
  const aSkills = new Set(a.requiredSkills ?? []);
  const bSkills = new Set(b.requiredSkills ?? []);
  const skillIntersection = [...aSkills].filter((s) => bSkills.has(s));
  const skillUnion = new Set([...aSkills, ...bSkills]);
  const skillSim = skillUnion.size === 0 ? 1 : skillIntersection.length / skillUnion.size;
  score += skillSim * 0.3;

  return Math.round(score * 100) / 100;
}

/**
 * Determine the impact level based on phase type.
 */
function determineImpact(phase: PipelinePhaseDefinition): 'low' | 'medium' | 'high' {
  if (phase.type === 'deployment') return 'high';
  if (phase.type === 'architecture') return 'high';
  if (phase.type === 'testing') return 'medium';
  if (phase.type === 'backend' || phase.type === 'frontend') return 'medium';
  // Check if any gate has security-type condition for high impact
  const hasSecurityGate = phase.gates.some((g) => g.condition?.type === 'security');
  if (hasSecurityGate) return 'high';
  return 'low';
}

/**
 * Extract pipelines from DNA (works with both typed and raw DNA).
 */
function extractPipelines(dna: DNA): ConstructionPipeline[] {
  return (dna as unknown as { pipelines?: ConstructionPipeline[] })?.pipelines ?? [];
}

/**
 * Check if the source phase has stricter gate thresholds than the target phase.
 * E.g., source requires 100% coverage but target only requires 80%.
 * This makes the transfer meaningful even when phase types differ.
 */
function hasStricterGates(
  sourcePhase: PipelinePhaseDefinition,
  targetPhase: PipelinePhaseDefinition | null,
): boolean {
  if (!targetPhase) return false;

  const targetGatesByType = new Map<string, PipelinePhaseDefinition['gates'][0]>();
  for (const g of targetPhase.gates) {
    const type = g.condition?.type ?? g.id;
    targetGatesByType.set(type, g);
  }

  for (const sourceGate of sourcePhase.gates) {
    const gateType = sourceGate.condition?.type ?? sourceGate.id;
    const targetGate = targetGatesByType.get(gateType);
    if (!targetGate) continue;

    const sourceValue = sourceGate.condition?.value;
    const targetValue = targetGate.condition?.value;

    // For numeric thresholds (e.g., coverage 100 vs 80), check if source is stricter
    if (typeof sourceValue === 'number' && typeof targetValue === 'number') {
      if (sourceValue > targetValue) return true;
    }
  }

  return false;
}

/**
 * The CrossDnaPipelineTransferEngine.
 *
 * Registered as R-023 in EngineRegistry.
 */
export class CrossDnaPipelineTransferEngine {
  /**
   * Suggest pipeline phase transfers from source DNA to target DNA.
   *
   * Finds phases in the source DNA that could strengthen the target DNA's
   * pipeline — e.g., transferring Surgical Team's 100% coverage gate to
   * DevOps Pipeline which only requires 80%.
   *
   * @param sourceDna The DNA with strong pipeline phases (e.g., Surgical Team)
   * @param targetDna The DNA that could benefit from those phases (e.g., DevOps Pipeline)
   * @param minConfidence Minimum similarity threshold (default 0.5)
   * @returns Ranked suggestions for phase transfers
   */
  suggestPhaseTransfers(
    sourceDna: DNA,
    targetDna: DNA,
    minConfidence = 0.5,
  ): PhaseTransferSuggestion[] {
    const sourcePipelines = extractPipelines(sourceDna);
    const targetPipelines = extractPipelines(targetDna);

    const suggestions: PhaseTransferSuggestion[] = [];

    for (const sourcePipeline of sourcePipelines) {
      for (const targetPipeline of targetPipelines) {
        // Only suggest transfers if pipelines target overlapping project types
        const sharedTypes = sourcePipeline.appliesTo.filter((t) =>
          targetPipeline.appliesTo.includes(t),
        );
        if (sharedTypes.length === 0) continue;

        for (const sourcePhase of sourcePipeline.phases) {
          // Check if the target DNA already has a similar phase
          let bestSim = 0;
          let similarTargetPhase: PipelinePhaseDefinition | null = null;

          for (const targetPhase of targetPipeline.phases) {
            const sim = computePhaseSimilarity(sourcePhase, targetPhase);
            if (sim > bestSim) {
              bestSim = sim;
              similarTargetPhase = targetPhase;
            }
          }

          // Decision logic:
          // - bestSim === 0 → source phase is missing from target → STRONG transfer candidate
          // - bestSim >= minConfidence && bestSim < 0.9 → exists but has gaps → MODERATE candidate
          // - bestSim >= 0.9 → already well-covered → skip
          // - bestSim < minConfidence BUT source has stricter gates → weaker transfer candidate
          let shouldSuggest = false;
          let transferConfidence = 0;

          if (bestSim === 0) {
            // Phase is entirely missing from target — strong transfer candidate
            shouldSuggest = true;
            // Confidence based on source phase strength:
            // blocking phases with security/coverage gates are high confidence
            const hasSecurityGate = sourcePhase.gates.some(
              (g) => g.condition?.type === 'security' || g.condition?.type === 'test_coverage',
            );
            transferConfidence = sourcePhase.blocking ? (hasSecurityGate ? 0.85 : 0.72) : 0.65;
          } else if (bestSim >= minConfidence && bestSim < 0.9) {
            // Similar phase exists but has gaps
            shouldSuggest = true;
            transferConfidence = bestSim;
          } else if (bestSim < minConfidence && hasStricterGates(sourcePhase, similarTargetPhase)) {
            // Source has stricter versions of gates that exist in target
            // e.g., 100% coverage (source) vs 80% coverage (target)
            const hasSecurityGate = sourcePhase.gates.some(
              (g) => g.condition?.type === 'security' || g.condition?.type === 'test_coverage',
            );
            const computedConfidence = hasSecurityGate ? 0.82 : Math.max(0.55, bestSim + 0.2);
            // Only suggest if the computed confidence meets the threshold
            if (computedConfidence >= minConfidence) {
              shouldSuggest = true;
              transferConfidence = computedConfidence;
            }
          }

          if (shouldSuggest) {
            const impact = determineImpact(sourcePhase);
            const transferableGates = this.findTransferableGates(sourcePhase, similarTargetPhase);

            if (transferableGates.length > 0 || sourcePhase.blocking || bestSim === 0) {
              suggestions.push({
                id: `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sourceDna: sourceDna.name,
                targetDna: targetDna.name,
                phaseId: sourcePhase.id,
                phaseName: sourcePhase.name,
                confidence: transferConfidence,
                justification: this.generateJustification(
                  sourcePhase,
                  similarTargetPhase,
                  sourceDna,
                  targetDna,
                  sharedTypes,
                ),
                transferableGates,
                impact,
                createdAt: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Find gates in the source phase that are transferable to the target phase.
   *
   * A gate is transferable if:
   * - The target has no gate with the same condition type (entirely new gate)
   * - The source has a stricter value for the same condition type
   *   (e.g., source requires 100% coverage but target only requires 80%)
   *
   * When there's no matching target phase at all, all source gates are transferable.
   */
  private findTransferableGates(
    sourcePhase: PipelinePhaseDefinition,
    targetPhase: PipelinePhaseDefinition | null,
  ): string[] {
    if (!targetPhase) {
      // No similar phase in target — all gates are transferable
      return sourcePhase.gates.map((g) => g.id);
    }

    const targetGateIds = new Set(targetPhase.gates.map((g) => g.id));
    const targetGateByType = new Map<string, PipelinePhaseDefinition['gates'][number]>();

    for (const g of targetPhase.gates) {
      const type = g.condition?.type ?? g.id;
      targetGateByType.set(type, g);
    }

    const result: string[] = [];

    for (const sourceGate of sourcePhase.gates) {
      const gateType = sourceGate.condition?.type ?? sourceGate.id;

      // Gate doesn't exist at all in target → transferable
      if (!targetGateIds.has(sourceGate.id) && !targetGateByType.has(gateType)) {
        result.push(sourceGate.id);
        continue;
      }

      // Same type exists in target — check if source has a stricter value
      const targetGate = targetGateByType.get(gateType);
      if (
        targetGate &&
        JSON.stringify(sourceGate.condition?.value) !== JSON.stringify(targetGate.condition?.value)
      ) {
        // Different threshold means the stricter version is transferable
        result.push(sourceGate.id);
      }
    }

    return result;
  }

  /**
   * Generate a human-readable justification for the transfer suggestion.
   */
  private generateJustification(
    sourcePhase: PipelinePhaseDefinition,
    targetPhase: PipelinePhaseDefinition | null,
    sourceDna: DNA,
    targetDna: DNA,
    sharedTypes: string[],
  ): string {
    const phaseTypeStr = sourcePhase.type ?? 'general';
    const targetPhaseName = targetPhase?.name ?? 'no corresponding phase';

    return (
      `'${sourceDna.name}'s "${sourcePhase.name}" phase (${phaseTypeStr}) ` +
      `is ${sourcePhase.blocking ? 'blocking' : 'non-blocking'} with ` +
      `${sourcePhase.gates.length} gates. ` +
      `${targetPhase ? `"${targetPhaseName}" in ${targetDna.name} exists but has gaps` : `${targetDna.name} lacks this phase entirely`}. ` +
      `Applies to shared project types: ${sharedTypes.join(', ')}.`
    );
  }

  /**
   * Compute the overall pipeline-level similarity between two DNA patterns.
   * This considers phase similarity across all pipelines in both DNAs.
   */
  computePipelineSimilarity(sourceDna: DNA, targetDna: DNA): number {
    const sourcePipelines = extractPipelines(sourceDna);
    const targetPipelines = extractPipelines(targetDna);

    if (sourcePipelines.length === 0 || targetPipelines.length === 0) {
      return 0;
    }

    const scores: number[] = [];

    for (const sourcePipeline of sourcePipelines) {
      for (const targetPipeline of targetPipelines) {
        let totalSim = 0;
        let count = 0;

        for (const sourcePhase of sourcePipeline.phases) {
          let bestSim = 0;
          for (const targetPhase of targetPipeline.phases) {
            const sim = computePhaseSimilarity(sourcePhase, targetPhase);
            if (sim > bestSim) bestSim = sim;
          }
          totalSim += bestSim;
          count++;
        }

        if (count > 0) {
          scores.push(totalSim / count);
        }
      }
    }

    if (scores.length === 0) return 0;
    return Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 100) / 100;
  }
}
