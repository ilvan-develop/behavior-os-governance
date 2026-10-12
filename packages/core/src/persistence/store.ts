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

  close(): void;
}
