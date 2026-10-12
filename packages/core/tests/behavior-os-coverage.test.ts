import type { Agent, DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os';

describe('BehaviorOS - Coverage Tests', () => {
  let bos: BehaviorOS;

  beforeEach(() => {
    bos = new BehaviorOS();
  });

  it('should compare DNA versions and return scores', async () => {
    const dna1: DNA = {
      name: 'DNA v1',
      version: '1.0.0',
      description: 'Old version',
      personas: [],
      governance: [],
      quality: [],
    };

    const dna2: DNA = {
      name: 'DNA v2',
      version: '2.0.0',
      description: 'New version',
      personas: [
        { role: 'admin', name: 'User1', authority: 'admin', skills: ['skill1'] },
        { role: 'dev', name: 'User2', authority: 'developer', skills: ['skill2'] },
        { role: 'arch', name: 'User3', authority: 'architect', skills: ['skill3'] },
        { role: 'ops', name: 'User4', authority: 'operator', skills: ['skill4'] },
      ],
      governance: [
        { id: 'g1', level: 'critical', action: 'block', conditions: [], description: '' },
        { id: 'g2', level: 'high', action: 'warn', conditions: [], description: '' },
        { id: 'g3', level: 'medium', action: 'log', conditions: [], description: '' },
        { id: 'g4', level: 'low', action: 'warn', conditions: [], description: '' },
        { id: 'g5', level: 'critical', action: 'escalate', conditions: [], description: '' },
        { id: 'g6', level: 'high', action: 'block', conditions: [], description: '' },
      ],
      quality: [
        { id: 'q1', type: 'test_coverage', threshold: 80 },
        { id: 'q2', type: 'lint', threshold: 0 },
        { id: 'q3', type: 'security', threshold: 0 },
        { id: 'q4', type: 'performance', threshold: 50 },
      ],
    };

    const result = bos.compareDNAVersions(dna1, dna2);

    expect(result.score1).toBe(0); // No v2, no extra personas/rules/quality
    expect(result.score2).toBeGreaterThan(0); // Has v2, 4 personas, 6 rules, 4 quality
    expect(result.difference).toBeGreaterThan(0);
    expect(typeof result.recommendation).toBe('string');
  });

  it('should return similar recommendation when DNA scores are close', async () => {
    const dna1: DNA = {
      name: 'DNA A',
      version: '2.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    const dna2: DNA = {
      name: 'DNA B',
      version: '2.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    const result = bos.compareDNAVersions(dna1, dna2);
    expect(result.difference).toBe(0);
    expect(result.recommendation).toContain('Similar');
  });

  it('should score DNA with v2 version', async () => {
    const dna: DNA = {
      name: 'Test',
      version: 'v2.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    const result = bos.compareDNAVersions(dna, dna);
    expect(result.score1).toBe(2); // v2 bonus
    expect(result.score2).toBe(2);
    expect(result.difference).toBe(0);
  });

  it('should handle empty DNA comparison', async () => {
    const emptyDNA: DNA = {
      name: 'Empty',
      version: '1.0.0',
      description: 'Empty',
      personas: [],
      governance: [],
      quality: [],
    };

    const result = bos.compareDNAVersions(emptyDNA, emptyDNA);
    expect(result.score1).toBe(0);
    expect(result.score2).toBe(0);
    expect(result.difference).toBe(0);
  });

  it('should return status with all fields', () => {
    const status = bos.getStatus();

    expect(status.engine).toBe(true);
    expect(status.dna).toBeNull();
    expect(status.missions).toBe(0);
    expect(status.agents).toBe(0);
    expect(status.state).toBeDefined();
    expect(status.state.selectedDna).toBeNull();
  });

  it('should update agent state correctly', () => {
    bos.updateState({ currentStep: 3, selectedDna: 'test-dna' });

    const state = bos.getState();
    expect(state.currentStep).toBe(3);
    expect(state.selectedDna).toBe('test-dna');
    expect(state.updatedAt).toBeDefined();
  });

  it('should list missions with limit', () => {
    // Create more than 50 missions
    for (let i = 0; i < 60; i++) {
      bos.createMission({ title: `Mission ${i}`, type: 'feature', priority: 'medium' });
    }

    const limited = bos.listMissions(50);
    expect(limited).toHaveLength(50);

    const all = bos.listMissions(100);
    expect(all).toHaveLength(60);
  });

  it('should register and list agents', () => {
    const agent1: Agent = {
      id: 'agent-1',
      name: 'Agent One',
      type: 'developer',
      status: 'idle',
      dnaPattern: 'surgical-team',
      capabilities: ['coding'],
      currentMission: null,
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 },
    };

    const agent2: Agent = {
      id: 'agent-2',
      name: 'Agent Two',
      type: 'architect',
      status: 'busy',
      dnaPattern: 'enterprise-governance',
      capabilities: ['design'],
      currentMission: 'mission-1',
      metrics: { tasksCompleted: 5, tasksFailed: 0, avgResponseTime: 100, governanceViolations: 0 },
    };

    bos.registerAgent(agent1);
    bos.registerAgent(agent2);

    expect(bos.getAgent('agent-1')).toEqual(agent1);
    expect(bos.getAgent('agent-2')).toEqual(agent2);
    expect(bos.getAgent('non-existent')).toBeUndefined();
    expect(bos.listAgents()).toHaveLength(2);
  });

  it('should simulate actions through evaluateGovernance', async () => {
    const dna: DNA = {
      name: 'Test',
      version: '2.0.0',
      description: 'Test',
      personas: [],
      governance: [
        {
          id: 'rule-1',
          level: 'high',
          action: 'block',
          conditions: [{ type: 'blocked', value: true }],
          description: 'Block',
        },
      ],
      quality: [],
    };

    await bos.loadDNA(dna);

    const result = bos.simulateAction('test', { agent: 'agent-1', context: { blocked: true } });
    expect(result.verdict).toBe('deny');
  });

  it('should handle learning records with all fields', () => {
    const event = bos.recordLearning({
      type: 'insight',
      source: 'test',
      content: 'Test content',
      impact: 'high',
    });

    expect(event.id).toBeDefined();
    expect(event.type).toBe('insight');
    expect(event.source).toBe('test');
    expect(event.content).toBe('Test content');
    expect(event.impact).toBe('high');
    expect(event.timestamp).toBeDefined();
  });

  it('should get insights with limit', () => {
    // Record multiple events
    for (let i = 0; i < 10; i++) {
      bos.recordLearning({
        type: 'insight',
        source: 'test',
        content: `Insight ${i}`,
        impact: i < 5 ? 'high' : 'low',
      });
    }

    const highImpact = bos.getInsights(3);
    expect(highImpact).toHaveLength(3);
    expect(highImpact.every((e) => e.impact === 'high' || e.impact === 'critical')).toBe(true);
  });

  it('should handle mission lifecycle with progress updates', () => {
    const mission = bos.createMission({ title: 'Test', type: 'feature', priority: 'high' });
    expect(mission.progress).toBe(0);
    expect(mission.status).toBe('pending');

    const started = bos.startMission(mission.id);
    expect(started?.status).toBe('active');

    // Progress update is not directly exposed but can be tested via mission engine
    const updated = bos.getMission(mission.id);
    expect(updated).toBeDefined();
  });

  it('should handle failed mission completion', () => {
    const mission = bos.createMission({ title: 'Will Fail', type: 'bugfix', priority: 'critical' });

    const failed = bos.failMission(mission.id, 'Something went wrong');
    expect(failed?.status).toBe('failed');
    expect(failed?.updatedAt).toBeDefined();
  });

  it('should return null for non-existent mission operations', () => {
    // Create a mission first to initialize the mission engine
    bos.createMission({ title: 'Init', type: 'feature', priority: 'low' });

    expect(bos.getMission('non-existent')).toBeNull();
    expect(bos.startMission('non-existent')).toBeNull();
    expect(bos.completeMission('non-existent')).toBeNull();
    expect(bos.failMission('non-existent')).toBeNull();
  });
});
