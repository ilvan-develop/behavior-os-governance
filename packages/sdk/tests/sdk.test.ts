import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOSSDK } from '../src/index.js';

/** Every public method reachable from an instance, including inherited ones. */
function publicMethods(instance: object): string[] {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.value === 'function') names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  for (const name of Object.getOwnPropertyNames(instance)) {
    if (typeof (instance as Record<string, unknown>)[name] === 'function') names.add(name);
  }
  return [...names];
}

describe('BehaviorOSSDK', () => {
  describe('surface parity with the BehaviorOS facade', () => {
    it('is a BehaviorOS, not a partial mirror', () => {
      expect(new BehaviorOSSDK()).toBeInstanceOf(BehaviorOS);
    });

    it('exposes every public facade method', () => {
      // Regression guard for the old wrapper: it re-declared 15 methods and
      // silently hid decisions, brainstorming, policies, knowledge graph,
      // memory, fairness and compliance. Inheritance must keep the whole API.
      const facade = new BehaviorOS();
      const sdk = new BehaviorOSSDK();
      const facadeMethods = publicMethods(facade);
      expect(facadeMethods.length).toBeGreaterThan(100);
      const missing = facadeMethods.filter(
        (name) => typeof (sdk as unknown as Record<string, unknown>)[name] !== 'function',
      );
      expect(missing).toEqual([]);
    });

    it('reaches the capabilities the old wrapper hid', () => {
      const sdk = new BehaviorOSSDK();
      for (const name of [
        'decide',
        'createBrainstormSession',
        'getPragmaticConversation',
        'createPolicyCandidate',
        'preflightAction',
        'addKnowledgeNode',
        'saveMemory',
        'evaluateFairness',
        'addTemporalRule',
        'transitionMission',
      ]) {
        expect(typeof (sdk as unknown as Record<string, unknown>)[name], name).toBe('function');
      }
    });
  });

  let sdk: BehaviorOSSDK;

  beforeEach(() => {
    sdk = new BehaviorOSSDK();
  });

  it('should initialize with default config', () => {
    const status = sdk.getStatus();
    expect(status.engine).toBe(true);
    expect(status.dna).toBeNull();
  });

  it('should load DNA pattern', async () => {
    const dna: DNA = {
      name: 'Test DNA',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    await sdk.loadDNA(dna);
    expect(sdk.getDNA()).toEqual(dna);
  });

  it('should evaluate governance with DNA loaded', async () => {
    const dna: DNA = {
      name: 'Test DNA',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };
    await sdk.loadDNA(dna);

    const decision = sdk.evaluateGovernance('test-action', {
      agent: 'agent-1',
      context: {},
    });

    expect(decision.action).toBe('test-action');
    expect(decision.verdict).toBeDefined();
    expect(decision.timestamp).toBeDefined();
  });

  it('should create mission', () => {
    const mission = sdk.createMission({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
    });

    expect(mission.id).toBeDefined();
    expect(mission.title).toBe('Test Mission');
    expect(mission.status).toBe('pending');
  });

  it('should record learning', () => {
    const event = sdk.recordLearning({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'medium',
    });

    expect(event.id).toBeDefined();
    expect(event.content).toBe('Test insight');
  });

  it('should get insights after recording', () => {
    sdk.recordLearning({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'high',
    });

    const insights = sdk.getInsights(10);
    expect(insights.length).toBeGreaterThan(0);
  });

  it('should create mission with requiredChecks', () => {
    const mission = sdk.createMission({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['governance', 'audit'],
    });

    expect(mission.id).toBeDefined();
    expect(mission.title).toBe('Test Mission');
    expect(mission.status).toBe('pending');
  });

  it('should start, complete, and cancel missions via SDK', () => {
    const mission = sdk.createMission({
      title: 'Lifecycle Mission',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['governance'],
    });

    // Start -> active
    const started = sdk.startMission(mission.id);
    expect(started).not.toBeNull();
    expect(started?.status).toBe('active');

    // Complete with evidence
    const completed = sdk.completeMission(mission.id, {
      evidence: [{ gate: 'governance', status: 'passed', source: 'test' }],
    });
    expect(completed).not.toBeNull();
    expect(completed?.status).toBe('completed');

    // Cancel a new mission
    const cancelTarget = sdk.createMission({
      title: 'Cancel Mission',
      type: 'refactor',
      priority: 'medium',
    });
    const result = sdk.cancelMission(cancelTarget.id);
    expect(result.ok).toBe(true);
    expect(result.mission?.status).toBe('cancelled');
  });

  it('should list missions with filters', () => {
    sdk.createMission({ title: 'Feature A', type: 'feature', priority: 'high' });
    sdk.createMission({ title: 'Bug B', type: 'bugfix', priority: 'low' });

    const all = sdk.listMissions();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const features = sdk.listMissions(50, { type: 'feature' });
    expect(features.every((m) => m.type === 'feature')).toBe(true);

    const highPriority = sdk.listMissions(50, { priority: 'high' });
    expect(highPriority.every((m) => m.priority === 'high')).toBe(true);
  });

  it('should fail a mission with reason', () => {
    const mission = sdk.createMission({
      title: 'Fail Mission',
      type: 'incident',
      priority: 'critical',
    });

    sdk.startMission(mission.id);
    const failed = sdk.failMission(mission.id, 'Test failure reason');
    expect(failed).not.toBeNull();
    expect(failed?.status).toBe('failed');
  });
});
