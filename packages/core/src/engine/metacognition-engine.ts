import type { GovernanceDecision } from '@behavior-os/schemas';

/**
 * A reasoning step in a metacognitive trace.
 * Each step records what was considered, what evidence was used, and why.
 */
export interface ReasoningStep {
  id: string;
  /** The action or question being reasoned about */
  question: string;
  /** What evidence or context was considered */
  evidence: string[];
  /** Alternative considerations */
  alternatives: AlternativeConsideration[];
  /** The conclusion at this step */
  conclusion: string;
  /** Confidence in this step (0-1) */
  confidence: number;
  /** When this step was created */
  timestamp: string;
}

/** An alternative that was considered but not chosen */
export interface AlternativeConsideration {
  option: string;
  /** Why it was rejected */
  rejectionReason: string;
  /** How likely it was considered */
  likelihood: number;
}

/** A bias indicator detected during reasoning */
export interface BiasIndicator {
  type: string;
  /** Description of the bias */
  description: string;
  /** Severity: low, medium, high */
  severity: 'low' | 'medium' | 'high';
  /** Mitigation suggestion */
  mitigation: string;
}

/**
 * A meta-decision that includes the decision plus reasoning metadata.
 * This enables explainability and self-improvement.
 */
export interface MetaDecision {
  /** The underlying governance decision */
  decision: GovernanceDecision;
  /** The reasoning path that led to this decision */
  reasoningPath: ReasoningStep[];
  /** Overall confidence in the decision (0-1) */
  confidence: number;
  /** Biases detected during reasoning */
  biasDetection: BiasIndicator[];
  /** Self-critique: what could be improved */
  selfCritique: string;
  /** When this meta-decision was created */
  createdAt: string;
  /** ID of the agent that made this decision */
  agentId: string;
  /** The DNA pattern active at the time */
  dnaPattern?: string;
}

/**
 * Metacognition Engine (G-002).
 *
 * Provides:
 * - Reasoning path reconstruction for governance decisions
 * - Confidence scoring based on evidence quality and rule coverage
 * - Bias detection (e.g., recency bias, confirmation bias in rule selection)
 * - Self-critique generation
 * - Alternative consideration tracking
 *
 * This is a proof-of-concept implementation. Production would integrate with
 * LLM-based reasoning reconstruction and more sophisticated bias detection.
 */
export class MetaCognitionEngine {
  private metaDecisions = new Map<string, MetaDecision>();

  /**
   * Create a meta-decision from a governance evaluation.
   *
   * This reconstructs the reasoning path by:
   * 1. Analyzing which rules fired and why
   * 2. Identifying alternative actions that could have been taken
   * 3. Computing confidence based on evidence coverage
   * 4. Detecting potential biases in the decision process
   */
  createMetaDecision(
    decision: GovernanceDecision,
    options: {
      context?: Record<string, unknown>;
      agentId: string;
      dnaPattern?: string;
      /** Additional evidence that was considered */
      additionalEvidence?: string[];
    } = { agentId: 'unknown' },
  ): MetaDecision {
    const ctx = options.context ?? {};
    const reasoningPath = this.reconstructReasoning(decision, ctx);
    const confidence = this.computeConfidence(decision, ctx, reasoningPath);
    const biasDetection = this.detectBiases(decision, ctx, reasoningPath);
    const selfCritique = this.generateSelfCritique(decision, reasoningPath, biasDetection);
    const alternatives = this.identifyAlternatives(decision, ctx);

    const metaDecision: MetaDecision = {
      decision,
      reasoningPath,
      confidence,
      biasDetection,
      selfCritique,
      createdAt: new Date().toISOString(),
      agentId: options.agentId,
      dnaPattern: options.dnaPattern,
    };

    // Add alternatives to the last reasoning step
    if (alternatives.length > 0 && reasoningPath.length > 0) {
      reasoningPath[reasoningPath.length - 1].alternatives = alternatives;
    }

    this.metaDecisions.set(decision.id, metaDecision);
    return metaDecision;
  }

  /**
   * Reconstruct the reasoning path from a governance decision.
   *
   * This simulates what an agent would have "thought" to reach this decision.
   */
  private reconstructReasoning(
    decision: GovernanceDecision,
    context: Record<string, unknown>,
  ): ReasoningStep[] {
    const steps: ReasoningStep[] = [];
    const now = new Date().toISOString();

    // Step 1: Action recognition
    steps.push({
      id: `step-${Date.now()}-1`,
      question: `What action is being considered? "${decision.action}"`,
      evidence: [`Action type: ${decision.action}`, `Agent: ${decision.agentId}`],
      alternatives: [],
      conclusion: `Recognized action: ${decision.action}`,
      confidence: 0.95,
      timestamp: now,
    });

    // Step 2: Context analysis
    const contextKeys = Object.keys(context).filter((k) => k !== 'agent');
    steps.push({
      id: `step-${Date.now()}-2`,
      question: 'What is the current context?',
      evidence: contextKeys.map((k) => `${k}: ${context[k]}`),
      alternatives: [],
      conclusion: `Context includes ${contextKeys.length} signals`,
      confidence: 0.9,
      timestamp: now,
    });

    // Step 3: Rule evaluation
    const evaluatedRules = decision.rulesEvaluated ?? [];
    const firedRules = decision.firedRules ?? [];
    steps.push({
      id: `step-${Date.now()}-3`,
      question: 'Which governance rules apply?',
      evidence: [
        `Evaluated ${evaluatedRules.length} rules`,
        `Fired ${firedRules.length} rules: ${firedRules.join(', ')}`,
      ],
      alternatives: [],
      conclusion:
        firedRules.length > 0 ? `Rules ${firedRules.join(', ')} triggered` : 'No rules triggered',
      confidence: 0.95,
      timestamp: now,
    });

    // Step 4: Verdict determination
    const verdictReasons: string[] = [];
    if ((decision.firedRules?.length ?? 0) > 0) {
      verdictReasons.push(`Rule violation: ${decision.reason}`);
    }
    if ((decision.warnings?.length ?? 0) > 0) {
      verdictReasons.push(`Warnings: ${decision.warnings?.join(', ')}`);
    }
    if (verdictReasons.length === 0 && decision.verdict === 'allow') {
      verdictReasons.push('No constraints violated');
    }

    steps.push({
      id: `step-${Date.now()}-4`,
      question: `What is the verdict? (${decision.verdict})`,
      evidence: verdictReasons,
      alternatives: this.generateVerdictAlternatives(decision),
      conclusion: `Verdict: ${decision.verdict}`,
      confidence: 0.9,
      timestamp: now,
    });

    return steps;
  }

  /**
   * Compute overall confidence in the decision.
   *
   * Factors:
   * - Rule coverage: how many relevant rules were evaluated
   * - Evidence quality: how well-supported the decision is
   * - Consistency: whether similar contexts produce similar results
   */
  private computeConfidence(
    decision: GovernanceDecision,
    context: Record<string, unknown>,
    reasoningPath: ReasoningStep[],
  ): number {
    // Base confidence from rule firing
    const ruleCoverage =
      (decision.rulesEvaluated?.length ?? 0) > 0
        ? Math.min(
            1,
            (decision.firedRules?.length ?? 0) / Math.max(1, decision.rulesEvaluated.length),
          )
        : 0.5;

    // Evidence quality score
    const evidenceCount = reasoningPath.reduce(
      (sum, step) => sum + (step.evidence?.length ?? 0),
      0,
    );
    const evidenceQuality = Math.min(1, evidenceCount / 10);

    // Context completeness
    const contextKeys = Object.keys(context).filter((k) => k !== 'agent');
    const contextCompleteness = Math.min(1, contextKeys.length / 5);

    // Weighted combination
    const confidence = ruleCoverage * 0.4 + evidenceQuality * 0.3 + contextCompleteness * 0.3;
    return Math.round(confidence * 100) / 100;
  }

  /**
   * Detect potential biases in the decision process.
   */
  private detectBiases(
    decision: GovernanceDecision,
    _context: Record<string, unknown>,
    _reasoningPath: ReasoningStep[],
  ): BiasIndicator[] {
    const biases: BiasIndicator[] = [];

    // Check for recency bias (shallow rule evaluation — few rules considered)
    const evaluatedCount = decision.rulesEvaluated?.length ?? 0;
    if (evaluatedCount < 3) {
      biases.push({
        type: 'recency-bias',
        description: `Only ${evaluatedCount} rule(s) evaluated — may indicate recency bias`,
        severity: 'low',
        mitigation: 'Consider reviewing historical decisions for pattern consistency',
      });
    }

    // Check for confirmation bias (deny decision with all evaluated rules firing)
    if (
      decision.verdict !== 'allow' &&
      (decision.firedRules?.length ?? 0) > 0 &&
      evaluatedCount > 0 &&
      (decision.firedRules?.length ?? 0) === evaluatedCount
    ) {
      biases.push({
        type: 'confirmation-bias',
        description: 'All evaluated rules fired — consider if disconfirming evidence was reviewed',
        severity: 'medium',
        mitigation: 'Explicitly evaluate alternative actions before deciding',
      });
    }

    // Check for authority bias (over-reliance on critical rules)
    const criticalFired = (decision.firedRules ?? []).filter(
      (ruleId) => ruleId.includes('critical') || ruleId.includes('block'),
    );
    if (criticalFired.length > 0 && criticalFired.length === (decision.firedRules?.length ?? 0)) {
      biases.push({
        type: 'authority-bias',
        description: 'All fired rules are critical/block rules',
        severity: 'low',
        mitigation: 'Verify that less restrictive alternatives were considered',
      });
    }

    return biases;
  }

  /**
   * Generate self-critique for the decision.
   */
  private generateSelfCritique(
    decision: GovernanceDecision,
    reasoningPath: ReasoningStep[],
    biases: BiasIndicator[],
  ): string {
    const issues: string[] = [];

    if (biases.length > 0) {
      issues.push(
        `Detected ${biases.length} potential bias(es): ${biases.map((b) => b.type).join(', ')}`,
      );
    }

    if (reasoningPath.length < 3) {
      issues.push('Reasoning path is shallow - consider deeper analysis');
    }

    if (decision.verdict === 'deny' && (decision.firedRules?.length ?? 0) > 2) {
      issues.push('Multiple rules triggered - verify no single rule change would suffice');
    }

    if (issues.length === 0) {
      return 'Decision appears sound with adequate reasoning coverage';
    }

    return `Critique: ${issues.join('. ')}.`;
  }

  /**
   * Identify alternative actions that could have been considered.
   */
  private identifyAlternatives(
    decision: GovernanceDecision,
    _context: Record<string, unknown>,
  ): AlternativeConsideration[] {
    const alternatives: AlternativeConsideration[] = [];

    switch (decision.verdict) {
      case 'deny':
        alternatives.push({
          option: 'escalate',
          rejectionReason: 'Rule specifies block, not escalate',
          likelihood: 0.2,
        });
        alternatives.push({
          option: 'transform',
          rejectionReason: 'No transform rules matched',
          likelihood: 0.1,
        });
        break;
      case 'escalate':
        alternatives.push({
          option: 'deny',
          rejectionReason: 'Rules specify escalate, not block',
          likelihood: 0.3,
        });
        alternatives.push({
          option: 'allow',
          rejectionReason: 'Escalation rules require human review',
          likelihood: 0.1,
        });
        break;
      case 'allow':
        alternatives.push({
          option: 'warn',
          rejectionReason: 'No warn rules matched',
          likelihood: 0.4,
        });
        break;
    }

    return alternatives;
  }

  /**
   * Generate alternative verdict options for a decision.
   */
  private generateVerdictAlternatives(decision: GovernanceDecision): AlternativeConsideration[] {
    const alternatives: AlternativeConsideration[] = [];

    switch (decision.verdict) {
      case 'deny':
        alternatives.push({
          option: 'escalate',
          rejectionReason: 'DNA rule specifies block action',
          likelihood: 0.1,
        });
        break;
      case 'escalate':
        alternatives.push({
          option: 'deny',
          rejectionReason: 'DNA rule specifies escalate, not block',
          likelihood: 0.2,
        });
        alternatives.push({
          option: 'allow',
          rejectionReason: 'Escalation requires human approval',
          likelihood: 0.1,
        });
        break;
      case 'allow':
        alternatives.push({
          option: 'warn',
          rejectionReason: 'No warning rules matched',
          likelihood: 0.3,
        });
        break;
    }

    return alternatives;
  }

  /**
   * Get a meta-decision by its ID.
   */
  getMetaDecision(metaDecisionId: string): MetaDecision | undefined {
    return this.metaDecisions.get(metaDecisionId);
  }

  /**
   * Get all meta-decisions.
   */
  getAllMetaDecisions(): MetaDecision[] {
    return [...this.metaDecisions.values()];
  }

  /**
   * Clear all stored meta-decisions.
   */
  clear(): void {
    this.metaDecisions.clear();
  }

  /**
   * Get statistics about the meta-cognition engine.
   */
  getStats(): {
    totalMetaDecisions: number;
    avgConfidence: number;
    totalBiasesDetected: number;
    decisionsByVerdict: Record<string, number>;
  } {
    const decisions = [...this.metaDecisions.values()];
    const totalBiases = decisions.reduce((sum, d) => sum + (d.biasDetection?.length ?? 0), 0);
    const avgConfidence =
      decisions.length > 0
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length
        : 0;

    const decisionsByVerdict: Record<string, number> = {};
    for (const d of decisions) {
      const verdict = d.decision.verdict;
      decisionsByVerdict[verdict] = (decisionsByVerdict[verdict] ?? 0) + 1;
    }

    return {
      totalMetaDecisions: decisions.length,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      totalBiasesDetected: totalBiases,
      decisionsByVerdict,
    };
  }
}
