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

  /**
   * Avalia se as mudanças têm valor pragmático real.
   * Uma feature é considerada "pragmática" se:
   - Remove mais código do que adiciona (redução líquida)
   - Reduz complexidade cíclomática
   - Aumenta ou mantém a cobertura de teste
   - Não introduz duplicação de regras de negócio
   
   @param changes - Diff das alterações (adicionadas/removidas)
   @param metrics - Métricas antes/depois das mudanças
   @returns Assessment with score, strengths, warnings and recommendations
   */
  assessPragmaticValue(
    changes: Array<{ addedLines: number; removedLines: number }>,
    metrics: {
      before: { complexity: number; testCoverage: number; rulesCount: number };
      after: { complexity: number; testCoverage: number; rulesCount: number };
    },
  ): {
    score: number; // 0 a 1 (1 = totalmente pragmático)
    strengths: string[];
    warnings: string[];
    recommendations: string[];
  } {
    const strengths: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // 1. Calcular redução líquida de código
    let netCodeChange = 0;
    for (const change of changes) {
      netCodeChange += change.removedLines - change.addedLines;
    }

    if (netCodeChange > 0) {
      strengths.push(`Removed ${netCodeChange} lines of code net`);
    } else if (netCodeChange < 0) {
      warnings.push(`Added ${-netCodeChange} lines net; consider if removal is possible`);
    } else {
      strengths.push('Code volume maintained at current level');
    }

    // 2. Verificar mudança de complexidade
    const complexityChange = metrics.after.complexity - metrics.before.complexity;
    if (complexityChange < 0) {
      strengths.push(`Complexidade reduzida em ${-complexityChange} pontos`);
    } else if (complexityChange > 0) {
      warnings.push(`Complexidade aumentou em ${complexityChange} pontos; considerar refatoração`);
    } else {
      strengths.push('Complexidade mantida em nível atual');
    }

    // 3. Verificar mudança na cobertura de teste
    const coverageChange = metrics.after.testCoverage - metrics.before.testCoverage;
    if (coverageChange >= 0) {
      strengths.push(`Cobertura de teste mantida ou aumentada em ${coverageChange}%`);
    } else {
      warnings.push(
        `Cobertura de teste diminuiu em ${-coverageChange}%; considerar adicionar testes`,
      );
    }

    // 4. Verificar duplicação de regras
    const rulesChange = metrics.after.rulesCount - metrics.before.rulesCount;
    if (rulesChange <= 0) {
      strengths.push(`Nenhuma nova regra de negócio adicionada; duplicidade evitada`);
    } else if (rulesChange <= 5) {
      warnings.push(
        `${rulesChange} nova(s) regra(s) de negócio adicionada(s); verificar se são necessárias`,
      );
    } else {
      warnings.push(
        `${rulesChange} nova(s) regra(s) de negócio adicionada(s); alto risco de duplicidade`,
      );
      recommendations.push('Revisar regras novas em busca de oportunidades de consolidamento');
    }

    // 5. Score composto pragmático (peso diferentes fatores)
    let score = 0.5; // base neutral
    if (netCodeChange > 0) score += 0.2;
    if (complexityChange < 0) score += 0.2;
    if (coverageChange >= 0) score += 0.2;
    if (rulesChange <= 0) score += 0.1;
    score = Math.max(0, Math.min(1, score));

    return {
      score,
      strengths,
      warnings,
      recommendations,
    };
  }
}
