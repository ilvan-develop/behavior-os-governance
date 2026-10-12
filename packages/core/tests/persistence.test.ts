import type { DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

const testDna: DNA = {
  name: 'Test DNA',
  version: '1.0.0',
  description: 'Persistence test DNA',
  personas: [],
  governance: [
    {
      id: 'block-prod',
      level: 'critical',
      action: 'block',
      conditions: [{ type: 'prod', value: true }],
      description: 'Block prod changes',
    },
  ],
  quality: [],
};

describe('BehaviorOS persistence', () => {
  let bos: BehaviorOS;

  beforeEach(() => {
    bos = new BehaviorOS();
  });

  it('round-trips protocol state, DNA, missions and learnings', async () => {
    await bos.loadDNA(testDna);
    const mission = bos.createMission({ title: 'Ship it', type: 'feature', priority: 'high' });
    bos.startMission(mission.id);
    bos.recordLearning({ type: 'insight', source: 'test', content: 'kept', impact: 'high' });

    const snapshot = bos.exportState();
    // The snapshot must be plain JSON so it can be written to any storage.
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();
    expect(snapshot.version).toBe(1);

    const restored = new BehaviorOS();
    expect(restored.importState(snapshot)).toBe(true);

    expect(restored.getState().currentStep).toBe(7);
    expect(restored.getState().selectedDna).toBe('Test DNA');
    expect(restored.getState().activeMission).toBe(mission.id);
    expect(restored.getDNA()?.name).toBe('Test DNA');
    expect(restored.listMissions()).toHaveLength(1);
    expect(restored.getInsights(5)).toHaveLength(1);
    // Governance stays bound to the restored DNA.
    expect(
      restored.evaluateGovernance('deploy', { agent: 'a', context: { prod: true } }).verdict,
    ).toBe('deny');
  });

  it('rejects missing or incompatible snapshots without touching state', async () => {
    await bos.loadDNA(testDna);
    const before = bos.getState().currentStep;

    expect(bos.importState(null)).toBe(false);
    expect(bos.importState(undefined)).toBe(false);
    expect(bos.importState({ version: 999 } as never)).toBe(false);

    expect(bos.getState().currentStep).toBe(before);
    expect(bos.getState().selectedDna).toBe('Test DNA');
  });
});

describe('BehaviorOS active mission tracking', () => {
  let bos: BehaviorOS;

  beforeEach(async () => {
    bos = new BehaviorOS();
    await bos.loadDNA(testDna);
  });

  it('sets activeMission when a mission starts', () => {
    const mission = bos.createMission({ title: 'Active', type: 'bugfix', priority: 'medium' });
    expect(bos.getState().activeMission).toBeNull();

    bos.startMission(mission.id);
    expect(bos.getState().activeMission).toBe(mission.id);
  });

  it('clears activeMission when the active mission completes', () => {
    const mission = bos.createMission({ title: 'Active', type: 'bugfix', priority: 'medium' });
    bos.startMission(mission.id);

    bos.completeMission(mission.id);
    expect(bos.getState().activeMission).toBeNull();
  });

  it('clears activeMission when the active mission fails', () => {
    const mission = bos.createMission({ title: 'Active', type: 'bugfix', priority: 'medium' });
    bos.startMission(mission.id);

    bos.failMission(mission.id, 'boom');
    expect(bos.getState().activeMission).toBeNull();
  });

  it('leaves activeMission untouched when a different mission completes', () => {
    const first = bos.createMission({ title: 'First', type: 'feature', priority: 'low' });
    const second = bos.createMission({ title: 'Second', type: 'feature', priority: 'low' });
    bos.startMission(first.id);

    bos.completeMission(second.id);
    expect(bos.getState().activeMission).toBe(first.id);
  });

  it('does not advance the protocol when advanceProtocol is false', () => {
    const stepBefore = bos.getState().currentStep; // 1, from loadDNA

    const mission = bos.createMission({
      title: 'Auto',
      type: 'feature',
      priority: 'medium',
      advanceProtocol: false,
    });
    expect(bos.getState().currentStep).toBe(stepBefore);

    bos.startMission(mission.id, { advanceProtocol: false });
    expect(bos.getState().currentStep).toBe(stepBefore);
    expect(bos.getState().activeMission).toBe(mission.id);
  });
});

describe('BehaviorOS governance engine reuse (cache)', () => {
  it('serves an identical evaluation from the shared cache', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(testDna);

    const first = bos.evaluateGovernance('deploy', { agent: 'agent-1', context: { prod: true } });
    const second = bos.evaluateGovernance('deploy', { agent: 'agent-1', context: { prod: true } });

    // Same engine + same cache key → the cached decision object is returned.
    expect(second.id).toBe(first.id);
    expect(second.verdict).toBe('deny');
  });
});
