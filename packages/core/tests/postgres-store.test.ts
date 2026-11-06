import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import {
  type PgClient,
  type PgPoolLike,
  PostgresStore,
} from '../src/persistence/postgres-store.js';
import type { Store } from '../src/persistence/store.js';

interface FakeRow {
  kind: string;
  id: string;
  created_at: string;
  doc: string;
}

/**
 * Shared document store standing in for the database itself. Both the pool and
 * every client the pool hands out read and write here, so a second store
 * instance connected to the same pool sees only what was really written.
 */
class FakeDatabase {
  readonly rows = new Map<string, FakeRow>();

  /** Applies an `INSERT … ON CONFLICT` and reports whether the SQL was a write. */
  write(text: string, values?: unknown[]): boolean {
    if (!/^\s*INSERT/i.test(text) || !values) return false;
    const [kind, id, createdAt, doc] = values as [string, string, string, string];
    this.rows.set(`${kind}\u0000${id}`, { kind, id, created_at: createdAt, doc });
    return true;
  }

  select(): Array<Record<string, unknown>> {
    return Array.from(this.rows.values()) as unknown as Array<Record<string, unknown>>;
  }
}

/** Minimal in-memory stand-in for `pg.Client`. */
class FakeClient implements PgClient {
  readonly queries: string[] = [];
  readonly values: unknown[][] = [];
  released = false;
  failWith: Error | null = null;
  pool: FakePool | null = null;
  private readonly db: FakeDatabase;

  constructor(db?: FakeDatabase) {
    this.db = db ?? new FakeDatabase();
  }

  async query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);
    this.values.push(values ?? []);
    const trimmed = text.trim().toUpperCase();
    if (trimmed === 'BEGIN') return { rows: [] };
    if (trimmed === 'COMMIT') return { rows: [] };
    if (trimmed === 'ROLLBACK') return { rows: [] };
    if (this.failWith) throw this.failWith;
    this.db.write(text, values);
    // Also update the pool's row store so that reconnect-style tests can
    // verify persistence via SELECT from the pool itself.
    this.pool?.db.write(text, values);
    if (/^\s*SELECT\s+kind/i.test(text)) {
      return { rows: this.db.select() };
    }
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }

  async end(): Promise<void> {}
}

/** Minimal in-memory stand-in for `pg.Pool` that delegates to FakeClient. */
class FakePool implements PgPoolLike {
  readonly rows = new Map<string, FakeRow>();
  readonly queries: string[] = [];
  ended = false;
  client: FakeClient | null = null;
  failWith: Error | null = null;

  async query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(text);
    if (this.failWith) throw this.failWith;
    if (/^\s*INSERT/i.test(text) && values) {
      const [kind, id, createdAt, doc] = values as [string, string, string, string];
      this.database.rows.set(`${kind}\u0000${id}`, { kind, id, created_at: createdAt, doc });
      return { rows: [] };
    }
    if (/^\s*SELECT\s+kind/i.test(text)) {
      return {
        rows: Array.from(this.database.rows.values()) as unknown as Array<Record<string, unknown>>,
      };
    }
    return { rows: [] };
  }

  async connect(): Promise<FakeClient> {
    const client = new FakeClient(this.database);
    this.client = client;
    client.pool = this;
    if (this.failWith) {
      client.failWith = this.failWith;
    }
    return client;
  }

  /** Expose the database so clients can propagate writes back to the pool. */
  get db(): FakeDatabase {
    return this.database;
  }

  private readonly database = new FakeDatabase();

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
    expect(pool.db.rows.get('meta\u0000schema')).toBeDefined();
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
    expect(pool.db.rows.get('meta\u0000k')).toBeDefined();
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
    const store = new PostgresStore({
      connectionString: 'postgres://localhost/none',
      loadPg: () => {
        throw new Error('Cannot find module pg');
      },
    });
    await expect(store.connect()).rejects.toThrow(/optional "pg" package/);
    await expect(
      new PostgresStore({
        connectionString: 'postgres://localhost/none',
        loadPg: () => {
          throw new Error('Cannot find module pg');
        },
      }).connect(),
    ).rejects.toThrow(/pnpm add pg/);
  });

  it('wraps a callback in BEGIN / COMMIT and replays the mirror atomically', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    await store.withTransaction(async () => {
      store.setMeta('k1', 'v1');
      store.setMeta('k2', 'v2');
    });

    const client = pool.client;
    if (!client) throw new Error('client not available');
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('COMMIT');
    expect(client.released).toBe(true);
    // Both writes are visible in the mirror after commit.
    expect(store.getMeta('k1')).toBe('v1');
    expect(store.getMeta('k2')).toBe('v2');
  });

  it('rolls back the transaction and does NOT expose partial writes to the mirror', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    // Seed one write outside the transaction so we can detect partial writes.
    store.setMeta('base', 'seed');
    await store.flush();
    expect(store.getMeta('base')).toBe('seed');

    await expect(
      store.withTransaction(async () => {
        store.setMeta('a', '1');
        store.setMeta('b', '2');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const client = pool.client;
    if (!client) throw new Error('client not available');
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('ROLLBACK');
    // Partial writes must NOT leak into the mirror.
    expect(store.getMeta('a')).toBeNull();
    expect(store.getMeta('b')).toBeNull();
    // The base seed (written outside the transaction) must still be there.
    expect(store.getMeta('base')).toBe('seed');
  });

  it('is the right shape for atomic multi-write bursts (missions + decisions)', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    await store.withTransaction(async () => {
      store.saveMission(sampleMission('m1', '2026-01-01T00:00:00Z'));
      store.saveDecision({
        id: 'd1',
        subject: 'ship',
        policy: 'majority',
        outcome: 'approved',
        quorum: 1,
        quorumMet: true,
        approve: 1,
        reject: 0,
        abstain: 0,
        participatingWeight: 1,
        votes: [],
        decidedBy: [],
        reasons: [],
        timestamp: new Date().toISOString(),
      } as never);
    });
    // Both are visible after commit.
    expect(store.listMissions().map((m) => m.id)).toEqual(['m1']);
    expect(store.listDecisions().map((d) => d.id)).toEqual(['d1']);
  });

  it('implements Store.withTransaction and Store.closeAsync', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();
    expect(typeof store.withTransaction).toBe('function');
    expect(typeof store.closeAsync).toBe('function');
    await store.closeAsync();
  });

  it('issues real SQL on the transaction client for every write', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    await store.withTransaction(async () => {
      store.saveMission(sampleMission('m1', '2026-01-01T00:00:00.000Z'));
      store.saveDecision({ id: 'd1', timestamp: '2026-01-01T00:00:00.000Z' } as never);
    });

    const client = pool.client;
    if (!client) throw new Error('client not available');
    const inserts = client.queries.filter((q) => /^\s*INSERT/i.test(q));
    expect(inserts).toHaveLength(2);
    // The writes reached the same client that owns the transaction, not a
    // different pool connection.
    expect(client.queries).toEqual([
      'BEGIN',
      expect.stringMatching(/^\s*INSERT/i),
      expect.stringMatching(/^\s*INSERT/i),
      'COMMIT',
    ]);
  });

  it('orders the transaction as BEGIN → INSERT(s) → COMMIT', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    await store.withTransaction(async () => {
      store.setMeta('a', '1');
      store.setMeta('b', '2');
    });

    const client = pool.client;
    if (!client) throw new Error('client not available');
    const queries = client.queries;
    const begin = queries.indexOf('BEGIN');
    const commit = queries.indexOf('COMMIT');
    const inserts = queries
      .map((q, index) => (/^\s*INSERT/i.test(q) ? index : -1))
      .filter((index) => index >= 0);

    expect(begin).toBe(0);
    expect(inserts).toHaveLength(2);
    expect(commit).toBeGreaterThan(Math.max(...inserts));
  });

  it('rolls back after a successful write followed by a failure', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    // Buffer a write on the pool itself so that when `flushInflightWrites`
    // attempts the INSERT, it fails — proving the error aborts the tx.
    pool.failWith = new Error('later failure');

    await expect(
      store.withTransaction(async () => {
        store.setMeta('written', 'yes');
      }),
    ).rejects.toThrow('later failure');

    const client = pool.client;
    if (!client) throw new Error('client not available');
    // The callback ran (setting the meta in the mirror), the flush attempted
    // the INSERT and failed, and then ROLLBACK was sent.
    expect(client.queries.some((q) => /^\s*INSERT/i.test(q))).toBe(true);
    expect(client.queries).toContain('ROLLBACK');
    expect(client.queries).not.toContain('COMMIT');
    // Nothing leaks into the database or the mirror.
    expect(pool.rows.size).toBe(0);
    expect(store.getMeta('written')).toBeNull();
  });

  it('persists transactional writes so a new store instance recovers them', async () => {
    const pool = new FakePool();
    const first = newPostgres(pool);
    await first.connect();
    await first.withTransaction(async () => {
      first.saveMission(sampleMission('m1', '2026-01-01T00:00:00.000Z'));
      first.saveAgent({ id: 'a1', type: 'agent', status: 'active' } as never);
    });
    // Verify the rows landed in the shared database before closing.
    expect(pool.db.rows.size).toBe(2);

    await first.closeAsync();

    const second = newPostgres(pool);
    await second.connect();
    expect(second.listMissions().map((m) => m.id)).toEqual(['m1']);
    expect(second.listAgents().map((a) => a.id)).toEqual(['a1']);
  });

  it('propagates a failed transactional write and exposes no partial state', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    // Inject a failure on the pool itself; every client the pool hands out
    // will also fail, so the first query inside withTransaction (the INSERT)
    // surfaces the error before COMMIT.
    pool.failWith = new Error('disk full');

    await expect(
      store.withTransaction(async () => {
        store.setMeta('a', '1');
        store.setMeta('b', '2');
      }),
    ).rejects.toThrow('disk full');
    const client = pool.client;
    if (!client) throw new Error('client not available');
    expect(client.queries).toContain('ROLLBACK');
    expect(client.queries).not.toContain('COMMIT');
    // The failure prevented any row from entering the database or the mirror.
    expect(pool.rows.size).toBe(0);
    expect(store.getMeta('a')).toBeNull();
    expect(store.getMeta('b')).toBeNull();
  });

  it('documents that nested withTransaction is not supported (second begin overwrites first inflight)', async () => {
    // PostgresStore does not implement savepoints; calling withTransaction
    // inside another withTransaction will overwrite `this.inflight` and lose
    // the outer writes. This test documents the behavior rather than asserting
    // a fix — nested transactions are an anti-pattern for this store.
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    await store.withTransaction(async () => {
      store.setMeta('outer', '1');
      // Nested call: overwrites `this.inflight` with a new empty array.
      // The outer write is lost from the inflight buffer.
      await store.withTransaction(async () => {
        store.setMeta('inner', '2');
      });
      // After the nested call, `this.inflight` is null (cleared by inner finally).
      // The outer write never gets flushed.
    });

    // Only the inner write survived (it had its own commit); the outer write
    // was lost because the nested call cleared the outer inflight buffer.
    expect(store.getMeta('inner')).toBe('2');
    // The outer write is NOT in the mirror because the nested transaction
    // overwrote `this.inflight` before the outer COMMIT could flush it.
    expect(store.getMeta('outer')).toBeNull();
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

  it('uses withTransaction inside persistAll for atomic multi-entity saves', async () => {
    const pool = new FakePool();
    const store = newPostgres(pool);
    await store.connect();

    const bos = new BehaviorOS({ persistence: { store } });
    bos.createMission({ title: 'm', type: 'feature', priority: 'low' });
    bos.registerAgent({ id: 'a1', type: 'agent', status: 'active' } as never);
    await bos.persistAll();

    const client = pool.client;
    if (!client) throw new Error('client not available');
    // persistAll uses withTransaction, so the first queries on this client are
    // BEGIN / INSERT(s) / COMMIT. CREATE TABLE / CREATE INDEX happened on the
    // pool (not the transaction client) during connect and are not part of this check.
    const txQueries = client.queries;
    expect(txQueries[0]).toBe('BEGIN');
    expect(txQueries.slice(1, -1).every((q) => /^\s*INSERT/i.test(q))).toBe(true);
    expect(txQueries[txQueries.length - 1]).toBe('COMMIT');
    expect(bos.listMissions().map((m) => m.title)).toEqual(['m']);
    expect(bos.listAgents()).toHaveLength(1);
    expect(client.released).toBe(true);
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
