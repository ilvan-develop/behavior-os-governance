import { describe, expect, it } from 'vitest';
import { AnomalyDetectionEngine } from '../src/engine/anomaly-detection-engine.js';

describe('AnomalyDetectionEngine (G-009)', () => {
  function baseline() {
    return {
      actionRate: 0.5,
      denialRate: 0.1,
      escalationRate: 0.05,
      toolDiversity: 10,
      offHoursRatio: 0.1,
    };
  }

  it('returns zero deviation when no baseline exists', () => {
    const engine = new AnomalyDetectionEngine();
    const score = engine.scoreAnomaly('agent-1', baseline());
    expect(score).not.toBeNull();
    expect(score?.deviation).toBe(0);
    expect(score?.explanation).toContain('No baseline');
  });

  it('records behavior snapshots into the sliding window', () => {
    const engine = new AnomalyDetectionEngine();
    engine.recordBehavior('agent-1', baseline());
    engine.recordBehavior('agent-1', { ...baseline(), actionRate: 0.6 });
    expect(engine.getBaseline('agent-1')).toHaveLength(2);
  });

  it('caps the sliding window at 5 entries', () => {
    const engine = new AnomalyDetectionEngine();
    for (let i = 0; i < 10; i++) {
      engine.recordBehavior('agent-1', { ...baseline(), actionRate: i / 10 });
    }
    expect(engine.getBaseline('agent-1')).toHaveLength(5);
  });

  it('detects a high-deviation anomaly', () => {
    const engine = new AnomalyDetectionEngine();
    // Build a stable baseline with normal behavior
    for (let i = 0; i < 5; i++) {
      engine.recordBehavior('agent-1', baseline());
    }
    // Now observe an anomalous behavior: high denial rate, many off-hours actions
    const anomalous = {
      actionRate: 0.9,
      denialRate: 0.8,
      escalationRate: 0.5,
      toolDiversity: 20,
      offHoursRatio: 0.9,
    };
    const score = engine.scoreAnomaly('agent-1', anomalous);
    expect(score).not.toBeNull();
    expect(score?.deviation).toBeGreaterThan(0.3);
    expect(engine.isAnomalous('agent-1', anomalous)).toBe(true);
  });

  it('reports normal behavior when the observation matches the baseline', () => {
    const engine = new AnomalyDetectionEngine();
    for (let i = 0; i < 5; i++) {
      engine.recordBehavior('agent-2', baseline());
    }
    const normal = baseline();
    const score = engine.scoreAnomaly('agent-2', normal);
    expect(score?.deviation).toBeLessThan(0.05);
    expect(engine.isAnomalous('agent-2', normal)).toBe(false);
  });

  it('clears all baselines', () => {
    const engine = new AnomalyDetectionEngine();
    engine.recordBehavior('agent-1', baseline());
    engine.clear();
    expect(engine.getBaseline('agent-1')).toHaveLength(0);
  });
});
