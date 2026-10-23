import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/index.js';
import { SqliteStore } from '../src/persistence/sqlite-store.js';

describe('SqliteStore', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-sqlite-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips each entity type and survives a reopen', () => {
    const store = new SqliteStore({ path: dbPath });
    store.saveMission({
      id: 'm1',
      title: 'Ship it',
      type: 'feature',
      priority: 'high',
      status: 'active',
      dnaPattern: 'enterprise-governance',
      createdBy: 'agent-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      progress: 0,
    });
    store.saveLearning({
      id: 'l1',
      type: 'fix',
      source: 'tests',
      content: 'fixed a bug',
      impact: 'high',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    store.saveAgent({
      id: 'agent-1',
      name: 'Dev',
      type: 'developer',
      status: 'idle',
      dnaPattern: 'enterprise-governance',
      capabilities: [],
      currentMission: null,
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 },
    });
    store.saveAuditReport({
      id: 'audit-1',
      missionId: 'm1',
      agentId: 'agent-1',
      stages: [],
      overall: 'pass',
      summary: '0 passed',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    store.close();

    const reopened = new SqliteStore({ path: dbPath });
    expect(reopened.getMission('m1')?.title).toBe('Ship it');
    expect(reopened.listMissions()).toHaveLength(1);
    expect(reopened.listLearnings()).toHaveLength(1);
    expect(reopened.listAgents()[0]?.name).toBe('Dev');
    expect(reopened.listAuditReports()[0]?.overall).toBe('pass');
    reopened.close();
  });

  it('upserts by id instead of duplicating rows', () => {
    const store = new SqliteStore({ path: dbPath });
    const base = {
      id: 'm1',
      title: 'first',
      type: 'feature' as const,
      priority: 'high' as const,
      status: 'pending' as const,
      dnaPattern: 'x',
      createdBy: 'a',
      createdAt: 'now',
      updatedAt: 'now',
      progress: 0,
    };
    store.saveMission(base);
    store.saveMission({ ...base, title: 'second', status: 'active' });
    expect(store.listMissions()).toHaveLength(1);
    expect(store.getMission('m1')?.title).toBe('second');
    store.close();
  });

  it('stores and reads key/value metadata', () => {
    const store = new SqliteStore({ path: dbPath });
    store.setMeta('schema', '1');
    store.setMeta('schema', '2');
    expect(store.getMeta('schema')).toBe('2');
    expect(store.getMeta('missing')).toBeNull();
    store.close();
  });

  it('closes the database handle when migration fails', () => {
    writeFileSync(dbPath, 'not a sqlite database');

    expect(() => new SqliteStore({ path: dbPath })).toThrow();

    // Windows refuses to remove a file while a handle is still open, so this
    // assertion fails if the failed constructor leaked the connection.
    expect(() => rmSync(dbPath, { force: true })).not.toThrow();
  });
});

describe('BehaviorOS SQLite persistence', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-sqlite-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists and hydrates state across engine instances (restart)', async () => {
    const first = new BehaviorOS({ persistence: { path: dbPath } });
    const mission = first.createMission({
      title: 'Persist me',
      type: 'feature',
      priority: 'high',
    });
    first.recordLearning({ type: 'fix', source: 'test', content: 'kept', impact: 'high' });
    first.registerAgent({
      id: 'agent-1',
      name: 'Dev',
      type: 'developer',
      status: 'idle',
      dnaPattern: 'enterprise-governance',
      capabilities: [],
      currentMission: null,
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 },
    });
    await first.runAudit({ missionId: mission.id, agentId: 'agent-1' });

    expect(first.hasPersistence()).toBe(true);
    expect(first.listAuditReports()).toHaveLength(1);
    first.closeStore();

    const second = new BehaviorOS({ persistence: { path: dbPath } });
    expect(second.getMission(mission.id)?.title).toBe('Persist me');
    expect(second.listMissions()).toHaveLength(1);
    expect(second.getInsights(10).length).toBeGreaterThanOrEqual(1);
    expect(second.getAgent('agent-1')?.name).toBe('Dev');
    expect(second.listAuditReports()).toHaveLength(1);
    second.closeStore();
  });

  it('runs in memory without a store, and survives an unusable path', () => {
    const plain = new BehaviorOS();
    expect(plain.hasPersistence()).toBe(false);
    expect(plain.createMission({ title: 'x', type: 'feature', priority: 'low' }).id).toBeDefined();

    const broken = new BehaviorOS({ persistence: { path: join(dir, 'nope', 'x.db') } });
    expect(broken.hasPersistence()).toBe(false);
    expect(broken.createMission({ title: 'y', type: 'bugfix', priority: 'low' }).id).toBeDefined();
  });
});
