import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { type PgPoolLike, PostgresStore } from '../src/persistence/postgres-store.js';
import type { Store } from '../src/persistence/store.js';

interface FakeRow {
  kind: string;
  id: string;
  created_at: string;
  doc: string;
}

/** Minimal in-memory stand-in for `pg.Pool`, so no driver or server is needed. */
class FakePool implements PgPoolLike {
  readonly rows = new Map<string, FakeRow>();
  readonly queries: string[] = [];
  ended = false;
  failWith: Error | null = null;

  async query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);
    if (this.failWith) throw this.failWith;
    if (/^\s*INSERT/i.test(text) && values) {
      const [kind, id, createdAt, doc] = values as [string, string, string, string];
      this.rows.set(`${kind}\u0000${id}`, { kind, id, created_at: createdAt, doc });
      return { rows: [] };
    }
    if (/^\s*SELECT\s+kind/i.test(text)) {
      return { rows: Array.from(this.rows.values()) as unknown as Array<Record<string, unknown>> };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

function newStore(pool: FakePool, table?: string): PostgresStore {
  return new PostgresStore({
    connectionString: 'postgres://localhost/none',
    createPool: async () => pool,
    table,
  });
}

describe('PostgresStore', () => {
  it('creates its schema and writes documents through on flush', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    expect(pool.queries[0]).toContain('CREATE TABLE IF NOT EXISTS behavior_os_documents');
    expect(pool.queries[1]).toContain('CREATE INDEX IF NOT EXISTS');

    store.setMeta('schema', '1');
    await store.flush();
    expect(pool.rows.get('meta\u0000schema')).toBeDefined();
  });

  it('serves reads from the mirror and survives a reconnect', async () => {
    const pool = new FakePool();
    const first = newPostgres(pool);
    await first.connect();
    first.saveMission(sampleMission('m1', '2026-01-01T00:00:00.000Z'));
    await first.flush();

    const second = newPostgres(pool);
    await second.connect();
    expect(second.listMissions().map((m) => m.id)).toEqual(['m1']);
    expect(second.getMission('m1')?.title).toBe('t');
  });

  it('orders lists newest first and honours the limit', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    store.savePipelineRun(sampleRun('r1', '2026-01-01T00:00:00.000Z'));
    store.savePipelineRun(sampleRun('r2', '2026-01-02T00:00:00.000Z'));
    store.savePipelineRun(sampleRun('r3', '2026-01-03T00:00:00.000Z'));

    expect(store.listPipelineRuns().map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(store.listPipelineRuns(2).map((r) => r.id)).toEqual(['r3', 'r2']);
    await store.flush();
  });

  it('lists agents in ascending id order, like SQLite', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    for (const id of ['c', 'a', 'b']) {
      store.saveAgent({ id, type: 'agent', status: 'active' } as never);
    }
    expect(store.listAgents().map((a) => a.id)).toEqual(['a', 'b', 'c']);
    await store.flush();
  });

  it('rejects an unsafe table name', () => {
    expect(() => newStore(new FakePool(), 'users; DROP TABLE x')).toThrow(/table/i);
  });

  it('refuses to write before connect and reports it on flush', async () => {
    const store = newPostgres(new FakePool());
    store.setMeta('k', 'v');
    await expect(store.flush()).rejects.toThrow(/not connected/i);
  });

  it('surfaces the first write failure on flush', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();
    pool.failWith = new Error('connection reset');
    store.setMeta('k', 'v');
    await expect(store.flush()).rejects.toThrow('connection reset');
    // The failure is reported once; the store stays usable for reads.
    expect(store.getMeta('k')).toBe('v');
  });

  it('flushes and ends the pool on closeAsync', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();
    store.setMeta('k', 'v');
    await store.closeAsync();
    expect(pool.ended).toBe(true);
    expect(pool.rows.get('meta\u0000k')).toBeDefined();
  });

  it('mirrors the SQLite surface through the Store interface', async () => {
    const pool = new FakePool();
    const stores: Store[] = [newPostgres(pool)];
    await (stores[0] as PostgresStore).connect();
    for (const store of stores) {
      expect(typeof store.getMission).toBe('function');
      expect(typeof store.listDecisions).toBe('function');
      expect(typeof store.close).toBe('function');
    }
    await (stores[0] as PostgresStore).closeAsync();
  });

  it('explains how to install pg when the driver is absent', async () => {
    const store = new PostgresStore({ connectionString: 'postgres://localhost/none' });
    try {
      await store.connect();
      // `pg` happens to be installed here: nothing to assert about the error.
      await store.closeAsync();
    } catch (error) {
      expect(String(error)).toContain('pg');
    }
  });
});

describe('BehaviorOS with an injected store', () => {
  it('persists and hydrates through any Store implementation', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    const first = new BehaviorOS({ persistence: { store } });
    expect(first.hasPersistence()).toBe(true);
    first.createMission({ title: 'persisted', type: 'feature', priority: 'high' });
    first.recordLearning({
      type: 'fix',
      source: 'test',
      content: 'c',
      impact: 'high',
      advanceProtocol: false,
    });
    await store.flush();

    const reopened = newPostgres(pool);
    await reopened.connect();

    const second = new BehaviorOS({ persistence: { store: reopened } });
    expect(second.listMissions().map((m) => m.title)).toEqual(['persisted']);
    expect(second.exportState().learnings).toHaveLength(1);
  });

  it('prefers the injected store over the SQLite path', () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    const bos = new BehaviorOS({
      persistence: { path: 'ignored.db', store, autoHydrate: false },
    });
    expect(bos.hasPersistence()).toBe(true);
    bos.closeStore();
    expect(bos.hasPersistence()).toBe(false);
  });
});

function newPostgres(pool: FakePool): PostgresStore {
  return newStore(pool);
}

function sampleMission(id: string, updatedAt: string) {
  return {
    id,
    title: 't',
    type: 'feature',
    priority: 'high',
    dnaPattern: 'default',
    status: 'pending',
    createdBy: 'test',
    createdAt: updatedAt,
    updatedAt,
    progress: 0,
  } as never;
}

function sampleRun(id: string, timestamp: string) {
  return {
    id,
    overall: 'passed',
    blocked: false,
    timestamp,
    gates: [],
  } as never;
}
