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
 * Strong consistency for writers is provided by `withTransaction(fn)`: call
 * `await store.withTransaction(async () => { store.saveX(...); store.saveY(...)
 * })` to bundle writes into a single atomic transaction. The mirror is updated
 * only after the COMMIT, so a concurrent reader sees either all writes or none.
 */

import { createRequire } from 'node:module';
import type {
  Agent,
  AuditReport,
  CodeEditRecord,
  CodeFixResult,
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
  connect(): Promise<PgClientLike>;
}

/** The subset of `pg.Client` this adapter uses. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
  end(): Promise<void>;
}

/**
 * Shape returned by `pool.connect()`. Most `pg`-compatible drivers expose this
 * shape directly; tests inject their own `FakeClient`.
 */
export interface PgClient extends PgClientLike {}

export interface PostgresStoreConfig {
  /** Postgres connection URL, e.g. `postgres://user:pass@host:5432/db`. */
  connectionString?: string;
  /** Options forwarded to `pg`'s `Pool` when no URL is given. */
  connection?: Record<string, unknown>;
  /** Table holding every document. Defaults to `behavior_os_documents`. */
  table?: string;
  /** Pool factory override (tests / custom drivers). Defaults to loading `pg`. */
  createPool?: (config: PostgresStoreConfig) => Promise<PgPoolLike>;
  /**
   * Module loader override. Defaults to `createRequire(import.meta.url)('pg')`.
   * Tests inject a loader that throws to simulate a project where the optional
   * driver is not installed, without depending on the host's `node_modules`.
   */
  loadPg?: () => { Pool?: new (options: Record<string, unknown>) => PgPoolLike };
}

type Kind =
  | 'mission'
  | 'learning'
  | 'agent'
  | 'audit_report'
  | 'pipeline_run'
  | 'decision'
  | 'code_fix_result'
  | 'code_edit'
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
    if (config.loadPg) {
      pg = config.loadPg();
    } else {
      const require = createRequire(import.meta.url);
      pg = require('pg') as typeof pg;
    }
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

/**
 * Pending write captured inside a {@link PostgresStore.withTransaction}
 * callback. Kept separately from the main `this.queue` so we can replay the
 * mirror atomically after the COMMIT.
 */
interface InflightWrite {
  text: string;
  values: unknown[];
  kind: Kind;
  id: string;
  sortKey: string;
  doc: unknown;
}

export class PostgresStore implements Store {
  private readonly config: PostgresStoreConfig;
  private readonly table: string;
  private pool: PgPoolLike | null = null;
  private readonly docs = new Map<Kind, Map<string, MirrorEntry>>();
  private queue: Promise<void> = Promise.resolve();
  private lastError: unknown = null;
  /** Captured writes for the currently active transaction, if any. */
  private inflight: InflightWrite[] | null = null;

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

  /**
   * Await every queued write; rethrows the first write failure, if any.
   * For atomic multi-write bursts use {@link withTransaction}.
   */
  async flush(): Promise<void> {
    await this.queue;
    if (this.lastError) {
      const error = this.lastError;
      this.lastError = null;
      throw error;
    }
  }

  /**
   * Run a callback as a single transaction. Every write inside the callback is
   * issued as real SQL on the *same* client that ran `BEGIN`, so the database
   * transaction actually holds the rows: the mirror is updated only after the
   * COMMIT, so a concurrent reader sees either all writes or none.
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.ensureConnected().connect();
    this.inflight = [];
    await client.query('BEGIN');
    try {
      // Run the callback so it can buffer writes into `this.inflight`. The
      // database must not see any of them until the whole batch is flushed, so
      // we wait until after `fn()` completes (or fails).
      const result = await fn();
      // Issue every buffered write onto the transaction's client. If any
      // write fails, we roll back immediately — the database never sees a
      // partial batch.
      await this.flushInflightWrites(client);
      await client.query('COMMIT');
      // Replay the captured writes into the mirror now that the transaction
      // is committed. Reads from other clients that have also flushed will
      // see a consistent snapshot.
      this.replayInflightWrites();
      return result;
    } catch (error) {
      // If the callback succeeded but a flush failed (e.g. disk full), the DB
      // may have seen some writes; roll back to keep things consistent.
      await client.query('ROLLBACK').catch(() => undefined);
      this.inflight = null;
      throw error;
    } finally {
      this.inflight = null;
      client.release();
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

  /**
   * Apply the writes captured inside the current transaction to the mirror.
   * Called only after a successful COMMIT so concurrent readers see an atomic
   * snapshot.
   */
  private replayInflightWrites(): void {
    if (!this.inflight) return;
    for (const w of this.inflight) {
      this.mirror(w.kind).set(w.id, { sortKey: w.sortKey, doc: w.doc });
    }
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

  /**
   * Issue every write buffered by the running transaction on the client that
   * owns it. Writes run in call order and are awaited before `COMMIT`; the
   * first failure rejects, which aborts the whole transaction.
   */
  private async flushInflightWrites(client: PgClientLike): Promise<void> {
    if (!this.inflight) return;
    for (const write of this.inflight) {
      await client.query(write.text, write.values);
    }
  }

  /** `INSERT … ON CONFLICT` shared by the immediate and transactional paths. */
  private upsertSql(): string {
    return `INSERT INTO ${this.table} (kind, id, created_at, doc) VALUES ($1, $2, $3, $4)
         ON CONFLICT (kind, id) DO UPDATE SET created_at = excluded.created_at, doc = excluded.doc`;
  }

  private upsert(kind: Kind, id: string, doc: unknown): void {
    const sortKey = this.sortKeyFor(kind, doc);
    const text = this.upsertSql();
    const values = [kind, id, sortKey, JSON.stringify(doc)];
    if (this.inflight) {
      // Inside a transaction: buffer the real write so `withTransaction` can
      // issue it on the transaction's client before COMMIT. The mirror is only
      // updated once that COMMIT succeeds.
      this.inflight.push({ text, values, kind, id, sortKey, doc });
    } else {
      this.mirror(kind).set(id, { sortKey, doc });
      this.enqueue(text, values);
    }
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

  // Code-fix results -------------------------------------------------------
  saveCodeFixResult(result: CodeFixResult): void {
    this.upsert('code_fix_result', result.id, result);
  }

  listCodeFixResults(limit = 50): CodeFixResult[] {
    return this.list<CodeFixResult>('code_fix_result', limit);
  }

  // Governed code edits ----------------------------------------------------
  saveCodeEdit(record: CodeEditRecord): void {
    this.upsert('code_edit', record.id, record);
  }

  listCodeEdits(limit = 50): CodeEditRecord[] {
    return this.list<CodeEditRecord>('code_edit', limit);
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
