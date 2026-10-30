import { describe, expect, it } from 'vitest';
import { HybridEvaluationEngine } from '../src/engine/hybrid-evaluation-engine.js';

function makeDecision(verdict: 'allow' | 'deny' | 'escalate' | 'warn') {
  return {
    id: 'dec-1',
    action: 'deploy',
    agentId: 'agent-1',
    verdict,
    reason: 'test',
    rulesEvaluated: ['rule-1'],
    firedRules: verdict === 'allow' ? [] : ['rule-1'],
  } as any;
}

describe('HybridEvaluationEngine (G-004)', () => {
  it('returns the same verdict when no override is needed', () => {
    const engine = new HybridEvaluationEngine();
    const result = engine.evaluate(makeDecision('allow'), 0.1, 0.2);
    expect(result.hybridVerdict).toBe('allow');
    expect(result.diverged).toBe(false);
    expect(result.neuralConfidence).toBeGreaterThan(0);
  });

  it('overrides allow to warn when neural confidence is high and impact is high', () => {
    const engine = new HybridEvaluationEngine();
    const result = engine.evaluate(makeDecision('allow'), 0.9, 0.9);
    expect(result.hybridVerdict).toBe('warn');
    expect(result.diverged).toBe(true);
    expect(result.explanation).toContain('overrides');
  });

  it('downgrades deny to escalate when neural confidence is very low', () => {
    const engine = new HybridEvaluationEngine();
    const result = engine.evaluate(makeDecision('deny'), 0.05, 0.1);
    expect(result.hybridVerdict).toBe('escalate');
    expect(result.diverged).toBe(true);
    expect(result.explanation).toContain('downgraded');
  });

  it('keeps deny when neural confidence is moderate', () => {
    const engine = new HybridEvaluationEngine();
    const result = engine.evaluate(makeDecision('deny'), 0.3, 0.4);
    expect(result.hybridVerdict).toBe('deny');
    expect(result.diverged).toBe(false);
  });

  it('caps confidence to 1.0', () => {
    const engine = new HybridEvaluationEngine();
    const result = engine.evaluate(makeDecision('allow'), 1.0, 1.0);
    expect(result.neuralConfidence).toBeLessThanOrEqual(1.0);
  });
});
