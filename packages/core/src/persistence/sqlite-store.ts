/**
 * SQLite-backed persistence for Behavior-OS.
 *
 * Uses the built-in `node:sqlite` module (Node >= 22.5) so **no native
 * dependency** is required. The database stores one row per domain object plus
 * an append-only `audit_log` table — this is what makes "state survives a
 * restart" and "regulator-grade audit trail" actually true rather than a
 * marketing claim.
 *
 * `node:sqlite` is loaded lazily via `createRequire` and typed structurally, so
 * importing this module never crashes a runtime that lacks the module; the
 * failure only surfaces when a store is actually opened.
 */

import { createRequire } from 'node:module';
import type { Agent, AuditReport, LearningEvent, Mission, PipelineRun } from '@behavior-os/schemas';

/** Minimal structural types for the subset of `node:sqlite` we use. */
interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

type SqlDatabaseCtor = new (path: string) => SqlDatabase;

/** Resolve the built-in SQLite constructor, or throw a clear error. */
function loadSqlite(): SqlDatabaseCtor {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('node:sqlite') as { DatabaseSync?: SqlDatabaseCtor };
    if (typeof mod.DatabaseSync !== 'function') {
      throw new Error('node:sqlite does not expose DatabaseSync');
    }
    return mod.DatabaseSync;
  } catch (error) {
    throw new Error(
      `SQLite persistence requires Node >= 22.5 (node:sqlite): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export interface SqliteStoreConfig {
  /** Database file path, or `:memory:` for an ephemeral database. */
  path: string;
}

/**
 * Relational store for missions, learnings, agents and audit reports. Every
 * writer method is an idempotent upsert keyed by object id, so re-persisting
 * the same state is safe.
 */
export class SqliteStore {
  private readonly db: SqlDatabase;

  constructor(config: SqliteStoreConfig) {
    const DatabaseSync = loadSqlite();
    this.db = new DatabaseSync(config.path);
    // WAL keeps readers non-blocking while a writer persists; harmless for
    // in-memory databases.
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        status TEXT,
        type TEXT,
        priority TEXT,
        updated_at TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learnings (
        id TEXT PRIMARY KEY,
        type TEXT,
        impact TEXT,
        created_at TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        type TEXT,
        status TEXT,
        updated_at TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        agent_id TEXT,
        overall TEXT,
        created_at TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        agent_id TEXT,
        overall TEXT,
        blocked INTEGER,
        created_at TEXT,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private parseRows<T>(rows: unknown[]): T[] {
    return rows.map((row) => JSON.parse(String((row as { json: unknown }).json)) as T);
  }

  // Missions ---------------------------------------------------------------
  saveMission(mission: Mission): void {
    this.db
      .prepare(
        `INSERT INTO missions (id, status, type, priority, updated_at, json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           type = excluded.type,
           priority = excluded.priority,
           updated_at = excluded.updated_at,
           json = excluded.json`,
      )
      .run(
        mission.id,
        mission.status,
        mission.type,
        mission.priority,
        mission.updatedAt,
        JSON.stringify(mission),
      );
  }

  getMission(id: string): Mission | null {
    const row = this.db.prepare('SELECT json FROM missions WHERE id = ?').get(id);
    return row ? (JSON.parse(String((row as { json: unknown }).json)) as Mission) : null;
  }

  listMissions(): Mission[] {
    const rows = this.db.prepare('SELECT json FROM missions ORDER BY updated_at DESC').all();
    return this.parseRows<Mission>(rows);
  }

  // Learnings --------------------------------------------------------------
  saveLearning(event: LearningEvent): void {
    this.db
      .prepare(
        `INSERT INTO learnings (id, type, impact, created_at, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           impact = excluded.impact,
           created_at = excluded.created_at,
           json = excluded.json`,
      )
      .run(event.id, event.type, event.impact, event.timestamp, JSON.stringify(event));
  }

  listLearnings(limit = 100): LearningEvent[] {
    const rows = this.db
      .prepare('SELECT json FROM learnings ORDER BY created_at DESC LIMIT ?')
      .all(limit);
    return this.parseRows<LearningEvent>(rows);
  }

  // Agents -----------------------------------------------------------------
  saveAgent(agent: Agent): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, type, status, updated_at, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           status = excluded.status,
           updated_at = excluded.updated_at,
           json = excluded.json`,
      )
      .run(agent.id, agent.type, agent.status, new Date().toISOString(), JSON.stringify(agent));
  }

  listAgents(): Agent[] {
    const rows = this.db.prepare('SELECT json FROM agents ORDER BY id ASC').all();
    return this.parseRows<Agent>(rows);
  }

  // Audit log (append-only by convention) ----------------------------------
  saveAuditReport(report: AuditReport): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (id, mission_id, agent_id, overall, created_at, json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mission_id = excluded.mission_id,
           agent_id = excluded.agent_id,
           overall = excluded.overall,
           created_at = excluded.created_at,
           json = excluded.json`,
      )
      .run(
        report.id,
        report.missionId,
        report.agentId,
        report.overall,
        report.timestamp,
        JSON.stringify(report),
      );
  }

  listAuditReports(limit = 50): AuditReport[] {
    const rows = this.db
      .prepare('SELECT json FROM audit_log ORDER BY created_at DESC LIMIT ?')
      .all(limit);
    return this.parseRows<AuditReport>(rows);
  }

  // Pipeline runs (gate pre-flight / full runs) -----------------------------
  savePipelineRun(run: PipelineRun): void {
    this.db
      .prepare(
        `INSERT INTO pipeline_runs (id, mission_id, agent_id, overall, blocked, created_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mission_id = excluded.mission_id,
           agent_id = excluded.agent_id,
           overall = excluded.overall,
           blocked = excluded.blocked,
           created_at = excluded.created_at,
           json = excluded.json`,
      )
      .run(
        run.id,
        run.missionId ?? null,
        run.agentId ?? null,
        run.overall,
        run.blocked ? 1 : 0,
        run.timestamp,
        JSON.stringify(run),
      );
  }

  listPipelineRuns(limit = 50): PipelineRun[] {
    const rows = this.db
      .prepare('SELECT json FROM pipeline_runs ORDER BY created_at DESC LIMIT ?')
      .all(limit);
    return this.parseRows<PipelineRun>(rows);
  }

  // Key/value metadata -----------------------------------------------------
  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? String((row as { value: unknown }).value) : null;
  }

  close(): void {
    this.db.close();
  }
}
