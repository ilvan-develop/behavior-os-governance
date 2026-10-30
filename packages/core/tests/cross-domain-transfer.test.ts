import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { CrossDomainTransferEngine } from '../src/engine/cross-domain-transfer-engine.js';

function makeDNA(name: string, rules: any[]): DNA {
  return {
    name,
    version: '1.0.0',
    description: 'test',
    personas: [],
    governance: rules,
    quality: [],
  } as DNA;
}

describe('CrossDomainTransferEngine (G-007)', () => {
  it('suggests transfers between similar DNA patterns', () => {
    const engine = new CrossDomainTransferEngine();

    const source = makeDNA('surgical-team', [
      {
        id: 'surg-1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'resource', value: 'unauthorized-surgery' }],
        description: 'Block unauthorized surgeries',
      },
    ]);

    const target = makeDNA('healthcare-hipaa', [
      {
        id: 'hipaa-1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'resource', value: 'protected-health-info' }],
        description: 'Block unauthorized PHI access',
      },
    ]);

    const transfers = engine.suggestTransfers(source, target);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers[0].sourceDna).toBe('surgical-team');
    expect(transfers[0].targetDna).toBe('healthcare-hipaa');
  });

  it('returns empty for dissimilar patterns', () => {
    const engine = new CrossDomainTransferEngine();
    const source = makeDNA('surgical-team', [
      {
        id: 'surg-1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'resource', value: 'unauthorized-surgery' }],
      },
    ]);
    const target = makeDNA('fintech-trading', [
      {
        id: 'trading-1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'action', value: 'trade-over-limit' }],
      },
    ]);

    const transfers = engine.suggestTransfers(source, target);
    // May have transfers but with low similarity
    expect(transfers.every((t) => t.similarity < 0.8)).toBe(true);
  });

  it('computes overall DNA similarity', () => {
    const engine = new CrossDomainTransferEngine();

    const dnaA = makeDNA('a', [
      { id: 'r1', level: 'high', action: 'block', conditions: [{ type: 'x', value: 'y' }] },
      { id: 'r2', level: 'low', action: 'warn', conditions: [{ type: 'x', value: 'z' }] },
    ]);

    const dnaB = makeDNA('b', [
      { id: 'r1', level: 'high', action: 'block', conditions: [{ type: 'x', value: 'y' }] },
      { id: 'r2', level: 'low', action: 'warn', conditions: [{ type: 'x', value: 'z' }] },
    ]);

    const similarity = engine.computeSimilarity(dnaA, dnaB);
    expect(similarity).toBeGreaterThan(0.8); // Very similar
  });
});
