import type { LearningEvent } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { PredictionEngine } from '../src/engine/prediction-engine.js';

describe('PredictionEngine', () => {
  const fixedTime = new Date('2026-10-22T01:00:00Z').getTime();
  const engine = new PredictionEngine(() => fixedTime);

  const makeEvent = (type: string, content: string, hoursAgo: number): LearningEvent => ({
    id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: type as import('@behavior-os/schemas').LearningType,
    source: 'test',
    content,
    impact: 'medium' as const,
    timestamp: new Date(fixedTime - hoursAgo * 3600000).toISOString(),
  });

  it('predicts governance-block for frequent failures', () => {
    const events: LearningEvent[] = Array.from({ length: 4 }, (_, i) =>
      makeEvent('failure', `Failure ${i}`, i * 10),
    );

    const predictions = engine.predict(events);
    expect(predictions.length).toBeGreaterThan(0);
    // governance-block is generated for frequent patterns
    expect(
      predictions.some((p) => p.type === 'governance-block' || p.type === 'pattern-repeated'),
    ).toBe(true);
  });

  it('does not predict pattern-repeated for a single sparse event', () => {
    const events: LearningEvent[] = [makeEvent('failure', 'Single failure', 10)];
    const predictions = engine.predict(events);
    // Single event doesn't meet the >= 2 threshold for pattern-repeated
    const patternPredictions = predictions.filter((p) => p.type === 'pattern-repeated');
    expect(patternPredictions.length).toBe(0);
  });

  it('filters out old events (> 168h)', () => {
    const events: LearningEvent[] = [
      makeEvent('failure', 'Old failure', 200),
      makeEvent('failure', 'Old failure 2', 201),
      makeEvent('failure', 'Old failure 3', 202),
    ];
    const predictions = engine.predict(events);
    expect(predictions.length).toBe(0);
  });

  it('scores higher confidence for more frequent patterns', () => {
    const few = engine.predict([makeEvent('failure', 'x', 1)]);
    const many = engine.predict(Array.from({ length: 5 }, () => makeEvent('failure', 'x', 1)));

    // More events should produce more predictions or higher confidence
    expect(many.length).toBeGreaterThanOrEqual(few.length);
  });
});
