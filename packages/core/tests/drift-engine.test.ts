import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { DriftEngine } from '../src/engine/drift-engine.js';
import { BehaviorOS } from '../src/index.js';

function makeDNA(overrides: Partial<DNA> = {}): DNA {
  return {
    name: 'test-dna',
    version: '1.0.0',
    description: 'fixture',
    personas: [{ role: 'engineer', name: 'Eng', authority: 'architect', skills: ['ts'] }],
    governance: [
      {
        id: 'r1',
        level: 'medium',
        action: 'warn',
        conditions: [{ type: 'pattern', value: 'fail' }],
      },
      { id: 'r2', level: 'high', action: 'block', conditions: [{ type: 'risk', value: 'prod' }] },
    ],
    quality: [
      { id: 'q1', type: 'test_coverage', threshold: 80 },
      { id: 'q2', type: 'lint', threshold: 0 },
    ],
    ...overrides,
  };
}

describe('DriftEngine', () => {
  const engine = new DriftEngine();

  it('reports no drift when DNAs are identical', () => {
    const dna = makeDNA();
    const drift = engine.compare(dna, dna);
    expect(drift.rulesAdded).toBe(0);
    expect(drift.rulesRemoved).toBe(0);
    expect(drift.gatesAdded).toBe(0);
    expect(drift.gatesRemoved).toBe(0);
    expect(drift.totalChanges).toBe(0);
    expect(drift.significant).toBe(false);
    expect(drift.summary).toContain('No drift');
  });

  it('detects added and removed rules', () => {
    const oldDna = makeDNA({
      governance: [
        {
          id: 'r1',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'pattern', value: 'a' }],
        },
        { id: 'r2', level: 'high', action: 'block', conditions: [{ type: 'risk', value: 'prod' }] },
      ],
    });
    const newDna = makeDNA({
      governance: [
        {
          id: 'r1',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'pattern', value: 'a' }],
        },
        {
          id: 'r3',
          level: 'critical',
          action: 'escalate',
          conditions: [{ type: 'risk', value: 'high' }],
        },
      ],
    });
    const drift = engine.compare(oldDna, newDna);
    expect(drift.rulesAdded).toBe(1);
    expect(drift.rulesRemoved).toBe(1);
    expect(drift.totalChanges).toBe(2);
    expect(drift.significant).toBe(true);
  });

  it('detects added and removed quality gates', () => {
    const oldDna = makeDNA({ quality: [{ id: 'q1', type: 'test_coverage', threshold: 80 }] });
    const newDna = makeDNA({ quality: [{ id: 'q2', type: 'lint', threshold: 0 }] });
    const drift = engine.compare(oldDna, newDna);
    expect(drift.gatesAdded).toBe(1);
    expect(drift.gatesRemoved).toBe(1);
    expect(drift.totalChanges).toBe(2);
    expect(drift.significant).toBe(true);
  });

  it('classifies drift as significant only when totalChanges >= 2', () => {
    const oldDna = makeDNA({ governance: [] });
    const newDna = makeDNA({
      governance: [
        { id: 'r1', level: 'low', action: 'log', conditions: [{ type: 'x', value: 1 }] },
      ],
    });
    expect(engine.compare(oldDna, newDna).significant).toBe(false);

    const newDna2 = makeDNA({
      governance: [
        { id: 'r1', level: 'low', action: 'log', conditions: [{ type: 'x', value: 1 }] },
        { id: 'r2', level: 'low', action: 'log', conditions: [{ type: 'y', value: 2 }] },
      ],
    });
    expect(engine.compare(oldDna, newDna2).significant).toBe(true);
  });

  it('includes structured metadata in the result', () => {
    const drift = engine.compare(makeDNA(), makeDNA());
    expect(typeof drift.id).toBe('string');
    expect(drift.newerName).toBe('test-dna');
    expect(drift.olderName).toBe('test-dna');
    expect(typeof drift.timestamp).toBe('string');
  });
});

describe('BehaviorOS.compareDNADrift (facade wiring)', () => {
  it('uses a real DriftEngine instead of a placeholder result', () => {
    const bos = new BehaviorOS();
    const older = makeDNA({ name: 'older-dna' });
    const newer = makeDNA({
      name: 'newer-dna',
      governance: [
        {
          id: 'r1',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'pattern', value: 'a' }],
        },
      ],
      quality: [],
    });

    const drift = bos.compareDNADrift(older, newer);

    expect(drift.id).toMatch(/^drift-/);
    expect(drift.summary).not.toContain('No drift engine available');
    expect(drift.olderName).toBe('older-dna');
    expect(drift.newerName).toBe('newer-dna');
    expect(drift.rulesRemoved).toBe(1);
    expect(drift.gatesRemoved).toBe(2);
    expect(drift.totalChanges).toBe(3);
    expect(drift.significant).toBe(true);
  });
});
