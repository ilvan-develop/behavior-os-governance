import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { QualityEngine } from '../src/engine/quality-engine.js';

describe('QualityEngine', () => {
  const createMockDNA = (gates: unknown[]): DNA => ({
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [],
    quality: gates as DNA['quality'],
  });

  it('should pass when all metrics meet thresholds', () => {
    const engine = new QualityEngine(
      createMockDNA([
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
        { id: 'lint', type: 'lint', threshold: 0 },
      ]),
    );

    const result = engine.evaluate({
      test_coverage: 90,
      lint_errors: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.failedGates).toHaveLength(0);
  });

  it('should fail when coverage is below threshold', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'coverage', type: 'test_coverage', threshold: 80 }]),
    );

    const result = engine.evaluate({
      test_coverage: 50,
    });

    expect(result.passed).toBe(false);
    expect(result.failedGates).toHaveLength(1);
    expect(result.failedGates[0].id).toBe('coverage');
    expect(result.failedGates[0].expected).toBe(80);
    expect(result.failedGates[0].actual).toBe(50);
  });

  it('should fail when lint errors exceed threshold', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'lint', type: 'lint_errors', threshold: 0, operator: 'lte' }]),
    );

    const result = engine.evaluate({
      lint_errors: 5,
    });

    expect(result.passed).toBe(false);
    expect(result.failedGates).toHaveLength(1);
  });

  it('should handle lte operator correctly', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'max-time', type: 'build_time', threshold: 30, operator: 'lte' }]),
    );

    // Build time under limit should pass
    const pass = engine.evaluate({ build_time: 20 });
    expect(pass.passed).toBe(true);

    // Build time over limit should fail
    const fail = engine.evaluate({ build_time: 40 });
    expect(fail.passed).toBe(false);
  });

  it('should handle eq operator correctly', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'exact', type: 'exact_metric', threshold: 100, operator: 'eq' }]),
    );

    const result = engine.evaluate({ exact_metric: 100 });
    expect(result.passed).toBe(true);

    const fail = engine.evaluate({ exact_metric: 99 });
    expect(fail.passed).toBe(false);
  });

  it('should skip undefined metrics', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'coverage', type: 'test_coverage', threshold: 80 }]),
    );

    // Should pass even though coverage is not provided
    const result = engine.evaluate({ other_metric: 100 });
    expect(result.passed).toBe(true);
  });

  it('should return metrics in result', () => {
    const engine = new QualityEngine(
      createMockDNA([{ id: 'coverage', type: 'test_coverage', threshold: 80 }]),
    );

    const result = engine.evaluate({ test_coverage: 90 });
    expect(result.metrics.test_coverage).toBe(90);
  });

  it('should get all gates', () => {
    const engine = new QualityEngine(
      createMockDNA([
        { id: 'gate-1', type: 'test_coverage', threshold: 80 },
        { id: 'gate-2', type: 'lint', threshold: 0 },
      ]),
    );

    const gates = engine.getGates();
    expect(gates).toHaveLength(2);
  });

  it('should fail multiple gates', () => {
    const engine = new QualityEngine(
      createMockDNA([
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
        { id: 'security', type: 'security_vulnerabilities', threshold: 0, operator: 'lte' },
        { id: 'lint', type: 'lint_errors', threshold: 0, operator: 'lte' },
      ]),
    );

    const result = engine.evaluate({
      test_coverage: 50,
      security_vulnerabilities: 3,
      lint_errors: 2,
    });

    expect(result.passed).toBe(false);
    expect(result.failedGates).toHaveLength(3);
  });
});
