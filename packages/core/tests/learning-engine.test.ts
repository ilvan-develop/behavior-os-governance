import type { LearningEvent } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { LearningEngine } from '../src/engine/learning-engine.js';

describe('LearningEngine', () => {
  let engine: LearningEngine;

  beforeEach(() => {
    engine = new LearningEngine();
  });

  it('should record learning events', () => {
    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'high',
    });

    expect(event.id).toBeDefined();
    expect(event.type).toBe('insight');
    expect(event.content).toBe('Test insight');
    expect(event.timestamp).toBeDefined();
  });

  it('should detect patterns after multiple events', () => {
    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed',
      impact: 'high',
    });

    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed again',
      impact: 'high',
    });

    const patterns = engine.detectPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns[0].type).toBe('failure');
    expect(patterns[0].count).toBe(2);
  });

  it('should not detect pattern with single event', () => {
    engine.record({
      type: 'insight',
      source: 'test',
      content: 'Single insight',
      impact: 'medium',
    });

    const patterns = engine.detectPatterns();
    expect(patterns.length).toBe(0);
  });

  it('should get high-impact insights', () => {
    engine.record({
      type: 'insight',
      source: 'test',
      content: 'High impact insight',
      impact: 'high',
    });

    engine.record({
      type: 'insight',
      source: 'test',
      content: 'Low impact insight',
      impact: 'low',
    });

    const insights = engine.getInsights(10);
    expect(insights.length).toBe(1);
    expect(insights[0].content).toBe('High impact insight');
  });

  it('should get all events', () => {
    engine.record({
      type: 'insight',
      source: 'test',
      content: 'Event 1',
      impact: 'medium',
    });

    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Event 2',
      impact: 'high',
    });

    const events = engine.getEvents();
    expect(events).toHaveLength(2);
  });

  it('should generate recommendations', () => {
    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed',
      impact: 'high',
    });

    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed again',
      impact: 'high',
    });

    engine.detectPatterns();
    const patterns = engine.getPatterns();
    expect(patterns[0].recommendation).toBeDefined();
  });

  it('should limit insights', () => {
    for (let i = 0; i < 15; i++) {
      engine.record({
        type: 'insight',
        source: 'test',
        content: `Insight ${i}`,
        impact: 'high',
      });
    }

    const insights = engine.getInsights(10);
    expect(insights.length).toBeLessThanOrEqual(10);
  });
});
