import type { GovernanceDecision } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { MetaCognitionEngine } from '../src/engine/metacognition-engine.js';

function makeDecision(overrides: Partial<GovernanceDecision> = {}): GovernanceDecision {
  return {
    id: 'decision-test',
    verdict: 'allow',
    action: 'test-action',
    agentId: 'agent-1',
    rulesEvaluated: ['rule-1', 'rule-2'],
    firedRules: [],
    warnings: [],
    reason: 'No rules to fire',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('MetaCognitionEngine (G-002)', () => {
  let engine: MetaCognitionEngine;

  beforeEach(() => {
    engine = new MetaCognitionEngine();
  });

  describe('createMetaDecision', () => {
    it('should create a meta-decision with reasoning path', () => {
      const decision = makeDecision({
        verdict: 'deny',
        firedRules: ['critical-rule'],
        reason: 'Blocked by critical rule',
      });
      const meta = engine.createMetaDecision(decision, {
        agentId: 'agent-1',
        dnaPattern: 'lean-factory',
      });

      expect(meta).toBeDefined();
      expect(meta.decision).toEqual(decision);
      expect(meta.reasoningPath).toHaveLength(4);
      expect(meta.agentId).toBe('agent-1');
      expect(meta.dnaPattern).toBe('lean-factory');
      expect(meta.createdAt).toBeDefined();
    });

    it('should compute confidence between 0 and 1', () => {
      const decision = makeDecision();
      const meta = engine.createMetaDecision(decision, { agentId: 'agent-1' });
      expect(meta.confidence).toBeGreaterThanOrEqual(0);
      expect(meta.confidence).toBeLessThanOrEqual(1);
    });

    it('should detect biases for deny decisions with full rule firing', () => {
      const decision = makeDecision({
        verdict: 'deny',
        firedRules: ['critical-rule-1'],
        rulesEvaluated: ['critical-rule-1'],
        reason: 'Rule violation',
      });
      const meta = engine.createMetaDecision(decision, { agentId: 'agent-1' });
      expect(meta.biasDetection.length).toBeGreaterThan(0);
      expect(meta.selfCritique).toContain('Critique');
    });

    it('should detect recency bias for shallow reasoning', () => {
      const decision = makeDecision();
      const meta = engine.createMetaDecision(decision, { agentId: 'agent-1' });
      const hasRecencyBias = meta.biasDetection.some((b) => b.type === 'recency-bias');
      expect(hasRecencyBias).toBe(true);
    });

    it('should include alternatives in verdict step', () => {
      const decision = makeDecision({ verdict: 'deny', firedRules: ['rule-1'], reason: 'Blocked' });
      const meta = engine.createMetaDecision(decision, { agentId: 'agent-1' });
      const lastStep = meta.reasoningPath[meta.reasoningPath.length - 1];
      expect(lastStep.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDecision', () => {
    it('should retrieve a stored meta-decision by ID', () => {
      const decision = makeDecision({ id: 'test-decision-1' });
      engine.createMetaDecision(decision, { agentId: 'agent-1' });
      const meta = engine.getMetaDecision(decision.id);
      expect(meta).toBeDefined();
    });

    it('should return undefined for non-existent ID', () => {
      expect(engine.getMetaDecision('non-existent')).toBeUndefined();
    });
  });

  describe('getAllMetaDecisions', () => {
    it('should return all stored meta-decisions', () => {
      engine.createMetaDecision(makeDecision({ id: 'd1' }), { agentId: 'a1' });
      engine.createMetaDecision(makeDecision({ id: 'd2' }), { agentId: 'a2' });
      expect(engine.getAllMetaDecisions()).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      engine.createMetaDecision(makeDecision({ id: 'd1', verdict: 'allow' }), { agentId: 'a1' });
      engine.createMetaDecision(
        makeDecision({ id: 'd2', verdict: 'deny', firedRules: ['r1'], rulesEvaluated: ['r1'] }),
        { agentId: 'a2' },
      );
      const stats = engine.getStats();
      expect(stats.totalMetaDecisions).toBe(2);
      expect(stats.decisionsByVerdict.allow).toBe(1);
      expect(stats.decisionsByVerdict.deny).toBe(1);
    });

    it('should compute average confidence', () => {
      engine.createMetaDecision(makeDecision({ id: 'd1' }), { agentId: 'a1' });
      const stats = engine.getStats();
      expect(stats.avgConfidence).toBeGreaterThan(0);
      expect(stats.avgConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('clear', () => {
    it('should clear all stored meta-decisions', () => {
      engine.createMetaDecision(makeDecision({ id: 'd1' }), { agentId: 'a1' });
      expect(engine.getAllMetaDecisions()).toHaveLength(1);
      engine.clear();
      expect(engine.getAllMetaDecisions()).toHaveLength(0);
    });
  });
});
