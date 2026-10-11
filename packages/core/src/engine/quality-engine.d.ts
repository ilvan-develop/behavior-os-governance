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
  failedGates: Array<{
    id: string;
    expected: number;
    actual: number;
    type?: string;
  }>;
  metrics: QualityMetrics;
}
export declare class QualityEngine {
  private gates;
  constructor(dna: DNA);
  evaluate(metrics: QualityMetrics): QualityResult;
  getGates(): QualityGate[];
}
//# sourceMappingURL=quality-engine.d.ts.map
