import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA, PolicyRule, Role } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { SqliteStore } from '../src/persistence/sqlite-store.js';

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

describe('RolePolicyEngine persistence', () => {
  let dir: string;
  let dbPath: string;
  const bornInstances: Array<BehaviorOS> = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-role-policy-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    // Windows refuses to delete a directory holding an open SQLite file.
    for (const bos of bornInstances.splice(0)) bos.closeStore();
    rmSync(dir, { recursive: true, force: true });
  });

  const policy: PolicyRule = {
    id: 'no-direct-deploy',
    name: 'No direct deploy',
    description: 'Developers cannot deploy to production',
    condition: 'deploy',
    action: 'block',
    severity: 'high',
    appliesTo: ['role'],
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  };

  const role: Role = {
    id: 'developer',
    name: 'Developer',
    displayName: 'Developer',
    responsibilities: ['implement features'],
    policies: ['no-direct-deploy'],
    canAudit: false,
    canEnforce: false,
    canTeach: true,
  };

  it('survives a restart through the store (roles, policies and decisions)', () => {
    const first =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    expect(first.defineRolePolicy(policy).success).toBe(true);
    expect(first.registerRole(role).success).toBe(true);
    const before = first.evaluateRoleAction({ role: 'developer' }, 'deploy production');
    expect(before.action).toBe('block');

    // A fresh instance over the same DB hydrates the full role/policy state:
    // registry, rules and the attribution history made it to disk.
    const second =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    expect(second.hasPersistence()).toBe(true);
    expect(second.getRolePolicyEngine().getRole('developer')).toBeDefined();
    expect(second.getRolePolicyEngine().listPolicies()).toHaveLength(1);
    expect(second.getRolePolicyEngine().getAuditTrail()).toHaveLength(1);

    const after = second.evaluateRoleAction({ role: 'developer' }, 'deploy production');
    expect(after.action).toBe('block');
    expect(after.matchedPolicy?.id).toBe('no-direct-deploy');
    expect(second.getRolePolicyEngine().getAuditTrail()).toHaveLength(2);
  });

  it('skips the per-call meta write for benign decisions (hot-path cost control)', () => {
    const first =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    expect(first.defineRolePolicy(policy).success).toBe(true);
    expect(first.registerRole(role).success).toBe(true);
    // A meaningful decision persists the snapshot...
    first.evaluateRoleAction({ role: 'developer' }, 'deploy production');
    const probeStore = new SqliteStore({ path: dbPath });
    const persisted = probeStore.getMeta('role-policy-state');
    expect(typeof persisted).toBe('string');
    const snapshot = JSON.parse(persisted as string) as { trail: unknown[] };
    const persistedDecisions = snapshot.trail.length;

    // ...while benign calls (no policy matched) do not: the permission hook
    // evaluates every mutating tool call through this exact method.
    for (let i = 0; i < 10; i++) {
      const benign = first.evaluateRoleAction({ role: 'developer' }, 'grep files');
      expect(benign.action).toBe('allow');
    }
    const persistedAfter = JSON.parse(probeStore.getMeta('role-policy-state') as string) as {
      trail: unknown[];
    };
    expect(persistedAfter.trail.length).toBe(persistedDecisions);
    probeStore.close();
    // The in-memory trail still records every benign decision.
    expect(first.getRolePolicyEngine().getAuditTrail().length).toBeGreaterThan(persistedDecisions);
  });

  it('an expired policy comes back from the store but no longer fires', () => {
    const first =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    first.defineRolePolicy({ ...policy, effectiveUntil: '2026-01-02T00:00:00.000Z' });
    first.registerRole(role);

    const second =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    expect(second.getRolePolicyEngine().listPolicies()).toHaveLength(1);
    expect(second.evaluateRoleAction({ role: 'developer' }, 'deploy').action).toBe('allow');
  });

  it('an invalid persisted snapshot never blocks startup', () => {
    const store = new SqliteStore({ path: dbPath });
    store.setMeta('role-policy-state', 'not json at all');
    store.close();

    bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } }));
    const bos = bornInstances[bornInstances.length - 1];
    expect(bos.getRolePolicyEngine().listRoles()).toHaveLength(0);
  });

  it('facade mutations without a store still work (memory-only)', () => {
    const bos = new BehaviorOS();
    expect(bos.hasPersistence()).toBe(false);
    expect(bos.defineRolePolicy(policy).success).toBe(true);
    expect(bos.registerRole(role).success).toBe(true);
    expect(bos.evaluateRoleAction({ role: 'developer' }, 'deploy').action).toBe('block');
  });

  it('learning lifecycle records survive a restart through the store', async () => {
    const first =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    await first.loadDNA(testDna);
    const record = first.createLearningRecord({
      title: 'Self-review finds it, guardrails keep it',
      content: 'A fix went in without a failing test; require tracer bullets first.',
      source: 'pragmatic-pipeline',
      impact: 'high',
    });
    expect(record.stage).toBe('observation');

    const promoted = first.advanceLearningRecord(record.id, 'lesson', {
      evidence: ['verify:all 879/879'],
      reason: 'Landed green',
    });
    expect(promoted.ok).toBe(true);
    // A refused promotion must not persist anything: go one stage too far.
    expect(first.advanceLearningRecord(record.id, 'policy', {}).ok).toBe(false);

    const second =
      bornInstances[bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } })) - 1];
    const restored = second.getLearningRecords();
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(record.id);
    expect(restored[0].stage).toBe('lesson');
    expect(restored[0].transitions).toHaveLength(1);
    expect(restored[0].evidence).toEqual(['verify:all 879/879']);
  });

  it('a corrupt learning-records snapshot never blocks startup', () => {
    const store = new SqliteStore({ path: dbPath });
    store.setMeta('learning-records', 'not json at all');
    store.close();

    bornInstances.push(new BehaviorOS({ persistence: { path: dbPath } }));
    const bos = bornInstances[bornInstances.length - 1];
    expect(bos.getLearningRecords()).toEqual([]);
    // And the facade keeps working: the next mutation re-persists clean state.
    const record = bos.createLearningRecord({
      title: 't',
      content: 'c',
      source: 's',
      impact: 'low',
    });
    expect(record.stage).toBe('observation');
  });
});
