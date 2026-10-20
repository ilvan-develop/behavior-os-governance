import type { MissionStatus } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { MissionEngine } from '../src/engine/mission-engine.js';

describe('MissionEngine', () => {
  let engine: MissionEngine;

  beforeEach(() => {
    engine = new MissionEngine();
  });

  it('should create a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'enterprise-governance',
      createdBy: 'agent-1',
    });

    expect(mission.id).toBeDefined();
    expect(mission.title).toBe('Test Mission');
    expect(mission.status).toBe('pending');
    expect(mission.progress).toBe(0);
    expect(mission.createdAt).toBeDefined();
  });

  it('should start a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const started = engine.start(mission.id);
    expect(started?.status).toBe('active');
  });

  it('should complete a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);
    const completed = engine.complete(mission.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.progress).toBe(100);
  });

  it('should fail a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const failed = engine.fail(mission.id, 'Something went wrong');
    expect(failed?.status).toBe('failed');
  });

  it('should get mission by id', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const found = engine.get(mission.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Test Mission');
  });

  it('should return null for non-existent mission', () => {
    const found = engine.get('non-existent');
    expect(found).toBeNull();
  });

  it('should list all missions', () => {
    const _m1 = engine.create({
      title: 'Mission 1',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m2 = engine.create({
      title: 'Mission 2',
      type: 'bugfix',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const missions = engine.list();
    expect(missions).toHaveLength(2);
  });

  it('should filter missions by status', () => {
    const m1 = engine.create({
      title: 'Pending',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    engine.start(m1.id);

    const pending = engine.list({ status: 'pending' });
    const active = engine.list({ status: 'active' });

    expect(pending).toHaveLength(0);
    expect(active).toHaveLength(1);
  });

  it('should filter missions by priority', () => {
    engine.create({
      title: 'Low',
      type: 'feature',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    engine.create({
      title: 'Critical',
      type: 'feature',
      priority: 'critical',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const critical = engine.list({ priority: 'critical' });
    expect(critical).toHaveLength(1);
    expect(critical[0].title).toBe('Critical');
  });

  it('should update progress', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.updateProgress(mission.id, 50);
    const updated = engine.get(mission.id);
    expect(updated?.progress).toBe(50);
  });

  it('should cap progress at 100', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.updateProgress(mission.id, 150);
    const updated = engine.get(mission.id);
    expect(updated?.progress).toBe(100);
  });

  it('should sort by priority', () => {
    const _m1 = engine.create({
      title: 'Low',
      type: 'feature',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m2 = engine.create({
      title: 'Critical',
      type: 'feature',
      priority: 'critical',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m3 = engine.create({
      title: 'Medium',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const missions = engine.list();
    expect(missions[0].priority).toBe('critical');
    expect(missions[1].priority).toBe('medium');
    expect(missions[2].priority).toBe('low');
  });

  it('should return null for non-existent mission operations', () => {
    expect(engine.start('non-existent')).toBeNull();
    expect(engine.complete('non-existent')).toBeNull();
    expect(engine.fail('non-existent')).toBeNull();
    expect(engine.get('non-existent')).toBeNull();
    expect(engine.updateProgress('non-existent', 50)).toBeNull();
  });
});

function createTransitionMission(engine: MissionEngine, requiredChecks?: string[]) {
  return engine.create({
    title: 'Transition Mission',
    type: 'feature',
    priority: 'high',
    dnaPattern: 'test',
    createdBy: 'agent-1',
    requiredChecks,
  });
}

/** Brings a fresh mission to `status` using only allowed transitions. */
function missionInStatus(engine: MissionEngine, status: MissionStatus) {
  const mission = createTransitionMission(engine);
  if (status === 'active') engine.transition(mission.id, 'active');
  if (status === 'paused') {
    engine.transition(mission.id, 'active');
    engine.transition(mission.id, 'paused');
  }
  if (status === 'completed') {
    engine.transition(mission.id, 'active');
    engine.transition(mission.id, 'completed');
  }
  if (status === 'failed') engine.transition(mission.id, 'failed');
  if (status === 'cancelled') engine.transition(mission.id, 'cancelled');
  const result = engine.get(mission.id);
  if (!result) throw new Error('mission setup failed');
  return result;
}

describe('MissionEngine deterministic transitions (S1)', () => {
  let engine: MissionEngine;

  beforeEach(() => {
    engine = new MissionEngine();
  });

  const VALID: Array<[MissionStatus, MissionStatus]> = [
    ['pending', 'active'],
    ['pending', 'failed'],
    ['pending', 'cancelled'],
    ['active', 'paused'],
    ['active', 'completed'],
    ['active', 'failed'],
    ['active', 'cancelled'],
    ['paused', 'active'],
    ['paused', 'completed'],
    ['paused', 'failed'],
    ['paused', 'cancelled'],
  ];

  const INVALID: Array<[MissionStatus, MissionStatus]> = [
    ['pending', 'paused'],
    ['pending', 'completed'],
    ['completed', 'active'],
    ['completed', 'paused'],
    ['completed', 'failed'],
    ['completed', 'cancelled'],
    ['failed', 'active'],
    ['failed', 'paused'],
    ['failed', 'completed'],
    ['failed', 'cancelled'],
    ['cancelled', 'active'],
    ['cancelled', 'paused'],
    ['cancelled', 'completed'],
    ['cancelled', 'failed'],
  ];

  it.each(VALID)('allows %s -> %s', (from, to) => {
    const mission = missionInStatus(engine, from);
    const versionBefore = mission.version ?? 0;
    const result = engine.transition(mission.id, to, { actor: 'tester' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.mission.status).toBe(to);
    expect(result.mission.version).toBe(versionBefore + 1);
    expect(result.mission.transitions?.at(-1)).toMatchObject({
      from,
      to,
      actor: 'tester',
      version: result.mission.version,
    });
  });

  it.each(INVALID)('refuses %s -> %s', (from, to) => {
    const mission = missionInStatus(engine, from);
    const result = engine.transition(mission.id, to);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
    expect(result.from).toBe(from);
    expect(result.to).toBe(to);
    expect(engine.get(mission.id)?.status).toBe(from);
  });

  it('treats a repeated transition as an idempotent no-op', () => {
    const mission = missionInStatus(engine, 'active');
    const first = engine.transition(mission.id, 'paused');
    expect(first.ok).toBe(true);
    if (!first.ok || !first.changed) throw new Error('first pause failed');
    const version = first.mission.version;

    const second = engine.transition(mission.id, 'paused');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.mission.version).toBe(version);
    expect(second.mission.transitions).toHaveLength(2);
  });

  it('rejects a stale expectedVersion before mutating anything', () => {
    const mission = createTransitionMission(engine);
    const started = engine.transition(mission.id, 'active');
    expect(started.ok).toBe(true);

    const stale = engine.transition(mission.id, 'paused', { expectedVersion: 0 });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(engine.get(mission.id)?.status).toBe('active');

    const current = engine.transition(mission.id, 'paused', { expectedVersion: 1 });
    expect(current.ok).toBe(true);
  });

  it('bumps the version on progress updates', () => {
    const mission = createTransitionMission(engine);
    engine.updateProgress(mission.id, 40);
    expect(engine.get(mission.id)?.version).toBe(1);
    engine.updateProgress(mission.id, 60);
    expect(engine.get(mission.id)?.version).toBe(2);
  });

  it('refuses progress updates on a terminal mission', () => {
    const mission = createTransitionMission(engine, []);
    engine.transition(mission.id, 'active');
    const completed = engine.transition(mission.id, 'completed');
    expect(completed.ok).toBe(true);

    const version = engine.get(mission.id)?.version;
    const progress = engine.get(mission.id)?.progress;
    expect(engine.updateProgress(mission.id, 10)).toBeNull();
    expect(engine.get(mission.id)?.version).toBe(version);
    expect(engine.get(mission.id)?.progress).toBe(progress);
  });

  it('trims required gates and evidence before matching', () => {
    const mission = engine.create({
      title: 'Trim contract',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'tester',
      requiredChecks: [' tests ', 'tests', ' ', ''],
    });
    expect(mission.requiredChecks).toEqual(['tests']);

    expect(engine.transition(mission.id, 'active').ok).toBe(true);
    const completed = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: ' tests ', status: 'passed', source: ' pnpm test ' }],
    });
    expect(completed.ok).toBe(true);

    const evidence = engine.get(mission.id)?.evidence?.[0];
    expect(evidence?.gate).toBe('tests');
    expect(evidence?.source).toBe('pnpm test');
  });

  it('refuses completion while required evidence is missing', () => {
    const mission = createTransitionMission(engine, ['typecheck', 'tests']);
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'typecheck', status: 'passed', source: 'tsc --noEmit' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_MISSING');
    expect(result.message).toContain('tests');
    expect(engine.get(mission.id)?.status).toBe('active');
  });

  it('refuses completion when the latest evidence for a gate failed', () => {
    const mission = createTransitionMission(engine, ['tests']);
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'failed', source: 'pnpm test' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_FAILED');
  });

  it('refuses simulated evidence even when it claims to pass', () => {
    const mission = createTransitionMission(engine, ['tests']);
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'passed', source: 'simulated', simulated: true }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_SIMULATED');
  });

  it('rejects malformed evidence instead of recording it', () => {
    const mission = createTransitionMission(engine, ['tests']);
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: '  ', status: 'passed', source: 'pnpm test' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EVIDENCE_INVALID');
  });

  it('completes when every required gate has passing evidence', () => {
    const mission = createTransitionMission(engine, ['typecheck', 'tests']);
    engine.transition(mission.id, 'active');

    const result = engine.transition(mission.id, 'completed', {
      actor: 'executor',
      evidence: [
        { gate: 'typecheck', status: 'passed', source: 'pnpm typecheck' },
        { gate: 'tests', status: 'passed', source: 'pnpm test' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.status).toBe('completed');
    expect(result.mission.progress).toBe(100);
    expect(result.mission.completionBasis).toBe('evidence');
    expect(result.mission.evidence).toHaveLength(2);
    expect(result.mission.evidence?.every((entry) => entry.recordedAt.length > 0)).toBe(true);
  });

  it('uses the latest evidence for each gate', () => {
    const mission = createTransitionMission(engine, ['tests']);
    engine.transition(mission.id, 'active');

    const failed = engine.transition(mission.id, 'completed', {
      evidence: [{ gate: 'tests', status: 'failed', source: 'run 1' }],
    });
    expect(failed.ok).toBe(false);

    const passed = engine.transition(mission.id, 'completed', {
      evidence: [
        { gate: 'tests', status: 'failed', source: 'run 1' },
        { gate: 'tests', status: 'passed', source: 'run 2' },
      ],
    });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.mission.evidence).toHaveLength(2);
  });

  it('records completion without required checks honestly', () => {
    const mission = createTransitionMission(engine);
    engine.transition(mission.id, 'active');
    const result = engine.transition(mission.id, 'completed');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mission.completionBasis).toBe('no-required-checks');
    expect(result.mission.evidence).toEqual([]);
  });

  it('implements pause, resume and cancel with explicit semantics', () => {
    const mission = missionInStatus(engine, 'active');

    const paused = engine.pause(mission.id, { actor: 'operator', reason: 'awaiting review' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.mission.status).toBe('paused');
    expect(paused.mission.lastTransitionReason).toBe('awaiting review');

    const resumed = engine.resume(mission.id);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.mission.status).toBe('active');

    const cancelled = engine.cancel(mission.id, { reason: 'superseded' });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.mission.status).toBe('cancelled');
    expect(engine.transition(mission.id, 'active').ok).toBe(false);
  });
});
