import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { QualityEngine } from '../src/engine/quality-engine.js';

describe('QualityEngine Advanced', () => {
  const createDNA = (gates: any[]): DNA => ({
    name: 'Test',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [],
    quality: gates,
  });

  it('should handle missing metrics gracefully', () => {
    const engine = new QualityEngine(
      createDNA([
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
        { id: 'security', type: 'security', threshold: 0 },
      ]),
    );

    // Missing security metrics should not crash
    const result = engine.evaluate({ test_coverage: 90 });
    expect(result.passed).toBe(true);
  });

  it('should handle extreme values', () => {
    const engine = new QualityEngine(
      createDNA([{ id: 'coverage', type: 'test_coverage', threshold: 80 }]),
    );

    const result = engine.evaluate({ test_coverage: 999 });
    expect(result.passed).toBe(true);
  });

  it('should handle zero threshold gates', () => {
    const engine = new QualityEngine(
      createDNA([{ id: 'lint', type: 'lint_errors', threshold: 0, operator: 'lte' }]),
    );

    const pass = engine.evaluate({ lint_errors: 0 });
    expect(pass.passed).toBe(true);

    const fail = engine.evaluate({ lint_errors: 1 });
    expect(fail.passed).toBe(false);
  });

  it('should return detailed failure reasons', () => {
    const engine = new QualityEngine(
      createDNA([
        { id: 'coverage', type: 'test_coverage', threshold: 90 },
        { id: 'security', type: 'security_vulnerabilities', threshold: 0, operator: 'lte' },
      ]),
    );

    const result = engine.evaluate({
      test_coverage: 50,
      security_vulnerabilities: 5,
    });

    expect(result.passed).toBe(false);
    expect(result.failedGates).toHaveLength(2);

    for (const gate of result.failedGates) {
      expect(gate).toHaveProperty('id');
      expect(gate).toHaveProperty('expected');
      expect(gate).toHaveProperty('actual');
      expect(gate).toHaveProperty('type');
    }
  });

  it('should support custom operators', () => {
    const engine = new QualityEngine(
      createDNA([
        { id: 'build-time', type: 'build_time', threshold: 60, operator: 'lte' },
        { id: 'exact', type: 'exact_test', threshold: 100, operator: 'eq' },
      ]),
    );

    const pass = engine.evaluate({ build_time: 30, exact_test: 100 });
    expect(pass.passed).toBe(true);

    const fail = engine.evaluate({ build_time: 90, exact_test: 99 });
    expect(fail.passed).toBe(false);
  });

  it('should handle boolean metrics', () => {
    const engine = new QualityEngine(
      createDNA([{ id: 'tests-passed', type: 'tests_passed', threshold: 1, operator: 'eq' }]),
    );

    const pass = engine.evaluate({ tests_passed: 1 });
    expect(pass.passed).toBe(true);

    const fail = engine.evaluate({ tests_passed: 0 });
    expect(fail.passed).toBe(false);
  });
});
