import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Mission } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { SqliteStore } from '../src/persistence/sqlite-store.js';

describe('BehaviorOS Full Integration', () => {
  it('should handle complete lifecycle', async () => {
    const bos = new BehaviorOS();

    // Initialize with DNA
    await bos.loadDNA({
      name: 'Complete Test',
      version: '1.0.0',
      description: 'Full lifecycle test',
      personas: [],
      governance: [],
      quality: [],
    });

    // Create and manage mission
    const mission = bos.createMission({
      title: 'Full Lifecycle',
      type: 'feature',
      priority: 'high',
    });
    expect(mission.status).toBe('pending');

    // Start mission
    const started = bos.startMission(mission.id);
    expect(started?.status).toBe('active');

    // Evaluate governance during mission
    const decision = bos.evaluateGovernance('task', {
      agent: 'test-agent',
      context: {},
    });
    expect(decision.action).toBe('task');

    // Run audit
    const audit = bos.runAudit({
      missionId: mission.id,
      agentId: 'test-agent',
    });
    // S1: a simulated audit is never a verification and never reports `pass`.
    expect(audit.overall).toBe('warning');
    expect(audit.simulated).toBe(true);
    expect(audit.summary).toMatch(/^SIMULATED/);

    // Record learning
    const learning = bos.recordLearning({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'high',
    });
    expect(learning.type).toBe('insight');

    // Complete mission
    const completed = bos.completeMission(mission.id);
    expect(completed?.status).toBe('completed');

    // Verify final state
    const status = bos.getStatus();
    expect(status.engine).toBe(true);
    expect(status.dna).toBe('Complete Test');
  });

  it('should persist state across operations', () => {
    const bos = new BehaviorOS();

    // Set up state
    bos.updateState({
      currentStep: 5,
      selectedDna: 'surgical-team',
      activeMission: 'mission-abc',
    });

    // Verify persistence
    const state = bos.getState();
    expect(state.currentStep).toBe(5);
    expect(state.selectedDna).toBe('surgical-team');
    expect(state.activeMission).toBe('mission-abc');
  });

  it('should handle error cases gracefully', () => {
    const bos = new BehaviorOS();

    // Create a mission first so the engine is initialized
    bos.createMission({ title: 'Test', type: 'feature', priority: 'high' });

    // Non-existent mission
    const result = bos.failMission('non-existent', 'Test error');
    expect(result).toBeNull();

    // Invalid operation sequence
    const alreadyPending = bos.completeMission('non-existent');
    expect(alreadyPending).toBeNull();
  });

  it('refuses completion until every required gate has persisted evidence', () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({
      title: 'Evidence-gated lifecycle',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['typecheck', 'tests'],
    });

    expect(bos.startMission(mission.id)?.status).toBe('active');

    // Active -> completed without evidence is refused.
    expect(bos.completeMission(mission.id)).toBeNull();
    expect(bos.getMission(mission.id)?.status).toBe('active');

    const partial = bos.transitionMission(mission.id, 'completed', {
      evidence: [{ gate: 'typecheck', status: 'passed', source: 'pnpm typecheck' }],
    });
    expect(partial.ok).toBe(false);
    if (partial.ok) return;
    expect(partial.code).toBe('EVIDENCE_MISSING');

    const completed = bos.transitionMission(mission.id, 'completed', {
      actor: 'executor',
      evidence: [
        { gate: 'typecheck', status: 'passed', source: 'pnpm typecheck' },
        { gate: 'tests', status: 'passed', source: 'pnpm test' },
      ],
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.mission.completionBasis).toBe('evidence');
    expect(bos.getMission(mission.id)?.status).toBe('completed');
    expect(bos.getState().activeMission).toBeNull();
  });

  it('persists evidence and transitions across a restart (SQLite)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-s1-'));
    const path = join(dir, 'state.sqlite');
    try {
      const bos = new BehaviorOS({ persistence: { path, autoHydrate: false } });
      const mission = bos.createMission({
        title: 'Durable transition',
        type: 'feature',
        priority: 'high',
        requiredChecks: ['tests'],
      });
      bos.startMission(mission.id);
      const completed = bos.transitionMission(mission.id, 'completed', {
        evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
      });
      expect(completed.ok).toBe(true);
      bos.closeStore();

      const reopened = new BehaviorOS({ persistence: { path } });
      const restored = reopened.getMission(mission.id);
      expect(restored?.status).toBe('completed');
      expect(restored?.version).toBe(2);
      expect(restored?.requiredChecks).toEqual(['tests']);
      expect(restored?.evidence).toHaveLength(1);
      expect(restored?.transitions?.map((entry) => entry.to)).toEqual(['active', 'completed']);
      reopened.closeStore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back the in-memory transition when persistence fails', () => {
    const store = new FailingStore({ path: ':memory:' });
    const bos = new BehaviorOS({ persistence: { store, autoHydrate: false } });
    const mission = bos.createMission({
      title: 'Persistence failure',
      type: 'feature',
      priority: 'high',
    });

    store.failSaves = true;
    const result = bos.transitionMission(mission.id, 'active');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PERSISTENCE_FAILED');
    expect(bos.getMission(mission.id)?.status).toBe('pending');
    store.close();
  });

  it('rolls back completionBasis and reason when a terminal write fails', () => {
    const store = new FailingStore({ path: ':memory:' });
    const bos = new BehaviorOS({ persistence: { store, autoHydrate: false } });
    const mission = bos.createMission({
      title: 'Terminal rollback',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['tests'],
    });
    expect(bos.transitionMission(mission.id, 'active').ok).toBe(true);

    store.failSaves = true;
    const completed = bos.transitionMission(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
    });
    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.code).toBe('PERSISTENCE_FAILED');

    const afterCompletion = bos.getMission(mission.id);
    expect(afterCompletion?.status).toBe('active');
    expect(afterCompletion?.completionBasis).toBeUndefined();
    expect(afterCompletion?.lastTransitionReason).toBeUndefined();
    expect(afterCompletion?.evidence).toEqual([]);
    expect(afterCompletion?.version).toBe(1);
    expect(afterCompletion?.transitions).toHaveLength(1);

    const failed = bos.transitionMission(mission.id, 'failed', { reason: 'disk failure' });
    expect(failed.ok).toBe(false);
    expect(bos.getMission(mission.id)?.lastTransitionReason).toBeUndefined();
    store.close();
  });

  it('does not keep a mission in memory when creation cannot be persisted', () => {
    const store = new FailingStore({ path: ':memory:' });
    const bos = new BehaviorOS({ persistence: { store, autoHydrate: false } });
    store.failSaves = true;

    expect(() =>
      bos.createMission({ title: 'Unpersisted', type: 'feature', priority: 'high' }),
    ).toThrow('disk full');
    expect(bos.listMissions()).toHaveLength(0);
    store.close();
  });

  it('pause and resume keep activeMission consistent and terminal states clear it', () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({
      title: 'Pause and resume',
      type: 'feature',
      priority: 'medium',
    });

    expect(bos.startMission(mission.id)?.status).toBe('active');
    expect(bos.getState().activeMission).toBe(mission.id);

    const paused = bos.pauseMission(mission.id);
    expect(paused.ok).toBe(true);
    expect(bos.getState().activeMission).toBe(mission.id);

    const resumed = bos.resumeMission(mission.id);
    expect(resumed.ok).toBe(true);
    expect(bos.getState().activeMission).toBe(mission.id);

    const completed = bos.completeMission(mission.id);
    expect(completed?.status).toBe('completed');
    expect(bos.getState().activeMission).toBeNull();

    const refused = bos.pauseMission(mission.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('INVALID_TRANSITION');
  });
});

class FailingStore extends SqliteStore {
  failSaves = false;

  override saveMission(mission: Mission): void {
    if (this.failSaves) throw new Error('disk full');
    super.saveMission(mission);
  }
}
