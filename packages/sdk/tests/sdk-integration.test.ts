import type { DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOSSDK } from '../src/index.js';

describe('BehaviorOSSDK Integration', () => {
  let sdk: BehaviorOSSDK;

  beforeEach(() => {
    sdk = new BehaviorOSSDK();
  });

  it('should create and manage missions through SDK', () => {
    const mission = sdk.createMission({
      title: 'SDK Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'enterprise-governance',
    });

    expect(mission.id).toBeDefined();
    expect(mission.title).toBe('SDK Test Mission');

    const started = sdk.startMission(mission.id);
    expect(started?.status).toBe('active');
  });

  it('should evaluate governance through SDK', async () => {
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
      agent: 'sdk-agent',
      context: {},
    });

    expect(decision.action).toBe('test-action');
    expect(decision.verdict).toBeDefined();
  });

  it('should record and retrieve learning through SDK', () => {
    sdk.recordLearning({
      type: 'insight',
      source: 'sdk-test',
      content: 'SDK learning test',
      impact: 'high',
    });

    const insights = sdk.getInsights(10);
    expect(insights.length).toBeGreaterThan(0);
  });

  it('should get status and state through SDK', () => {
    const status = sdk.getStatus();
    expect(status.engine).toBe(true);

    const state = sdk.getState();
    expect(state).toBeDefined();
  });

  it('should load DNA through SDK', async () => {
    const dna: DNA = {
      name: 'SDK DNA',
      version: '1.0.0',
      description: 'SDK test DNA',
      personas: [],
      governance: [],
      quality: [],
    };

    await sdk.loadDNA(dna);
    expect(sdk.getDNA()?.name).toBe('SDK DNA');
  });
});
