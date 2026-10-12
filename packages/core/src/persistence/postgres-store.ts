/**
 * Optional Postgres-backed persistence for Behavior-OS.
 *
 * `pg` is deliberately **not** a dependency of this package: it is resolved with
 * `createRequire` only when the store connects, so projects that only use SQLite
 * never install a driver. If `pg` is missing, `connect()` throws an actionable
 * error (or you can inject your own pool via `createPool`).
 *
 * `Store` is synchronous while Postgres is not, so this adapter keeps an
 * in-memory mirror:
 *  - reads are served from the mirror loaded at `connect()`;
 *  - writes update the mirror and are written through asynchronously.
 * Call `await flush()` to drain the write queue (and surface any write error);
 * `await closeAsync()` flushes and ends the pool.
 *
 * This is therefore **not** a strongly-consistent multi-writer store: two
 * processes reading concurrently can observe stale data. Use `flush()` before
 * relying on another reader seeing a write.
 */

import { createRequire } from 'node:module';
import type {
  Agent,
  AuditReport,
  Decision,
  LearningEvent,
  Mission,
  PipelineRun,
} from '@behavior-os/schemas';
import type { Store } from './store.js';

/** The subset of `pg.Pool` this adapter uses. */
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export interface PostgresStoreConfig {
  /** Postgres connection URL, e.g. `postgres://user:pass@host:5432/db`. */
  connectionString?: string;
  /** Options forwarded to `pg`'s `Pool` when no URL is given. */
  connection?: Record<string, unknown>;
  /** Table holding every document. Defaults to `behavior_os_documents`. */
  table?: string;
  /** Pool factory override (tests / custom drivers). Defaults to loading `pg`. */
  createPool?: (config: PostgresStoreConfig) => Promise<PgPoolLike>;
}

type Kind =
  | 'mission'
  | 'learning'
  | 'agent'
  | 'audit_report'
  | 'pipeline_run'
  | 'decision'
  | 'meta';

interface MirrorEntry {
  sortKey: string;
  doc: unknown;
}

const TABLE_PATTERN = /^[a-z_][a-z0-9_]*$/i;

/** Resolve `pg` at runtime so the package has no hard dependency on it. */
async function defaultCreatePool(config: PostgresStoreConfig): Promise<PgPoolLike> {
  let pg: { Pool?: new (options: Record<string, unknown>) => PgPoolLike };
  try {
    const require = createRequire(import.meta.url);
    pg = require('pg') as typeof pg;
  } catch (error) {
    throw new Error(
      `PostgresStore requires the optional "pg" package (pnpm add pg), or pass createPool. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (typeof pg.Pool !== 'function') {
    throw new Error('The installed "pg" package does not expose Pool');
  }
  const options = config.connectionString
    ? { connectionString: config.connectionString }
    : { ...(config.connection ?? {}) };
  return new pg.Pool(options);
}

export class PostgresStore implements Store {
  private readonly config: PostgresStoreConfig;
  private readonly table: string;
  private pool: PgPoolLike | null = null;
  private readonly docs = new Map<Kind, Map<string, MirrorEntry>>();
  private queue: Promise<void> = Promise.resolve();
  private lastError: unknown = null;

  constructor(config: PostgresStoreConfig = {}) {
    this.config = config;
    this.table = config.table ?? 'behavior_os_documents';
    if (!TABLE_PATTERN.test(this.table)) {
      throw new Error(`Invalid Postgres table name: ${this.table}`);
    }
  }

  /** Connect, create the table/index and load every document into the mirror. */
  async connect(): Promise<void> {
    if (this.pool) return;
    const pool = await (this.config.createPool ?? defaultCreatePool)(this.config);
    this.pool = pool;

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL,
         doc JSONB NOT NULL,
         PRIMARY KEY (kind, id)
       )`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${this.table}_kind_created_idx
         ON ${this.table} (kind, created_at DESC)`,
    );

    const result = await pool.query(`SELECT kind, id, created_at, doc FROM ${this.table}`);
    for (const row of result.rows) {
      const kind = row.kind as Kind;
      const doc = typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc;
      this.mirror(kind).set(String(row.id), { sortKey: this.sortKeyFor(kind, doc), doc });
    }
  }

  /** Await every queued write; rethrows the first write failure, if any. */
  async flush(): Promise<void> {
    await this.queue;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
  }

  /** Flush pending writes and close the pool. */
  async closeAsync(): Promise<void> {
    await this.flush();
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.end();
  }

  // Mirror plumbing --------------------------------------------------------
  private mirror(kind: Kind): Map<string, MirrorEntry> {
    let bucket = this.docs.get(kind);
    if (!bucket) {
      bucket = new Map<string, MirrorEntry>();
      this.docs.set(kind, bucket);
    }
    return bucket;
  }

  private ensureConnected(): PgPoolLike {
    if (!this.pool) {
      throw new Error('PostgresStore is not connected: await store.connect() first.');
    }
    return this.pool;
  }

  private enqueue(text: string, values: unknown[]): void {
    this.queue = this.queue.then(async () => {
      if (this.lastError) return; // stop at the first failure; flush() reports it
      try {
        await this.ensureConnected().query(text, values);
      } catch (error) {
        this.lastError = error;
      }
    });
  }

  private upsert(kind: Kind, id: string, doc: unknown): void {
    const sortKey = this.sortKeyFor(kind, doc);
    this.mirror(kind).set(id, { sortKey, doc });
    this.enqueue(
      `INSERT INTO ${this.table} (kind, id, created_at, doc) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, id) DO UPDATE SET created_at = excluded.created_at, doc = excluded.doc`,
      [kind, id, sortKey, JSON.stringify(doc)],
    );
  }

  private sortKeyFor(kind: Kind, doc: unknown): string {
    const record = (doc ?? {}) as Record<string, unknown>;
    switch (kind) {
      case 'mission':
        return String(record.updatedAt ?? '');
      case 'agent':
        return String(record.id ?? '');
      case 'meta':
        return new Date().toISOString();
      default:
        return String(record.timestamp ?? '');
    }
  }

  private list<T>(kind: Kind, limit = 0, order: 'asc' | 'desc' = 'desc'): T[] {
    const entries = Array.from(this.mirror(kind).values());
    entries.sort((a, b) =>
      order === 'asc' ? a.sortKey.localeCompare(b.sortKey) : b.sortKey.localeCompare(a.sortKey),
    );
    const sliced = limit > 0 ? entries.slice(0, limit) : entries;
    return sliced.map((entry) => entry.doc as T);
  }

  // Missions ---------------------------------------------------------------
  saveMission(mission: Mission): void {
    this.upsert('mission', mission.id, mission);
  }

  getMission(id: string): Mission | null {
    return (this.mirror('mission').get(id)?.doc as Mission | undefined) ?? null;
  }

  listMissions(): Mission[] {
    return this.list<Mission>('mission');
  }

  // Learnings --------------------------------------------------------------
  saveLearning(event: LearningEvent): void {
    this.upsert('learning', event.id, event);
  }

  listLearnings(limit = 100): LearningEvent[] {
    return this.list<LearningEvent>('learning', limit);
  }

  // Agents -----------------------------------------------------------------
  saveAgent(agent: Agent): void {
    this.upsert('agent', agent.id, agent);
  }

  listAgents(): Agent[] {
    return this.list<Agent>('agent', 0, 'asc');
  }

  // Audit reports ----------------------------------------------------------
  saveAuditReport(report: AuditReport): void {
    this.upsert('audit_report', report.id, report);
  }

  listAuditReports(limit = 50): AuditReport[] {
    return this.list<AuditReport>('audit_report', limit);
  }

  // Gate-pipeline runs -----------------------------------------------------
  savePipelineRun(run: PipelineRun): void {
    this.upsert('pipeline_run', run.id, run);
  }

  listPipelineRuns(limit = 50): PipelineRun[] {
    return this.list<PipelineRun>('pipeline_run', limit);
  }

  // Voting/quorum decisions ------------------------------------------------
  saveDecision(decision: Decision): void {
    this.upsert('decision', decision.id, decision);
  }

  listDecisions(limit = 50): Decision[] {
    return this.list<Decision>('decision', limit);
  }

  // Key/value metadata -----------------------------------------------------
  setMeta(key: string, value: string): void {
    this.upsert('meta', key, { key, value });
  }

  getMeta(key: string): string | null {
    const doc = this.mirror('meta').get(key)?.doc as { value?: unknown } | undefined;
    return doc && doc.value !== undefined ? String(doc.value) : null;
  }

  /** Sync close: drains the queue in the background. Prefer `closeAsync()`. */
  close(): void {
    void this.closeAsync().catch(() => undefined);
  }
}
