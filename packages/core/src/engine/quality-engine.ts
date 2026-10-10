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

      let passed = false;
      switch (gate.operator ?? 'gte') {
        case 'gte':
          passed = actual >= gate.threshold;
          break;
        case 'lte':
          passed = actual <= gate.threshold;
          break;
        case 'eq':
          passed = actual === gate.threshold;
          break;
        case 'neq':
          passed = actual !== gate.threshold;
          break;
      }

      if (!passed) {
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

  getGates(): QualityGate[] {
    return this.gates;
  }
}
