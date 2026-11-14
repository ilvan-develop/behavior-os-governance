import { z } from 'zod';
import { MissionEvidenceSchema } from './mission.js';

// ============================================================
// Task Orchestration Schemas
// ============================================================

export const TaskStatusSchema = z.enum([
  'pending',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

export const TaskErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'INVALID_OUTPUT',
  'AGENT_NOT_FOUND',
  'ADAPTER_NOT_FOUND',
  'DNA_NOT_FOUND',
  'GOVERNANCE_DENIED',
  'APPROVAL_REQUIRED',
  'TIMEOUT',
  'CANCELLED',
  'RETRY_EXHAUSTED',
  'LOOP_DETECTED',
  'CIRCUIT_OPEN',
  'DEPENDENCY_BLOCKED',
  'ACCEPTANCE_FAILED',
  'EXECUTION_FAILED',
  'PERSISTENCE_FAILED',
]);

/** One machine-checkable acceptance criterion for a task. */
export const TaskAcceptanceSchema = z.object({
  gate: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['exit-code', 'stdout-contains', 'stdout-matches', 'stderr-not-contains']),
  /** Expected value: exit code (default `0`), stdout text/pattern, or stderr text. */
  expected: z.string().optional(),
  /** Only required criteria gate task success. Defaults to `true`. */
  required: z.boolean().default(true),
});

export const TaskCheckResultSchema = z.object({
  gate: z.string(),
  type: TaskAcceptanceSchema.shape.type,
  required: z.boolean(),
  passed: z.boolean(),
  detail: z.string(),
});

/** A dispatched, fully identified task. */
export const TaskDefinitionSchema = z.object({
  id: z.string().min(1),
  missionId: z.string().min(1),
  parentTaskId: z.string().min(1).optional(),
  /** Tasks that must complete before this task is eligible. */
  dependsOn: z.array(z.string().min(1)).optional(),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  type: z.string().min(1),
  objective: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  acceptance: z.array(TaskAcceptanceSchema).min(1),
  agentId: z.string().min(1),
  adapter: z.string().min(1),
  status: TaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
  deadline: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Structured, classified task failure. */
export const TaskErrorSchema = z.object({
  code: TaskErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  /** Deterministic signature used for repeated-failure/loop detection. */
  fingerprint: z.string().optional(),
});

/**
 * The raw result an execution adapter returns. It is **untrusted** until the
 * orchestrator validates it with this schema.
 */
export const AdapterResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TaskResultSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  status: TaskStatusSchema,
  agentId: z.string(),
  adapter: z.string(),
  attempts: z.number().int().nonnegative(),
  correlationId: z.string(),
  idempotencyKey: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  exitCode: z.number().int().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  acceptance: z.array(TaskCheckResultSchema),
  evidence: z.array(MissionEvidenceSchema),
  error: TaskErrorSchema.optional(),
});

export const TaskEventTypeSchema = z.enum([
  'mission.created',
  'mission.completed',
  'mission.failed',
  'mission.cancelled',
  'mission.blocked',
  'task.created',
  'task.dispatched',
  'task.started',
  'task.retried',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.blocked',
]);

/** Correlated lifecycle event. Payloads never contain stdout/stderr or env. */
export const TaskEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: TaskEventTypeSchema,
  missionId: z.string(),
  taskId: z.string().optional(),
  correlationId: z.string(),
  at: z.string(),
  data: z.record(z.string(), z.unknown()),
});

// ============================================================
// Type exports
// ============================================================

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskErrorCode = z.infer<typeof TaskErrorCodeSchema>;
export type TaskAcceptance = z.infer<typeof TaskAcceptanceSchema>;
export type TaskCheckResult = z.infer<typeof TaskCheckResultSchema>;
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;
export type TaskError = z.infer<typeof TaskErrorSchema>;
export type AdapterResult = z.infer<typeof AdapterResultSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
