import type { Mission } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { MissionEngine } from '../src/engine/mission-engine.js';
import { SqliteStore } from '../src/persistence/sqlite-store.js';

const executed = (gate: string, executionId = `exec-${gate}`) => ({
  gate,
  status: 'passed' as const,
  source: 'pnpm test',
  provenance: 'executed' as const,
  executionId,
});

function executedMission(engine: MissionEngine, requiredChecks = ['tests']) {
  const mission = engine.create({
    title: 'Executed mission',
    type: 'feature',
    priority: 'high',
    dnaPattern: 'test',
    createdBy: 'agent-1',
    requiredChecks,
    verificationMode: 'executed',
  });
  engine.transition(mission.id, 'active');
  return mission;
}

describe('mission evidence integrity', () => {
  it('accepts executed evidence with an executionId in executed mode', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);

    const result = engine.transition(mission.id, 'completed', {
      evidence: [executed('tests')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.status).toBe('completed');
    expect(result.mission.completionBasis).toBe('evidence');
    expect(result.mission.evidence?.[0]).toMatchObject({
      gate: 'tests',
      provenance: 'executed',
      executionId: 'exec-tests',
    });
  });

  it('rejects reported evidence when the mission requires executed verification', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'an agent said so' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_UNVERIFIED');
    expect(result.mission?.status).toBe('active');
    expect(result.mission?.evidence).toEqual([]);
  });

  it('rejects an executed claim without an executionId as malformed', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test', provenance: 'executed' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_INVALID');
  });

  it('rejects contradictory executed+simulated evidence', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);

    const result = engine.transition(mission.id, 'completed', {
      evidence: [
        {
          gate: 'tests',
          status: 'passed',
          source: 'pnpm test',
          provenance: 'executed',
          executionId: 'exec-1',
          simulated: true,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_INVALID');
  });

  it('rejects simulated evidence even when it claims provenance executed is absent', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'simulated', simulated: true }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_SIMULATED');
  });

  it('refuses executed mode without at least one required check', () => {
    const engine = new MissionEngine();
    const mission = engine.create({
      title: 'No gates',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
      requiredChecks: [],
      verificationMode: 'executed',
    });
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_MISSING');
  });

  it('keeps the historical contract in any mode', () => {
    const engine = new MissionEngine();
    const mission = engine.create({
      title: 'Legacy mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
      requiredChecks: ['tests'],
    });
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.evidence?.[0].provenance).toBe('reported');
  });

  it('deduplicates a replayed executionId and rejects stale versions', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);
    const version = mission.version ?? 0;

    const first = engine.addEvidence(mission.id, [executed('tests', 'exec-1')]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changed).toBe(true);
    expect(first.mission.evidence).toHaveLength(1);
    expect(first.mission.version).toBe(version + 1);

    const replay = engine.addEvidence(mission.id, [executed('tests', 'exec-1')]);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.changed).toBe(false);
    expect(replay.mission.evidence).toHaveLength(1);
    expect(replay.mission.version).toBe(version + 1);

    const stale = engine.addEvidence(mission.id, [executed('tests', 'exec-2')], {
      expectedVersion: version,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe('VERSION_CONFLICT');
  });

  it('does not append evidence to a terminal mission', () => {
    const engine = new MissionEngine();
    const mission = executedMission(engine);
    const completed = engine.transition(mission.id, 'completed', {
      evidence: [executed('tests')],
    });
    expect(completed.ok).toBe(true);

    const result = engine.addEvidence(mission.id, [executed('tests', 'exec-late')]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSION_TERMINAL');
  });
});

class FailingStore extends SqliteStore {
  failSaves = false;

  override saveMission(mission: Mission): void {
    if (this.failSaves) throw new Error('disk full');
    super.saveMission(mission);
  }
}

describe('evidence persistence', () => {
  it('rolls back appended evidence when the store rejects the write', () => {
    const store = new FailingStore({ path: ':memory:' });
    const bos = new BehaviorOS({ persistence: { store, autoHydrate: false } });
    const mission = bos.createMission({
      title: 'Evidence rollback',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['tests'],
      verificationMode: 'executed',
    });
    expect(bos.transitionMission(mission.id, 'active').ok).toBe(true);

    store.failSaves = true;
    const result = bos.addMissionEvidence(mission.id, [executed('tests')]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PERSISTENCE_FAILED');
    expect(bos.getMission(mission.id)?.evidence).toEqual([]);
    expect(bos.getMission(mission.id)?.status).toBe('active');

    store.failSaves = false;
    store.close();
  });
});
