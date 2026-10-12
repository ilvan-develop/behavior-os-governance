/**
 * Persistence contract for Behavior-OS.
 *
 * Every store implementation (`SqliteStore`, `PostgresStore`, or a host's own
 * adapter) exposes this synchronous surface, so `BehaviorOS` never depends on a
 * concrete database. Methods are idempotent upserts keyed by object id.
 */

import type {
  Agent,
  AuditReport,
  Decision,
  LearningEvent,
  Mission,
  PipelineRun,
} from '@behavior-os/schemas';

export interface Store {
  // Missions
  saveMission(mission: Mission): void;
  getMission(id: string): Mission | null;
  listMissions(): Mission[];

  // Learnings
  saveLearning(event: LearningEvent): void;
  listLearnings(limit?: number): LearningEvent[];

  // Agents
  saveAgent(agent: Agent): void;
  listAgents(): Agent[];

  // Audit reports
  saveAuditReport(report: AuditReport): void;
  listAuditReports(limit?: number): AuditReport[];

  // Gate-pipeline runs
  savePipelineRun(run: PipelineRun): void;
  listPipelineRuns(limit?: number): PipelineRun[];

  // Voting/quorum decisions
  saveDecision(decision: Decision): void;
  listDecisions(limit?: number): Decision[];

  // Key/value metadata
  setMeta(key: string, value: string): void;
  getMeta(key: string): string | null;

  /** Close any underlying resources. Synchronous for SQLite; may be async-only
   *  for stores backed by connection pools — callers can also use `closeAsync`. */
  close(): void;

  /**
   * Run an asynchronous callback as a single unit of work. Store
   * implementations may bundle multiple mutations across this callback into a
   * single database transaction (e.g. `BEGIN` / `COMMIT`).
   *
   * This is what makes Postgres `PostgresStore` **strongly consistent** for
   * writers: callers batch writes into `withTransaction` so a concurrent
   * reader will see either all of them or none.
   */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Drain pending writes and close resources (preferred over `close()` for
   * async-capable stores). */
  closeAsync(): Promise<void>;
}
