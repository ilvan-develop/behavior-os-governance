import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { TemporalGovernanceEngine } from '../src/engine/temporal-governance-engine.js';

function makeDNA(): DNA {
  return {
    name: 'test-dna',
    version: '1.0.0',
    description: 'Test DNA',
    personas: [],
    governance: [
      {
        id: 'no-prod-deploy',
        level: 'high',
        action: 'block',
        conditions: [{ type: 'context', value: 'production' }],
        description: 'Block production deploys',
      },
    ],
    quality: [],
  };
}

const fixedNow = new Date('2026-10-26T14:00:00Z'); // 2 PM UTC, Monday

describe('TemporalGovernanceEngine', () => {
  describe('absolute time windows', () => {
    it('activates a rule within its window', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Escalate during maintenance window',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T16:00:00Z',
        reason: 'Maintenance window override',
        authorizedBy: 'maintenance-bot',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      expect(result.isActive).toBe(true);
      expect(result.rule?.action).toBe('escalate');
    });

    it('deactivates a rule before its window', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Escalate during maintenance window',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T18:00:00Z',
        endTime: '2026-10-26T20:00:00Z',
        reason: 'Late window',
        authorizedBy: 'bot',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      expect(result.isActive).toBe(false);
      expect(result.inactiveReason).toContain('Before start time');
    });

    it('deactivates a rule after its window', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Escalate during maintenance window',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T10:00:00Z',
        endTime: '2026-10-26T12:00:00Z',
        reason: 'Morning window',
        authorizedBy: 'bot',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      expect(result.isActive).toBe(false);
      expect(result.inactiveReason).toContain('Past end time');
    });

    it('supports open-ended windows (no end time)', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Ongoing escalation',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T00:00:00Z',
        reason: 'Ongoing rule',
        authorizedBy: 'bot',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      expect(result.isActive).toBe(true);
    });
  });

  describe('recurring schedules (cron)', () => {
    it('activates on weekends (cron: Sunday/Monday)', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      // 2026-10-26 is a Monday, dayOfWeek=1
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'weekend-block',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'env', value: 'prod' }],
          description: 'Block deploys on weekends',
        },
        scheduleType: 'cron',
        schedule: '0 0 * * 0,6', // midnight on Saturday (6) and Sunday (0)
        reason: 'Weekend protection',
        authorizedBy: 'security-audit',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      // Monday at 14:00 UTC — not a weekend
      expect(result.isActive).toBe(false);
    });

    it('activates during business hours (cron)', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      // 2 PM Monday UTC
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'biz-hours-warn',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'env', value: 'prod' }],
          description: 'Warn during business hours',
        },
        scheduleType: 'cron',
        schedule: '0 9-17 * * 1-5', // 9 AM - 5 PM Mon-Fri
        reason: 'Business hours enforcement',
        authorizedBy: 'ops',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      // 14:00 (2 PM) is within 9-17
      expect(result.isActive).toBe(true);
    });

    it('predicts next active time for inactive cron rules', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'biz-hours-warn',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'env', value: 'prod' }],
          description: 'Warn during business hours',
        },
        scheduleType: 'cron',
        schedule: '0 9 * * 1', // 9 AM every Monday
        reason: 'Monday morning check',
        authorizedBy: 'ops',
      });

      const result = engine.isRuleActive(engine.getTemporalRules()[0]);
      expect(result.isActive).toBe(false);
      expect(result.nextActiveAt).toBeDefined();
      const nextActive = result.nextActiveAt ?? '';
      expect(new Date(nextActive).getTime()).toBeGreaterThan(fixedNow.getTime());
    });
  });

  describe('evaluate against context', () => {
    it('returns active rules for current context', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'weekend-block',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'env', value: 'prod' }],
          description: 'Weekend block',
        },
        scheduleType: 'cron',
        schedule: '0 0 * * 0,6',
        reason: 'Weekend protection',
        authorizedBy: 'security',
      });

      const result = engine.evaluate({
        action: 'deploy',
        agentId: 'agent-1',
        context: { env: 'prod' },
      });

      expect(result.activeRules.length).toBe(0);
      expect(result.inactiveRules.length).toBe(1);
    });

    it('generates recommendations from active rules', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'biz-hours-block',
          level: 'high',
          action: 'block',
          conditions: [{ type: 'env', value: 'prod' }],
          description: 'Block during business hours',
        },
        scheduleType: 'cron',
        schedule: '0 9-17 * * 1-5', // 9 AM - 5 PM Mon-Fri
        reason: 'Business hours block',
        authorizedBy: 'ops',
      });

      const result = engine.evaluate({
        action: 'deploy',
        agentId: 'agent-1',
        context: { env: 'prod' },
      });

      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].action).toBe('block');
      expect(result.recommendations[0].ruleId).toBe('biz-hours-block');
    });
  });

  describe('DNA evaluation', () => {
    it('overrides DNA rules with active temporal rules', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const dna = makeDNA();

      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'critical',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Escalate instead of block during window',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T00:00:00Z',
        endTime: '2026-10-27T00:00:00Z',
        reason: 'Deployment window',
        authorizedBy: 'ops',
      });

      const { effectiveRules, temporalOverrides } = engine.evaluateDNA(dna, {
        action: 'deploy',
        agentId: 'agent-1',
        context: {},
      });

      expect(temporalOverrides.length).toBe(1);
      const overridden = effectiveRules.find((r) => r.id === 'no-prod-deploy');
      expect(overridden?.action).toBe('escalate'); // was 'block', now 'escalate'
    });

    it('keeps static rules when no temporal rules are active', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const dna = makeDNA();

      // Rule active in the future
      engine.addTemporalRule({
        baseRuleId: 'no-prod-deploy',
        rule: {
          id: 'no-prod-deploy-temporal',
          level: 'critical',
          action: 'escalate',
          conditions: [{ type: 'context', value: 'production' }],
          description: 'Future override',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-27T00:00:00Z',
        endTime: '2026-10-28T00:00:00Z',
        reason: 'Tomorrow',
        authorizedBy: 'ops',
      });

      const { effectiveRules, temporalOverrides } = engine.evaluateDNA(dna, {
        action: 'deploy',
        agentId: 'agent-1',
        context: {},
      });

      expect(temporalOverrides.length).toBe(0);
      const staticRule = effectiveRules.find((r) => r.id === 'no-prod-deploy');
      expect(staticRule?.action).toBe('block'); // unchanged
    });
  });

  describe('validation', () => {
    it('rejects rules without baseRuleId', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const result = engine.addTemporalRule({
        baseRuleId: '',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        reason: 'test',
        authorizedBy: 'bot',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects absolute rules without any time boundary', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const result = engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        reason: 'test',
        authorizedBy: 'bot',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects cron rules without a schedule', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const result = engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'cron',
        reason: 'test',
        authorizedBy: 'bot',
      });
      expect(result.ok).toBe(false);
    });

    it('rejects invalid ISO timestamps', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      const result = engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        startTime: 'not-a-date',
        reason: 'test',
        authorizedBy: 'bot',
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('management operations', () => {
    it('removes temporal rules by id', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T14:00:00Z',
        reason: 'test',
        authorizedBy: 'bot',
      });

      expect(engine.getTemporalRules().length).toBe(1);
      engine.removeTemporalRule(engine.getTemporalRules()[0].id);
      expect(engine.getTemporalRules().length).toBe(0);
    });

    it('clears all temporal rules', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: { id: 'r1', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T14:00:00Z',
        reason: 'test',
        authorizedBy: 'bot',
      });
      engine.addTemporalRule({
        baseRuleId: 'rule-2',
        rule: { id: 'r2', level: 'high', action: 'block', conditions: [], description: '' },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T14:00:00Z',
        reason: 'test2',
        authorizedBy: 'bot',
      });

      expect(engine.getTemporalRules().length).toBe(2);
      engine.clear();
      expect(engine.getTemporalRules().length).toBe(0);
    });

    it('updates existing temporal rule for same baseRuleId', () => {
      const engine = new TemporalGovernanceEngine(() => fixedNow);
      engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: {
          id: 'r1-override',
          level: 'high',
          action: 'block',
          conditions: [],
          description: 'original',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T14:00:00Z',
        reason: 'original',
        authorizedBy: 'bot',
      });
      engine.addTemporalRule({
        baseRuleId: 'rule-1',
        rule: {
          id: 'r1-override',
          level: 'high',
          action: 'escalate',
          conditions: [],
          description: 'updated',
        },
        scheduleType: 'absolute',
        startTime: '2026-10-26T12:00:00Z',
        endTime: '2026-10-26T14:00:00Z',
        reason: 'updated',
        authorizedBy: 'admin',
      });

      expect(engine.getTemporalRules().length).toBe(1);
      expect(engine.getTemporalRules()[0].rule.action).toBe('escalate');
      expect(engine.getTemporalRules()[0].rule.description).toBe('updated');
    });
  });
});
