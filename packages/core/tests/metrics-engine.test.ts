import { describe, expect, it } from 'vitest';
import { MetricsEngine } from '../src/engine/metrics-engine.js';

describe('MetricsEngine', () => {
  it('starts with zero metrics', () => {
    const engine = new MetricsEngine();
    const metrics = engine.metrics;

    expect(metrics.governance.totalActions).toBe(0);
    expect(metrics.governance.allowed).toBe(0);
    expect(metrics.governance.denied).toBe(0);
    expect(metrics.consensus.totalRounds).toBe(0);
    expect(metrics.prediction.totalPredictions).toBe(0);
    expect(metrics.crossDna.totalSuggestions).toBe(0);
    expect(metrics.learningEventsTotal).toBe(0);
  });

  it('records governance evaluations', () => {
    const engine = new MetricsEngine();

    engine.recordGovernance('allow', 3, 10);
    engine.recordGovernance('deny', 5, 15);
    engine.recordGovernance('escalate', 4, 12);
    engine.recordGovernance('warn', 2, 8);

    const metrics = engine.metrics;
    expect(metrics.governance.totalActions).toBe(4);
    expect(metrics.governance.allowed).toBe(1);
    expect(metrics.governance.denied).toBe(1);
    expect(metrics.governance.escalated).toBe(1);
    expect(metrics.governance.warned).toBe(1);
    expect(metrics.governance.avgRulesPerAction).toBe(3.5);
  });

  it('tracks latency samples', () => {
    const engine = new MetricsEngine();

    engine.recordGovernance('allow', 2, 100);
    engine.recordGovernance('allow', 2, 200);
    engine.recordGovernance('allow', 2, 300);

    expect(engine.getAvgLatencyMs()).toBe(200);
    expect(engine.getP95LatencyMs()).toBe(300);
  });

  it('keeps only last 100 latency samples', () => {
    const engine = new MetricsEngine();

    for (let i = 0; i < 150; i++) {
      engine.recordGovernance('allow', 1, i);
    }

    const metrics = engine.metrics;
    expect(metrics.governance.latencySamples.length).toBe(100);
    // Should contain the last 100 samples (50-149)
    expect(metrics.governance.latencySamples[0]).toBe(50);
    expect(metrics.governance.latencySamples[99]).toBe(149);
  });

  it('records consensus rounds', () => {
    const engine = new MetricsEngine();

    engine.recordConsensus('approved', 3, 5);
    engine.recordConsensus('rejected', 2, 3);
    engine.recordConsensus('inconclusive', 1, 1);
    engine.recordConsensus('approved', 4, 6);

    const metrics = engine.metrics;
    expect(metrics.consensus.totalRounds).toBe(4);
    expect(metrics.consensus.approved).toBe(2);
    expect(metrics.consensus.rejected).toBe(1);
    expect(metrics.consensus.inconclusive).toBe(1);
    expect(metrics.consensus.avgVoteCount).toBe(2.5);
    expect(metrics.consensus.avgParticipatingWeight).toBe(3.75);
  });

  it('records predictions', () => {
    const engine = new MetricsEngine();

    engine.recordPrediction('governance-block', 0.85);
    engine.recordPrediction('pattern-repeated', 0.72);
    engine.recordPrediction('governance-block', 0.91);

    const metrics = engine.metrics;
    expect(metrics.prediction.totalPredictions).toBe(3);
    expect(metrics.prediction.byType['governance-block']).toBe(2);
    expect(metrics.prediction.byType['pattern-repeated']).toBe(1);
    expect(metrics.prediction.avgConfidence).toBeCloseTo(0.827, 2);
    expect(metrics.prediction.highConfidenceCount).toBe(2);
  });

  it('records cross-DNA suggestions', () => {
    const engine = new MetricsEngine();

    engine.recordCrossDnaSuggestion('surgical-team', 'open-source');
    engine.recordCrossDnaSuggestion('surgical-team', 'devops-pipeline');
    engine.recordCrossDnaSuggestion('lean-factory', 'open-source');

    const metrics = engine.metrics;
    expect(metrics.crossDna.totalSuggestions).toBe(3);
    expect(metrics.crossDna.bySource['surgical-team']).toBe(2);
    expect(metrics.crossDna.bySource['lean-factory']).toBe(1);
    expect(metrics.crossDna.byTarget['open-source']).toBe(2);
    expect(metrics.crossDna.byTarget['devops-pipeline']).toBe(1);
  });

  it('records learning events by type', () => {
    const engine = new MetricsEngine();

    engine.recordLearningEvent('failure');
    engine.recordLearningEvent('fix');
    engine.recordLearningEvent('failure');
    engine.recordLearningEvent('insight');

    const metrics = engine.metrics;
    expect(metrics.learningEventsTotal).toBe(4);
    expect(metrics.learningEventsByType.failure).toBe(2);
    expect(metrics.learningEventsByType.fix).toBe(1);
    expect(metrics.learningEventsByType.insight).toBe(1);
  });

  it('tracks which rules actually fired and ranks them', () => {
    const engine = new MetricsEngine();

    engine.recordGovernance('warn', 2, 5, [
      { id: 'r-warn', action: 'warn' },
      { id: 'r-warn', action: 'warn' },
    ]);
    engine.recordGovernance('deny', 2, 5, [{ id: 'r-block', action: 'block' }]);

    expect(engine.getTopRules(5)).toEqual([
      { id: 'r-warn', count: 2, action: 'warn' },
      { id: 'r-block', count: 1, action: 'block' },
    ]);
    // Snapshot plumbing: topRules must reach the public metrics object.
    expect(engine.metrics.governance.topRules[0]).toEqual({
      id: 'r-warn',
      count: 2,
      action: 'warn',
    });
  });

  it('reset clears fired-rule counts', () => {
    const engine = new MetricsEngine();
    engine.recordGovernance('deny', 1, 5, [{ id: 'r-block', action: 'block' }]);
    engine.reset();
    expect(engine.getTopRules()).toEqual([]);
  });

  it('reset clears all metrics', () => {
    const engine = new MetricsEngine();

    engine.recordGovernance('allow', 3, 10);
    engine.recordConsensus('approved', 3, 5);
    engine.recordPrediction('governance-block', 0.85);
    engine.recordLearningEvent('failure');

    engine.reset();

    const metrics = engine.metrics;
    expect(metrics.governance.totalActions).toBe(0);
    expect(metrics.consensus.totalRounds).toBe(0);
    expect(metrics.prediction.totalPredictions).toBe(0);
    expect(metrics.learningEventsTotal).toBe(0);
  });

  it('computes uptime', () => {
    const engine = new MetricsEngine();
    const initialUptime = engine.metrics.uptimeMs;

    // Uptime should be at least 0
    expect(initialUptime).toBeGreaterThanOrEqual(0);
  });
});
