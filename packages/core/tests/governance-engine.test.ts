import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { GovernanceEngine } from '../src/engine/governance-engine.js';

describe('GovernanceEngine', () => {
  const createMockDNA = (rules: unknown[]): DNA => ({
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: rules as DNA['governance'],
    quality: [],
  });

  it('should allow action when no rules match', () => {
    const engine = new GovernanceEngine(createMockDNA([]));
    const result = engine.evaluate({
      action: 'read-file',
      agentId: 'agent-1',
      context: {},
    });
    expect(result.verdict).toBe('allow');
    expect(result.reason).toBeTruthy();
  });

  it('should block when rule matches with block action', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'block-rule',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'production', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'deploy',
      agentId: 'agent-1',
      context: { production: true },
    });

    expect(result.verdict).toBe('deny');
    expect(result.rulesEvaluated).toContain('block-rule');
  });

  it('should escalate when rule matches with escalate action', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'escalate-rule',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'critical', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'critical-op',
      agentId: 'agent-1',
      context: { critical: true },
    });

    expect(result.verdict).toBe('escalate');
  });

  it('should warn when rule matches with warn action', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'warn-rule',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'warning', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { warning: true },
    });

    expect(result.verdict).toBe('allow'); // warn doesn't block
    expect(result.reason).toContain('warn-rule');
  });

  it('should log when rule matches with log action', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'log-rule',
          level: 'low',
          action: 'log',
          conditions: [{ type: 'log-me', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { 'log-me': true },
    });

    expect(result.verdict).toBe('allow');
  });

  it('should evaluate multiple rules and use highest severity', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'block-rule',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'critical-action', value: true }],
        },
        {
          id: 'warn-rule',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'warning', value: true }],
        },
      ]),
    );

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { 'critical-action': true, warning: true },
    });

    expect(result.verdict).toBe('deny');
    expect(result.rulesEvaluated).toHaveLength(2);
  });

  it('should include missionId in decision when provided', () => {
    const engine = new GovernanceEngine(createMockDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: {},
      missionId: 'mission-123',
    });

    expect(result.missionId).toBe('mission-123');
  });

  it('should have all required decision fields', () => {
    const engine = new GovernanceEngine(createMockDNA([]));
    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: {},
    });

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('rulesEvaluated');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('agentId');
  });

  it('should add rules dynamically', () => {
    const engine = new GovernanceEngine(createMockDNA([]));

    engine.addRule({
      id: 'new-rule',
      level: 'high',
      action: 'block',
      conditions: [{ type: 'test', value: true }],
    });

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { test: true },
    });

    expect(result.verdict).toBe('deny');
  });

  it('should remove rules dynamically', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        {
          id: 'remove-me',
          level: 'high',
          action: 'block',
          conditions: [{ type: 'test', value: true }],
        },
      ]),
    );

    engine.removeRule('remove-me');

    const result = engine.evaluate({
      action: 'test',
      agentId: 'agent-1',
      context: { test: true },
    });

    expect(result.verdict).toBe('allow');
  });

  it('should return all rules via getRules', () => {
    const engine = new GovernanceEngine(
      createMockDNA([
        { id: 'rule-1', level: 'high', action: 'block', conditions: [] },
        { id: 'rule-2', level: 'low', action: 'log', conditions: [] },
      ]),
    );

    const rules = engine.getRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe('rule-1');
  });
});
