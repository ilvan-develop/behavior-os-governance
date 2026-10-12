import type { DNA, QualityGate } from '@behavior-os/schemas';

export interface QualityMetrics {
  test_coverage?: number;
  lint_errors?: number;
  typecheck_errors?: number;
  security_vulnerabilities?: number;
  performance_score?: number;
  [key: string]: number | undefined;
}

export interface QualityResult {
  passed: boolean;
  failedGates: Array<{ id: string; expected: number; actual: number; type?: string }>;
  metrics: QualityMetrics;
}

/** Outcome of evaluating a single gate — `skipped` when the metric is absent. */
export interface GateEvaluation {
  status: 'passed' | 'failed' | 'skipped';
  actual?: number;
  expected: number;
  type: string;
}

export class QualityEngine {
  private gates: QualityGate[];

  constructor(dna: DNA) {
    this.gates = dna.quality;
  }

  evaluate(metrics: QualityMetrics): QualityResult {
    const failedGates: Array<{ id: string; expected: number; actual: number; type?: string }> = [];
    const normalizedMetrics = metrics ?? {};

    for (const gate of this.gates) {
      const actual = normalizedMetrics[gate.type];
      if (actual === undefined) continue;
      if (!this.compare(gate.operator ?? 'gte', actual, gate.threshold)) {
        failedGates.push({
          id: gate.id,
          expected: gate.threshold,
          actual,
          type: gate.type,
        });
      }
    }

    return {
      passed: failedGates.length === 0,
      failedGates,
      metrics,
    };
  }

  /**
   * Evaluate a single gate. Unlike {@link evaluate} (which aggregates and skips
   * absent metrics), this reports per-gate status — used by the gate pipeline to
   * expose one pipeline gate per DNA quality gate.
   */
  evaluateGate(gate: QualityGate, metrics: QualityMetrics | undefined): GateEvaluation {
    const actual = metrics?.[gate.type];
    if (actual === undefined) {
      return { status: 'skipped', expected: gate.threshold, type: gate.type };
    }
    const passed = this.compare(gate.operator ?? 'gte', actual, gate.threshold);
    return {
      status: passed ? 'passed' : 'failed',
      actual,
      expected: gate.threshold,
      type: gate.type,
    };
  }

  private compare(
    operator: 'gte' | 'lte' | 'eq' | 'neq',
    actual: number,
    threshold: number,
  ): boolean {
    switch (operator) {
      case 'lte':
        return actual <= threshold;
      case 'eq':
        return actual === threshold;
      case 'neq':
        return actual !== threshold;
      default:
        return actual >= threshold;
    }
  }

  getGates(): QualityGate[] {
    return this.gates;
  }
}
