import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOSSDK } from '../src/index.js';

describe('BehaviorOSSDK', () => {
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
});
