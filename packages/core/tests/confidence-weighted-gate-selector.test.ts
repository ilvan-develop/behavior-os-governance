/**
 * Tests for ConfidenceWeightedGateSelector (F-024)
 *
 * Proves that confidence-weighted gate selection works:
 * 1. Gates with stricter source thresholds get high confidence
 * 2. Identical gates get low confidence (skip)
 * 3. Missing gates in target get high confidence
 * 4. Numeric threshold differences are properly scored
 * 5. Security/coverage gates get a confidence boost
 * 6. minConfidence threshold filters selections correctly
 */
import type { PipelinePhaseDefinition } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import {
  ConfidenceWeightedGateSelector,
  type GateSelectionResult,
} from '../src/engine/confidence-weighted-gate-selector.js';

// Helper to create a phase definition
function makePhase(
  id: string,
  name: string,
  type: string,
  gates: Array<{
    id: string;
    name: string;
    condition?: { type: string; value: unknown; description?: string };
    blocking?: boolean;
    phaseType?: string;
  }>,
  blocking = true,
  requiredSkills: string[] = [],
): PipelinePhaseDefinition {
  return {
    id,
    name,
    type: type as PipelinePhaseDefinition['type'],
    order: 0,
    requiredAgents: [],
    requiredSkills,
    gates: gates.map((g) => ({
      id: g.id,
      name: g.name,
      phaseType: (g.phaseType ??
        'testing') as PipelinePhaseDefinition['gates'][number]['phaseType'],
      blocking: g.blocking ?? true,
      condition: g.condition
        ? {
            type: g.condition.type,
            value: g.condition.value,
            description: g.condition.description ?? g.name,
          }
        : { type: 'default', value: true, description: g.name },
    })),
    blocking,
  };
}

describe('ConfidenceWeightedGateSelector (F-024)', () => {
  describe('selectGates', () => {
    it('recommends transferring a stricter coverage gate (100% vs 80%)', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Controlled Construction', 'backend', [
        {
          id: 'test-coverage-strict',
          name: '100% coverage enforced',
          condition: { type: 'test_coverage', value: 100, description: '100% coverage required' },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Testing & Quality', 'testing', [
        {
          id: 'coverage',
          name: '80% coverage minimum',
          condition: { type: 'test_coverage', value: 80, description: '80% coverage minimum' },
          blocking: true,
        },
      ]);

      const result = engine.selectGates(sourcePhase, targetPhase);

      // Should recommend transferring the stricter coverage gate
      const coverageGate = result.selections.find((s) => s.gateId === 'test-coverage-strict');
      expect(coverageGate).toBeDefined();
      expect(coverageGate?.confidence).toBeGreaterThanOrEqual(0.75);
      expect(coverageGate?.shouldTransfer).toBe(true);
      expect(coverageGate?.reason).toContain('stricter');
    });

    it('does NOT recommend transferring a less strict gate', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        {
          id: 'coverage-lax',
          name: '50% coverage minimum',
          condition: { type: 'test_coverage', value: 50 },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'coverage-strict',
          name: '90% coverage minimum',
          condition: { type: 'test_coverage', value: 90 },
          blocking: true,
        },
      ]);

      const result = engine.selectGates(sourcePhase, targetPhase);

      const coverageGate = result.selections.find((s) => s.gateId === 'coverage-lax');
      expect(coverageGate).toBeDefined();
      expect(coverageGate?.confidence).toBeLessThan(0.5);
      expect(coverageGate?.shouldTransfer).toBe(false);
    });

    it('recommends all gates when target phase is absent', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('sterile-test', 'Sterile Field Testing', 'testing', [
        {
          id: 'coverage',
          name: '100% coverage',
          condition: { type: 'test_coverage', value: 100 },
          blocking: true,
        },
        {
          id: 'security',
          name: 'Zero vulnerabilities',
          condition: { type: 'security', value: 0 },
          blocking: true,
        },
      ]);

      const result = engine.selectGates(sourcePhase, null);

      expect(result.targetPhaseId).toBeNull();
      expect(result.selections.length).toBe(2);
      expect(result.recommendedCount).toBe(2);

      // Security/coverage gates should get high confidence
      const securityGate = result.selections.find((s) => s.gateId === 'security');
      expect(securityGate?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('gives low confidence for identical gates', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('test', 'Testing', 'testing', [
        {
          id: 'adr-required',
          name: 'ADR required',
          condition: { type: 'file-exists', value: 'adr/' },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('arch', 'Architecture', 'architecture', [
        {
          id: 'adr-required',
          name: 'ADR required',
          condition: { type: 'file-exists', value: 'adr/' },
          blocking: true,
        },
      ]);

      const result = engine.selectGates(sourcePhase, targetPhase);

      const gate = result.selections.find((s) => s.gateId === 'adr-required');
      expect(gate).toBeDefined();
      expect(gate?.confidence).toBeLessThanOrEqual(0.2);
      expect(gate?.shouldTransfer).toBe(false);
      expect(gate?.reason).toContain('identical');
    });

    it('gives high confidence for entirely new gate types', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        {
          id: 'security-scan',
          name: 'Zero vulnerabilities',
          condition: { type: 'security', value: 0 },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'coverage',
          name: '80% coverage',
          condition: { type: 'test_coverage', value: 80 },
          blocking: true,
        },
      ]);

      const result = engine.selectGates(sourcePhase, targetPhase);

      const gate = result.selections.find((s) => s.gateId === 'security-scan');
      expect(gate).toBeDefined();
      expect(gate?.confidence).toBeGreaterThanOrEqual(0.7);
      expect(gate?.shouldTransfer).toBe(true);
      expect(gate?.reason).toContain('absent from target');
    });

    it('respects minConfidence threshold', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        {
          id: 'strict-gate',
          name: 'Strict gate',
          condition: { type: 'test_coverage', value: 100 },
          blocking: true,
        },
        {
          id: 'moderate-gate',
          name: 'Moderate gate',
          condition: { type: 'lint', value: 0 },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'coverage',
          name: '80% coverage',
          condition: { type: 'test_coverage', value: 80 },
          blocking: true,
        },
      ]);

      // With high threshold, only the stricter gate should be recommended
      const result = engine.selectGates(sourcePhase, targetPhase, 0.8);
      const recommended = result.selections.filter((s) => s.shouldTransfer);
      expect(recommended.length).toBeLessThanOrEqual(result.selections.length);
      for (const s of recommended) {
        expect(s.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it('computes average confidence correctly', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        {
          id: 'coverage',
          name: '100% coverage',
          condition: { type: 'test_coverage', value: 100 },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', []);

      const result = engine.selectGates(sourcePhase, targetPhase);

      expect(result.totalCount).toBe(1);
      expect(result.averageConfidence).toBeGreaterThan(0);
      expect(result.averageConfidence).toBeCloseTo(result.selections[0]?.confidence, 2);
    });
  });

  describe('suggestTransfers', () => {
    it('returns only gates above the confidence threshold', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        {
          id: 'strict-coverage',
          name: '100% coverage',
          condition: { type: 'test_coverage', value: 100 },
          blocking: true,
        },
        {
          id: 'same-lint',
          name: 'Zero lint',
          condition: { type: 'lint', value: 0 },
          blocking: false,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'coverage',
          name: '80% coverage',
          condition: { type: 'test_coverage', value: 80 },
          blocking: true,
        },
        {
          id: 'lint',
          name: 'Zero lint',
          condition: { type: 'lint', value: 0 },
          blocking: false,
        },
      ]);

      const suggestions = engine.suggestTransfers(sourcePhase, targetPhase, 0.7);

      // Only the stricter coverage gate should be suggested
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.gateId).toBe('strict-coverage');
      expect(suggestions[0]?.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('returns empty array when no gates pass threshold', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'identical',
          name: 'Same gate',
          condition: { type: 'lint', value: 0 },
          blocking: true,
        },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        {
          id: 'lint',
          name: 'Same gate',
          condition: { type: 'lint', value: 0 },
          blocking: true,
        },
      ]);

      const suggestions = engine.suggestTransfers(sourcePhase, targetPhase, 0.5);
      expect(suggestions).toEqual([]);
    });
  });

  describe('getGateConfidences', () => {
    it('returns a map of all gate IDs to confidence scores', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        { id: 'gate1', name: 'Gate 1', condition: { type: 'test_coverage', value: 100 } },
        { id: 'gate2', name: 'Gate 2', condition: { type: 'security', value: 0 } },
      ]);

      const targetPhase = makePhase('test', 'Test Phase', 'testing', [
        { id: 'coverage', name: 'Coverage', condition: { type: 'test_coverage', value: 80 } },
      ]);

      const confidences = engine.getGateConfidences(sourcePhase, targetPhase);

      expect(confidences.size).toBe(2);
      expect(confidences.get('gate1')).toBeGreaterThan(0.5);
      expect(confidences.get('gate2')).toBeGreaterThan(0.5);
    });
  });

  describe('GateSelectionResult structure', () => {
    it('includes all required fields', () => {
      const engine = new ConfidenceWeightedGateSelector();

      const sourcePhase = makePhase('build', 'Build Phase', 'backend', [
        { id: 'gate1', name: 'Gate 1', condition: { type: 'test_coverage', value: 100 } },
      ]);

      const result: GateSelectionResult = engine.selectGates(sourcePhase, null);

      expect(result.sourcePhaseId).toBe('build');
      expect(result.sourcePhaseName).toBe('Build Phase');
      expect(result.targetPhaseId).toBeNull();
      expect(result.targetPhaseName).toBeNull();
      expect(Array.isArray(result.selections)).toBe(true);
      expect(typeof result.averageConfidence).toBe('number');
      expect(typeof result.recommendedCount).toBe('number');
      expect(typeof result.totalCount).toBe('number');
    });
  });
});
