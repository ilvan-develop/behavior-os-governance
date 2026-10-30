import type { GovernanceDecision } from '@behavior-os/schemas';

/**
 * G-004: Symbolic-Neural Hybrid Evaluation Engine.
 *
 * Combines deterministic symbolic rule evaluation with a learned
 * confidence signal. The PoC implementation approximates the neural
 * component by scoring pattern frequency and impact from the learning
 * engine's event history.
 */

interface HybridEvaluation {
  id: string;
  /** The deterministic symbolic (rule-based) verdict. */
  symbolicVerdict: 'allow' | 'deny' | 'escalate' | 'transform';
  /** Neural confidence score (0..1). */
  neuralConfidence: number;
  /** The combined hybrid verdict. */
  hybridVerdict: 'allow' | 'deny' | 'escalate' | 'warn';
  /** Whether the hybrid diverged from the symbolic result. */
  diverged: boolean;
  /** Explanation of why the hybrid differs from the symbolic result. */
  explanation: string;
  timestamp: string;
}

export class HybridEvaluationEngine {
  /**
   * Evaluate an action using both symbolic rules and a neural-style
   * confidence score.
   */
  evaluate(
    symbolic: GovernanceDecision,
    patternFrequency: number,
    avgImpact: number,
  ): HybridEvaluation {
    const neuralConfidence = this.computeNeuralConfidence(patternFrequency, avgImpact);

    // Map symbolic verdict to the hybrid's wider verdict type
    const symbolicMapped: 'allow' | 'deny' | 'escalate' | 'warn' =
      symbolic.verdict === 'transform' ? 'warn' : symbolic.verdict;
    let hybridVerdict: 'allow' | 'deny' | 'escalate' | 'warn' = symbolicMapped;
    let diverged = false;
    let explanation = 'Hybrid verdict matches symbolic verdict.';

    // Override: allow + high neural + high impact → warn
    if (symbolic.verdict === 'allow' && neuralConfidence > 0.8 && avgImpact > 0.7) {
      hybridVerdict = 'warn';
      diverged = true;
      explanation = `Neural signal (confidence ${neuralConfidence}) overrides symbolic 'allow' to 'warn'.`;
    }

    // Override: deny + very low neural → escalate
    if (symbolic.verdict === 'deny' && neuralConfidence < 0.2) {
      hybridVerdict = 'escalate';
      diverged = true;
      explanation = `Neural confidence (${neuralConfidence}) low; downgraded 'deny' to 'escalate'.`;
    }

    return {
      id: `hybrid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      symbolicVerdict: symbolic.verdict,
      neuralConfidence,
      hybridVerdict,
      diverged,
      explanation,
      timestamp: new Date().toISOString(),
    };
  }

  private computeNeuralConfidence(patternFrequency: number, avgImpact: number): number {
    const score = patternFrequency * 0.6 + avgImpact * 0.4;
    return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
  }
}

export type { HybridEvaluation };
