/**
 * G-007: Cross-Domain Knowledge Transfer Engine.
 *
 * Enhanced graph-based similarity for transferring learning between DNA
 * patterns. Finds structural similarities in governance rules across
 * different DNA patterns.
 */
import type { CrossDomainTransfer, DNA, GovernanceRule } from '@behavior-os/schemas';

interface RuleSignature {
  id: string;
  action: string;
  level: string;
  conditionTypes: string[];
  conditionValues: string[];
}

interface DNAPatternSignature {
  dnaName: string;
  rules: RuleSignature[];
}

function extractConditionTypes(rule: GovernanceRule): string[] {
  return rule.conditions.map((c) => c.type);
}

function extractConditionValues(rule: GovernanceRule): string[] {
  return rule.conditions.map((c) => String(c.value));
}

function ruleToSignature(rule: GovernanceRule): RuleSignature {
  return {
    id: rule.id,
    action: rule.action,
    level: rule.level,
    conditionTypes: extractConditionTypes(rule),
    conditionValues: extractConditionValues(rule),
  };
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((x) => b.has(x));
  const union = new Set([...a, ...b]);
  return intersection.length / union.size;
}

function computeRuleSimilarity(a: RuleSignature, b: RuleSignature): number {
  // Weight: action (0.3), level (0.2), condition types (0.3), condition values (0.2)
  let score = 0;
  if (a.action === b.action) score += 0.3;
  if (a.level === b.level) score += 0.2;

  const typeSim = jaccardSimilarity(new Set(a.conditionTypes), new Set(b.conditionTypes));
  score += typeSim * 0.3;

  const valueSim = jaccardSimilarity(new Set(a.conditionValues), new Set(b.conditionValues));
  score += valueSim * 0.2;

  return score;
}

function computeDNASimilarity(a: DNAPatternSignature, b: DNAPatternSignature): number {
  const maxScores: number[] = [];
  for (const ruleA of a.rules) {
    let best = 0;
    for (const ruleB of b.rules) {
      const sim = computeRuleSimilarity(ruleA, ruleB);
      if (sim > best) best = sim;
    }
    maxScores.push(best);
  }
  if (maxScores.length === 0) return 0;
  return maxScores.reduce((sum, v) => sum + v, 0) / maxScores.length;
}

export class CrossDomainTransferEngine {
  /**
   * Compute graph-based similarity between two DNA patterns
   * and suggest the most transferable rules.
   */
  suggestTransfers(sourceDna: DNA, targetDna: DNA): CrossDomainTransfer[] {
    const sourceSig: DNAPatternSignature = {
      dnaName: sourceDna.name,
      rules: (sourceDna.governance ?? []).map(ruleToSignature),
    };
    const targetSig: DNAPatternSignature = {
      dnaName: targetDna.name,
      rules: (targetDna.governance ?? []).map(ruleToSignature),
    };

    const transfers: CrossDomainTransfer[] = [];

    for (const sourceRule of sourceSig.rules) {
      let bestSim = 0;
      let bestTargetRule: RuleSignature | null = null;

      for (const targetRule of targetSig.rules) {
        const sim = computeRuleSimilarity(sourceRule, targetRule);
        if (sim > bestSim) {
          bestSim = sim;
          bestTargetRule = targetRule;
        }
      }

      if (bestSim > 0.4 && bestTargetRule) {
        transfers.push({
          id: `xfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sourceDna: sourceDna.name,
          targetDna: targetDna.name,
          ruleId: sourceRule.id,
          similarity: Math.round(bestSim * 100) / 100,
          justification: `Rule '${sourceRule.id}' from '${sourceDna.name}' has ${bestSim.toFixed(2)} similarity with '${bestTargetRule.id}' in '${targetDna.name}'.`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return transfers.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Compute the overall structural similarity between two DNA patterns.
   */
  computeSimilarity(sourceDna: DNA, targetDna: DNA): number {
    const sourceSig: DNAPatternSignature = {
      dnaName: sourceDna.name,
      rules: (sourceDna.governance ?? []).map(ruleToSignature),
    };
    const targetSig: DNAPatternSignature = {
      dnaName: targetDna.name,
      rules: (targetDna.governance ?? []).map(ruleToSignature),
    };
    return computeDNASimilarity(sourceSig, targetSig);
  }
}

export type { CrossDomainTransfer };
