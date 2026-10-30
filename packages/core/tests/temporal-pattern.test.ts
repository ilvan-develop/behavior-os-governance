import { describe, expect, it } from 'vitest';
import { TemporalPatternEngine } from '../src/engine/temporal-pattern-engine.js';

describe('TemporalPatternEngine (G-005)', () => {
  it('returns empty when not enough events', () => {
    const engine = new TemporalPatternEngine();
    engine.recordEvent({
      id: 'e1',
      agentId: 'a1',
      ruleId: 'r1',
      verdict: 'allow',
      timestamp: Date.now(),
    });
    expect(engine.analyze()).toHaveLength(0);
  });

  it('detects a pattern when a rule fires consistently at a specific hour', () => {
    const engine = new TemporalPatternEngine();

    // 5 events at hour 3, all denied
    for (let i = 0; i < 5; i++) {
      engine.recordEvent({
        id: `e${i}`,
        agentId: 'a1',
        ruleId: 'r1',
        verdict: 'deny',
        timestamp: new Date(2024, 0, 1, 3, i).getTime(),
      });
    }

    // 5 events at hour 14, all allowed — gives global denial rate = 0.5
    for (let i = 0; i < 5; i++) {
      engine.recordEvent({
        id: `e${i + 5}`,
        agentId: 'a1',
        ruleId: 'r1',
        verdict: 'allow',
        timestamp: new Date(2024, 0, 1, 14, i).getTime(),
      });
    }

    const patterns = engine.analyze(5);
    // Both hours have 5 occurrences meeting the threshold, but only hour 3 is risky
    const riskyPattern = patterns.find((p) => p.cronSchedule === '0 3 * * *');
    expect(riskyPattern).toBeDefined();
    expect(riskyPattern?.isRisk).toBe(true); // 100% denial at 3am vs 50% global
  });

  it('suggests a temporal rule', () => {
    const engine = new TemporalPatternEngine();

    for (let i = 0; i < 6; i++) {
      engine.recordEvent({
        id: `e${i}`,
        agentId: 'a1',
        ruleId: 'r1',
        verdict: 'deny',
        timestamp: new Date(2024, 0, 1, 3, i).getTime(),
      });
    }

    const patterns = engine.analyze(5);
    const suggestion = engine.suggestTemporalRule(patterns[0]);
    expect(suggestion.suggestedCron).toBe('0 3 * * *');
    expect(suggestion.confidence).toBeGreaterThan(0);
  });

  it('clears state', () => {
    const engine = new TemporalPatternEngine();
    engine.recordEvent({
      id: 'e1',
      agentId: 'a1',
      ruleId: 'r1',
      verdict: 'allow',
      timestamp: Date.now(),
    });
    engine.clear();
    expect(engine.getPatterns()).toHaveLength(0);
  });
});
