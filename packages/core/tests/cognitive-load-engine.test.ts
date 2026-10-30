import { describe, expect, it } from 'vitest';
import { CognitiveLoadBalancerEngine } from '../src/engine/cognitive-load-engine.js';

describe('CognitiveLoadBalancerEngine', () => {
  it('registers and tracks agents', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 0.8, skills: ['code', 'test'] });
    engine.registerAgent('agent-2', { maxCapacity: 0.9, skills: ['audit', 'security'] });

    expect(engine.getAgentLoad('agent-1')).toBe(0);
    expect(engine.getAgentLoad('agent-2')).toBe(0);
  });

  it('assigns tasks and tracks load', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0, skills: ['code'] });

    engine.assignTask('agent-1', 'task-1');
    engine.assignTask('agent-1', 'task-2');

    expect(engine.getAgentLoad('agent-1')).toBe(0.2);
  });

  it('completes tasks and reduces load', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0 });

    engine.assignTask('agent-1', 'task-1');
    engine.completeTask('agent-1', 'task-1');

    expect(engine.getAgentLoad('agent-1')).toBe(0);
    expect(engine.getAgentLoad('agent-1')).toBeCloseTo(0, 1);
  });

  it('detects overloaded agents', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0 });

    for (let i = 0; i < 6; i++) {
      engine.assignTask('agent-1', `task-${i}`);
    }

    expect(engine.isAgentOverloaded('agent-1', 0.5)).toBe(true);
  });

  it('analyzes workload and generates recommendations', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0, skills: ['code'], completionRate: 0.9 });
    engine.registerAgent('agent-2', { maxCapacity: 1.0, skills: ['test'], completionRate: 0.5 });

    // Load agent-1 heavily
    for (let i = 0; i < 8; i++) {
      engine.assignTask('agent-1', `task-${i}`);
    }

    const summary = engine.analyzeWorkload();
    expect(summary.totalAgents).toBe(2);
    expect(summary.overloadedAgents).toBeGreaterThan(0);
    expect(summary.recommendations.length).toBeGreaterThan(0);
    expect(summary.recommendations.some((r) => r.type === 'rebalance')).toBe(true);
  });

  it('recommends assignment for underutilized agents', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0, skills: ['code'] });
    engine.registerAgent('agent-2', { maxCapacity: 1.0, skills: [] });

    const summary = engine.analyzeWorkload({ minLoadThreshold: 0.3 });
    const assignRecommendations = summary.recommendations.filter((r) => r.type === 'assign');
    expect(assignRecommendations.length).toBeGreaterThan(0);
  });

  it('recommends task assignment based on skills', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0, skills: ['security', 'audit'] });
    engine.registerAgent('agent-2', { maxCapacity: 1.0, skills: ['frontend'] });

    const result = engine.recommendAssignment('task-1', ['security']);
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-1');
  });

  it('tracks fatigue over time', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0 });

    // Simulate work to build fatigue
    for (let i = 0; i < 5; i++) {
      engine.assignTask('agent-1', `task-${i}`);
    }

    const summary = engine.analyzeWorkload({ maxLoadThreshold: 0.4, considerFatigue: true });
    expect(summary.recommendations.some((r) => r.type === 'rebalance')).toBe(true);
  });

  it('returns metrics for monitoring', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0 });
    engine.registerAgent('agent-2', { maxCapacity: 1.0 });

    engine.assignTask('agent-1', 'task-1');

    const metrics = engine.getMetrics();
    expect(metrics.totalAgents).toBe(2);
    expect(metrics.averageLoad).toBeGreaterThan(0);
    expect(metrics.overloadedCount).toBe(0);
  });

  it('resets all state', () => {
    const engine = new CognitiveLoadBalancerEngine();
    engine.registerAgent('agent-1', { maxCapacity: 1.0 });
    engine.assignTask('agent-1', 'task-1');

    engine.reset();
    expect(engine.getAgentLoad('agent-1')).toBe(0);
    const metrics = engine.getMetrics();
    expect(metrics.totalAgents).toBe(0);
  });
});
