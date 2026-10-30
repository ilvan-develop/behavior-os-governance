import { describe, expect, it } from 'vitest';
import { ValueAlignmentEngine } from '../src/engine/value-alignment-engine.js';

describe('ValueAlignmentEngine (G-014)', () => {
  it('registers and retrieves values', () => {
    const engine = new ValueAlignmentEngine();
    engine.registerValue({
      id: 'privacy',
      name: 'Privacy',
      description: 'Respect user privacy',
      keywords: ['personal-data', 'pii', 'privacy'],
    });

    expect(engine.getValues()).toHaveLength(1);
  });

  it('assesses alignment for an agent', () => {
    const engine = new ValueAlignmentEngine();
    engine.registerValue({
      id: 'privacy',
      name: 'Privacy',
      description: 'Respect user privacy',
      keywords: ['personal-data', 'pii', 'privacy'],
    });

    const decisions = [
      { action: 'read-personal-data', verdict: 'deny', reason: 'PII blocked' },
      { action: 'run-lint', verdict: 'allow', reason: 'passed' },
    ];

    const score = engine.assessAlignment('agent-1', decisions);
    expect(score.agentId).toBe('agent-1');
    expect(score.overallScore).toBeGreaterThan(0);
    expect(score.values).toHaveLength(1);
  });

  it('detects violations', () => {
    const engine = new ValueAlignmentEngine();
    engine.registerValue({
      id: 'safety',
      name: 'Safety',
      description: 'Do not cause harm',
      keywords: ['deploy', 'production'],
    });

    const decisions = [{ action: 'deploy', verdict: 'allow', reason: 'passed all gates' }];

    const violations = ['Safety: action deploy conflicts with unsafe deployment'];
    const score = engine.assessAlignment('agent-1', decisions, violations);
    expect(score.violations.length).toBeGreaterThan(0);
  });

  it('stores and retrieves latest score per agent', () => {
    const engine = new ValueAlignmentEngine();
    engine.registerValue({
      id: 'v1',
      name: 'Value 1',
      description: 'Test',
      keywords: ['test'],
    });

    engine.assessAlignment('agent-1', [{ action: 'act', verdict: 'allow', reason: 'ok' }]);
    engine.assessAlignment('agent-1', [{ action: 'act', verdict: 'deny', reason: 'blocked' }]);

    const latest = engine.getLatestScore('agent-1');
    expect(latest).toBeDefined();
    expect(latest?.agentId).toBe('agent-1');

    expect(engine.getLatestScore('agent-2')).toBeUndefined();
  });
});
