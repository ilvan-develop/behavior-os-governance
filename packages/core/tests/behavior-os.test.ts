import type { DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

describe('BehaviorOS Core', () => {
  let bos: BehaviorOS;

  beforeEach(() => {
    bos = new BehaviorOS();
  });

  describe('DNA Management', () => {
    it('should load DNA pattern', async () => {
      const dna: DNA = {
        name: 'Test DNA',
        version: '1.0.0',
        description: 'Test description',
        personas: [
          {
            role: 'developer',
            name: 'Test Dev',
            authority: 'developer',
            skills: ['coding'],
          },
        ],
        governance: [
          {
            id: 'test-rule',
            level: 'high',
            action: 'warn',
            conditions: [{ type: 'test', value: true }],
          },
        ],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 80 }],
      };

      await bos.loadDNA(dna);
      expect(bos.getDNA()).toEqual(dna);
    });

    it('should return null when no DNA loaded', () => {
      expect(bos.getDNA()).toBeNull();
    });
  });

  describe('Governance', () => {
    it('should evaluate and allow safe actions', async () => {
      await bos.loadDNA({
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [],
        quality: [],
      });

      const decision = bos.evaluateGovernance('read-file', {
        agent: 'agent-1',
        context: {},
      });

      expect(decision.verdict).toBe('allow');
      expect(decision.agentId).toBe('agent-1');
    });

    it('should evaluate and block dangerous actions', async () => {
      await bos.loadDNA({
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [
          {
            id: 'block-deploy',
            level: 'critical',
            action: 'block',
            conditions: [{ type: 'action', value: 'deploy' }],
          },
        ],
        quality: [],
      });

      const decision = bos.evaluateGovernance('deploy', {
        agent: 'agent-1',
        context: { action: 'deploy' },
      });

      expect(decision.verdict).toBe('deny');
    });

    it('should throw when no DNA loaded', () => {
      expect(() => bos.evaluateGovernance('test', { agent: 'agent-1' })).toThrow();
    });
  });

  describe('Quality Gates', () => {
    it('should pass when metrics meet thresholds', async () => {
      await bos.loadDNA({
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 80 }],
      });

      const result = bos.checkQuality({ test_coverage: 90 });
      expect(result.passed).toBe(true);
    });

    it('should fail when metrics are below threshold', async () => {
      await bos.loadDNA({
        name: 'Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 80 }],
      });

      const result = bos.checkQuality({ test_coverage: 50 });
      expect(result.passed).toBe(false);
    });
  });

  describe('Audit', () => {
    it('should run audit pipeline', () => {
      const report = bos.runAudit({
        missionId: 'mission-1',
        agentId: 'agent-1',
      });

      expect(report.id).toBeDefined();
      expect(report.missionId).toBe('mission-1');
      expect(report.stages.length).toBeGreaterThan(0);
    });
  });

  describe('Missions', () => {
    it('should create a mission', () => {
      const mission = bos.createMission({
        title: 'Test Mission',
        type: 'feature',
        priority: 'high',
      });

      expect(mission.id).toBeDefined();
      expect(mission.title).toBe('Test Mission');
      expect(mission.status).toBe('pending');
    });

    it('should start a mission', () => {
      const mission = bos.createMission({
        title: 'Test Mission',
        type: 'feature',
        priority: 'high',
      });

      const started = bos.startMission(mission.id);
      expect(started?.status).toBe('active');
    });

    it('should return null for non-existent mission', () => {
      // First ensure a mission engine exists
      bos.createMission({
        title: 'Test',
        type: 'feature',
        priority: 'high',
      });
      expect(bos.startMission('non-existent')).toBeNull();
    });
  });

  describe('Learning', () => {
    it('should record learning events', () => {
      const event = bos.recordLearning({
        type: 'insight',
        source: 'test',
        content: 'Test insight',
        impact: 'high',
      });

      expect(event.id).toBeDefined();
      expect(event.content).toBe('Test insight');
    });

    it('should get insights', () => {
      bos.recordLearning({
        type: 'insight',
        source: 'test',
        content: 'Test insight 1',
        impact: 'high',
      });

      bos.recordLearning({
        type: 'failure',
        source: 'test',
        content: 'Test failure',
        impact: 'critical',
      });

      const insights = bos.getInsights(10);
      expect(insights.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Status', () => {
    it('should return system status', () => {
      const status = bos.getStatus();
      expect(status.engine).toBe(true);
      expect(status.dna).toBeNull();
      expect(status.missions).toBe(0);
      expect(status.agents).toBe(0);
    });
  });

  describe('State', () => {
    it('should return initial state', () => {
      const state = bos.getState();
      expect(state.currentStep).toBe(0);
      expect(state.selectedDna).toBeNull();
      expect(state.activeMission).toBeNull();
    });

    it('should update state', () => {
      bos.updateState({ currentStep: 3, selectedDna: 'test' });
      const state = bos.getState();
      expect(state.currentStep).toBe(3);
      expect(state.selectedDna).toBe('test');
    });
  });
});
