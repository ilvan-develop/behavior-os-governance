import { describe, expect, it } from 'vitest';
import { LearningEngine } from '../src/engine/learning-engine.js';

describe('LearningEngine Edge Cases', () => {
  it('should handle very long content', () => {
    const engine = new LearningEngine();
    const longContent = 'x'.repeat(100000);

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: longContent,
      impact: 'medium',
    });

    expect(event.content).toBe(longContent);
  });

  it('should handle Unicode in content', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: '测试',
      content: '中文内容',
      impact: 'high',
    });

    expect(event.source).toBe('测试');
    expect(event.content).toBe('中文内容');
  });

  it('should handle empty content', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: '',
      impact: 'low',
    });

    expect(event.content).toBe('');
  });

  it('should handle whitespace content', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: '   ',
      impact: 'low',
    });

    expect(event.content).toBe('   ');
  });

  it('should handle very long source names', () => {
    const engine = new LearningEngine();
    const longSource = 's'.repeat(1000);

    const event = engine.record({
      type: 'insight',
      source: longSource,
      content: 'Test',
      impact: 'medium',
    });

    expect(event.source).toBe(longSource);
  });

  it('should handle all impact levels', () => {
    const engine = new LearningEngine();
    const impacts: Array<'low' | 'medium' | 'high' | 'critical'> = [
      'low',
      'medium',
      'high',
      'critical',
    ];

    for (const impact of impacts) {
      const event = engine.record({
        type: 'insight',
        source: 'test',
        content: `${impact} impact`,
        impact,
      });
      expect(event.impact).toBe(impact);
    }
  });

  it('should handle newlines in content', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Line 1\nLine 2\nLine 3',
      impact: 'medium',
    });

    expect(event.content).toContain('\n');
  });

  it('should handle special characters', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Special: @#$%^&*()_+-=[]{}|;\':",./<>?',
      impact: 'medium',
    });

    expect(event.content).toContain('@#$%^&*()');
  });

  it('should handle null content', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: null as any,
      impact: 'medium',
    });

    expect(event).toBeDefined();
  });

  it('should detect pattern with many similar events', () => {
    const engine = new LearningEngine();

    // Record 10 similar failure events
    for (let i = 0; i < 10; i++) {
      engine.record({
        type: 'failure',
        source: 'deploy',
        content: 'Deployment failed with error',
        impact: 'high',
      });
    }

    const patterns = engine.detectPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].type).toBe('failure');
  });

  it('should handle single event pattern detection', () => {
    const engine = new LearningEngine();

    engine.record({
      type: 'insight',
      source: 'test',
      content: 'Single insight',
      impact: 'medium',
    });

    const patterns = engine.detectPatterns();
    // Single event should not trigger pattern
    expect(patterns.length).toBe(0);
  });

  it('should handle mix of event types', () => {
    const engine = new LearningEngine();

    engine.record({ type: 'insight', source: 's1', content: 'i1', impact: 'high' });
    engine.record({ type: 'failure', source: 's2', content: 'f1', impact: 'high' });
    engine.record({ type: 'pattern', source: 's3', content: 'p1', impact: 'medium' });
    engine.record({ type: 'fix', source: 's4', content: 'fx1', impact: 'low' });

    const events = engine.getEvents();
    expect(events).toHaveLength(4);
  });

  it('should handle very old timestamps', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Historical insight',
      impact: 'medium',
    });

    // Manually modify timestamp to be very old
    event.timestamp = '1970-01-01T00:00:00.000Z';

    expect(event).toBeDefined();
  });

  it('should handle future timestamps', () => {
    const engine = new LearningEngine();

    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Future insight',
      impact: 'medium',
    });

    event.timestamp = '2099-12-31T23:59:59.999Z';
    expect(event).toBeDefined();
  });
});
