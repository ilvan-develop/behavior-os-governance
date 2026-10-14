import type { LearningEvent } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { LearningEngine } from '../src/engine/learning-engine.js';
import { RecommendationEngine } from '../src/engine/recommendation-engine.js';
import { BehaviorOS } from '../src/index.js';

describe('RecommendationEngine', () => {
  const engine = new RecommendationEngine();

  it('returns empty recommendations when there are no events', () => {
    expect(engine.recommend([])).toEqual([]);
  });

  it('scores a single critical event high when recent', () => {
    const now = new Date().toISOString();
    const event: LearningEvent = {
      id: 'e1',
      type: 'failure',
      source: 'ci',
      content: 'build failed',
      impact: 'critical' as const,
      timestamp: now,
    };
    const score = engine.scoreEvent(event);
    expect(score).toBeGreaterThanOrEqual(0.7);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores an old critical event lower than a recent one', () => {
    const now = new Date().toISOString();
    const recent: LearningEvent = {
      id: 'r1',
      type: 'failure',
      source: 'ci',
      content: 'recent failure',
      impact: 'critical',
      timestamp: now,
    };
    const oldEvent: LearningEvent = {
      id: 'o1',
      type: 'failure',
      source: 'ci',
      content: 'old failure',
      impact: 'critical',
      timestamp: new Date(Date.now() - 100 * 24 * 3600000).toISOString(),
    };
    const recentScore = engine.scoreEvent(recent);
    const oldScore = engine.scoreEvent(oldEvent);
    // Recency contributes 40%; impact contributes 60%. Even a very old
    // critical event scores 0.6 (0*0.4 + 1*0.6). A recent one scores 1.0.
    expect(recentScore).toBeGreaterThan(oldScore);
    expect(oldScore).toBe(0.6);
    expect(recentScore).toBe(1);
  });

  it('produces ranked recommendations sorted by descending score', () => {
    const engine2 = new RecommendationEngine();
    // High-frequency critical failures
    const failures: LearningEvent[] = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`,
      type: 'failure',
      source: 'ci',
      content: `build failed ${i}`,
      impact: 'critical',
      timestamp: new Date().toISOString(),
    }));
    // Low-frequency low-impact insights
    const insights: LearningEvent[] = Array.from({ length: 1 }, (_, i) => ({
      id: `ins${i}`,
      type: 'insight',
      source: 'code-review',
      content: `good point ${i}`,
      impact: 'low',
      timestamp: new Date().toISOString(),
    }));

    const recs = engine2.recommend([...failures, ...insights], 5);
    expect(recs).toHaveLength(2);
    // Failures should score higher than insights
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
    expect(recs[0].text).toContain('failure');
    expect(recs[0].evidence.length).toBeLessThanOrEqual(3);
  });

  it('respects the limit parameter across different event types', () => {
    // Use 5 different event types so we get 5 recommendations, then limit to 3.
    const types = ['failure', 'fix', 'insight', 'optimization', 'pattern'] as const;
    const events: LearningEvent[] = types.map((type, i) => ({
      id: `e${i}`,
      type,
      source: 'ci',
      content: `event ${i}`,
      impact: 'high',
      timestamp: new Date().toISOString(),
    }));
    const recs = engine.recommend(events, 3);
    expect(recs).toHaveLength(3);
  });

  it('filters out old events beyond ageLimitHours', () => {
    const recent: LearningEvent = {
      id: 'r1',
      type: 'failure',
      source: 'ci',
      content: 'recent failure',
      impact: 'critical',
      timestamp: new Date().toISOString(),
    };
    const oldEvent: LearningEvent = {
      id: 'o1',
      type: 'failure',
      source: 'ci',
      content: 'old failure',
      impact: 'critical',
      timestamp: new Date(Date.now() - 200 * 24 * 3600000).toISOString(),
    };
    const recs = engine.recommend([recent, oldEvent], 5, 168);
    // Only the recent event should contribute
    expect(recs.some((r) => r.evidence.some((e) => e.includes('recent')))).toBe(true);
    expect(recs.some((r) => r.evidence.some((e) => e.includes('old')))).toBe(false);
  });

  it('generates descriptive recommendation text', () => {
    const events: LearningEvent[] = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`,
      type: 'fix',
      source: 'ci',
      content: `fixed bug ${i}`,
      impact: 'high',
      timestamp: new Date().toISOString(),
    }));
    const recs = engine.recommend(events, 5);
    expect(recs[0].text).toContain('fix');
    expect(recs[0].text).toContain('3');
  });
});

describe('RecommendationEngine + LearningEngine integration', () => {
  it('works end-to-end: record events → get recommendations', () => {
    const learning = new LearningEngine();
    const recEngine = new RecommendationEngine();
    for (let i = 0; i < 4; i++) {
      learning.record({
        type: 'failure',
        source: 'ci',
        content: `pipeline failed step ${i}`,
        impact: 'high',
      });
    }
    const recs = recEngine.recommend(learning.getEvents(), 5);
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].text).toBeTruthy();
    expect(recs[0].score).toBeGreaterThan(0);
  });
});

describe('BehaviorOS.recommend (facade wiring)', () => {
  it('uses a real RecommendationEngine over recorded learnings', () => {
    const bos = new BehaviorOS();
    bos.recordLearning({
      type: 'failure',
      source: 'ci',
      content: 'pipeline failed',
      impact: 'critical',
    });

    const recs = bos.recommend();
    expect(recs).toHaveLength(1);
    expect(recs[0].score).toBeGreaterThan(0);
    expect(recs[0].evidence).toContain('pipeline failed');
  });

  it('returns an empty list when there are no events', () => {
    expect(new BehaviorOS().recommend()).toEqual([]);
  });
});
