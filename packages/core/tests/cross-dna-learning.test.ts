import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { CrossDnaLearningEngine } from '../src/engine/cross-dna-learning.js';

describe('CrossDnaLearningEngine', () => {
  const engine = new CrossDnaLearningEngine();

  const makeDna = (
    name: string,
    rules: Array<{
      id: string;
      action: string;
      conditions: Array<{ type: string; value: unknown }>;
    }>,
  ): DNA => ({
    name,
    version: '1.0.0',
    description: 'Test DNA',
    personas: [{ role: 'test', name: 'Test', authority: 'test', skills: [] }],
    governance: rules.map((r) => ({
      id: r.id,
      level: 'high' as const,
      action: r.action as any,
      conditions: r.conditions as any,
      description: '',
    })),
    quality: [],
  });

  it('suggests transfer when target lacks coverage', () => {
    const source = makeDna('Source', [
      {
        id: 'security-audit',
        action: 'block',
        conditions: [{ type: 'contract-deployment', value: true }],
      },
    ]);
    const target = makeDna('Target', []);
    // Events must match the condition type to trigger suggestion
    const events = [
      {
        id: 'e1',
        type: 'contract-deployment',
        content: 'Deploy without audit',
        impact: 'critical' as const,
        source: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'e2',
        type: 'contract-deployment',
        content: 'Deploy without audit',
        impact: 'high' as const,
        source: 'test',
        timestamp: new Date().toISOString(),
      },
    ];

    const suggestions = engine.suggestTransfers(
      source,
      target,
      events as unknown as import('@behavior-os/schemas').LearningEvent[],
      0.3,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].targetDna).toBe('Target');
  });

  it('does not suggest when target already has matching condition', () => {
    const source = makeDna('Source', [
      {
        id: 'security-audit',
        action: 'block',
        conditions: [{ type: 'contract-deployment', value: true }],
      },
    ]);
    // Target has a rule with the SAME condition type
    const target = makeDna('Target', [
      {
        id: 'existing-audit',
        action: 'block',
        conditions: [{ type: 'contract-deployment', value: true }],
      },
    ]);
    const events = [
      {
        id: 'e1',
        type: 'contract-deployment',
        content: 'Deploy without audit',
        impact: 'critical' as const,
        source: 'test',
        timestamp: new Date().toISOString(),
      },
      {
        id: 'e2',
        type: 'contract-deployment',
        content: 'Deploy without audit',
        impact: 'high' as const,
        source: 'test',
        timestamp: new Date().toISOString(),
      },
    ];

    const suggestions = engine.suggestTransfers(
      source,
      target,
      events as unknown as import('@behavior-os/schemas').LearningEvent[],
      0.3,
    );
    expect(suggestions.length).toBe(0);
  });

  it('returns empty when no events', () => {
    const source = makeDna('Source', []);
    const target = makeDna('Target', []);
    const suggestions = engine.suggestTransfers(source, target, [], 0.3);
    expect(suggestions.length).toBe(0);
  });
});
