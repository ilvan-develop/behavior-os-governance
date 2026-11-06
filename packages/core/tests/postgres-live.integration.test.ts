import type { LearningEvent, Mission } from '@behavior-os/schemas';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/persistence/postgres-store.js';

/**
 * Live PostgreSQL integration test.
 *
 * Skipped unless `BEHAVIOROS_POSTGRES_LIVE=1` and `BEHAVIOROS_POSTGRES_URL` are
 * set. It requires a real server; no Docker or mocks. This is the evidence that
 * closes the former "PostgreSQL BLOCKED" item: every assertion reads back from
 * the database with raw SQL, so a broken mirror cannot fake a pass.
 */
const live = process.env.BEHAVIOROS_POSTGRES_LIVE === '1';
const connectionString = process.env.BEHAVIOROS_POSTGRES_URL ?? '';
const TABLE = 'behavior_os_live_docs';

const describeLive = live && connectionString ? describe : describe.skip;

function mission(id: string, at: string): Mission {
  return {
    id,
    title: `Live mission ${id}`,
    type: 'audit',
    priority: 'high',
    status: 'active',
    dnaPattern: 'lean-factory',
    createdBy: 'agent-audit',
    createdAt: at,
    updatedAt: at,
    progress: 0,
  };
}

function learning(id: string, missionId: string, at: string): LearningEvent {
  return {
    id,
    type: 'insight',
    source: 'live-postgres-test',
    content: 'proved with a real PostgreSQL server',
    impact: 'low',
    relatedMission: missionId,
    timestamp: at,
  };
}

function newStore(): PostgresStore {
  return new PostgresStore({ connectionString, table: TABLE });
}

async function countRows(kind: string, id?: string): Promise<number> {
  const pool = new Pool({ connectionString });
  try {
    const result = id
      ? await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${TABLE} WHERE kind = $1 AND id = $2`,
          [kind, id],
        )
      : await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${TABLE} WHERE kind = $1`,
          [kind],
        );
    return Number(result.rows[0]?.count ?? '0');
  } finally {
    await pool.end();
  }
}

describeLive('PostgresStore (live server)', () => {
  beforeAll(async () => {
    const pool = new Pool({ connectionString });
    try {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    } finally {
      await pool.end();
    }
  });

  afterAll(async () => {
    const pool = new Pool({ connectionString });
    try {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    } finally {
      await pool.end();
    }
  });

  it('creates the schema and writes documents that are visible in raw SQL', async () => {
    const total = new Date().toISOString();
    const store = newStore();
    await store.connect();
    try {
      store.saveMission(mission('live-m1', total));
      store.saveLearning(learning('live-l1', 'live-m1', total));
      store.setMeta('live-key', 'live-value');
      await store.flush();

      expect(store.getMission('live-m1')?.id).toBe('live-m1');
      expect(store.listLearnings(10).map((entry) => entry.id)).toContain('live-l1');
      expect(store.getMeta('live-key')).toBe('live-value');

      // Raw SQL: proves the rows exist in PostgreSQL, not only in the mirror.
      expect(await countRows('mission', 'live-m1')).toBe(1);
      expect(await countRows('learning', 'live-l1')).toBe(1);
      expect(await countRows('meta', 'live-key')).toBe(1);
    } finally {
      await store.closeAsync();
    }
  });

  it('commits a multi-write transaction atomically and survives a reconnect', async () => {
    const total = new Date().toISOString();
    const store = newStore();
    await store.connect();
    try {
      await store.withTransaction(async () => {
        store.saveMission(mission('live-m2', total));
        store.saveLearning(learning('live-l2', 'live-m2', total));
      });
    } finally {
      await store.closeAsync();
    }

    expect(await countRows('mission', 'live-m2')).toBe(1);
    expect(await countRows('learning', 'live-l2')).toBe(1);

    // A brand-new store loads the mirror from the server at connect().
    const reopened = newStore();
    await reopened.connect();
    try {
      expect(reopened.getMission('live-m2')?.id).toBe('live-m2');
      expect(reopened.listLearnings(10).map((entry) => entry.id)).toContain('live-l2');
    } finally {
      await reopened.closeAsync();
    }
  });

  it('rolls back the whole transaction when the callback throws', async () => {
    const total = new Date().toISOString();
    const store = newStore();
    await store.connect();
    try {
      await expect(
        store.withTransaction(async () => {
          store.saveMission(mission('live-m3', total));
          store.saveLearning(learning('live-l3', 'live-m3', total));
          throw new Error('rollback-probe');
        }),
      ).rejects.toThrow('rollback-probe');
    } finally {
      await store.closeAsync();
    }

    expect(await countRows('mission', 'live-m3')).toBe(0);
    expect(await countRows('learning', 'live-l3')).toBe(0);
  });
});
