import { z } from 'zod';

// ============================================================
// Mission Schemas
// ============================================================

export const MissionTypeSchema = z.enum([
  'feature',
  'bugfix',
  'deployment',
  'research',
  'refactor',
  'audit',
  'incident',
]);

export const MissionPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const MissionStatusSchema = z.enum([
  'pending',
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Where evidence came from.
 *
 * - `executed` — a real command/adapter ran and produced this record.
 * - `reported` — a caller or agent asserted the result without execution.
 * - `simulated` — the check was simulated (never a verification).
 */
export const EvidenceProvenanceSchema = z.enum(['executed', 'reported', 'simulated']);

/**
 * Evidence attached to a mission transition. `simulated: true` marks a value
 * produced without executing the check (for example a simulated audit); such
 * evidence can be recorded but never authorizes completion of a required gate.
 *
 * `provenance` and `executionId` are what let a mission in
 * `verificationMode: 'executed'` distinguish a real run from an assertion.
 */
export const MissionEvidenceSchema = z.object({
  gate: z.string().min(1),
  status: z.enum(['passed', 'failed', 'skipped']),
  source: z.string().min(1),
  detail: z.string().optional(),
  simulated: z.boolean().optional(),
  provenance: EvidenceProvenanceSchema.optional(),
  /** Identity of the concrete execution that produced this evidence. */
  executionId: z.string().min(1).optional(),
  /** Task whose execution produced this evidence; prevents cross-task reuse. */
  taskId: z.string().min(1).optional(),
  /** Adapter/tool that executed the check (e.g. `shell`). */
  tool: z.string().min(1).optional(),
  /** Command or operation, when the source executed one. */
  command: z.string().optional(),
  /** Process exit status, when applicable. */
  exitCode: z.number().int().optional(),
  recordedAt: z.string(),
});

/** One auditable entry in a mission's transition history. */
export const MissionTransitionSchema = z.object({
  from: MissionStatusSchema,
  to: MissionStatusSchema,
  at: z.string(),
  actor: z.string(),
  reason: z.string().optional(),
  version: z.number().int().nonnegative(),
});

export const MissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: MissionTypeSchema,
  priority: MissionPrioritySchema,
  status: MissionStatusSchema,
  dnaPattern: z.string(),
  createdBy: z.string(),
  assignedTo: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: z.number().min(0).max(100).default(0),
  tags: z.array(z.string()).optional(),
  /** Monotonic revision used to reject stale concurrent writes. */
  version: z.number().int().nonnegative().optional(),
  /** Gates that must each have passing evidence before the mission completes. */
  requiredChecks: z.array(z.string()).optional(),
  /**
   * `any` accepts caller-supplied evidence (historical behaviour).
   * `executed` requires every required gate to have passing evidence with
   * `provenance: 'executed'` and a non-empty `executionId`.
   */
  verificationMode: z.enum(['any', 'executed']).optional(),
  /** Evidence recorded by transitions (append-only). */
  evidence: z.array(MissionEvidenceSchema).optional(),
  /** Auditable transition history (append-only). */
  transitions: z.array(MissionTransitionSchema).optional(),
  /** Why the mission was allowed to complete. */
  completionBasis: z.enum(['evidence', 'no-required-checks']).optional(),
  /** Reason supplied with the most recent fail/cancel/pause transition. */
  lastTransitionReason: z.string().optional(),
});

// ============================================================
// Type exports
// ============================================================

export type MissionType = z.infer<typeof MissionTypeSchema>;
export type MissionPriority = z.infer<typeof MissionPrioritySchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;
export type MissionEvidence = z.infer<typeof MissionEvidenceSchema>;
export type MissionTransition = z.infer<typeof MissionTransitionSchema>;
export type Mission = z.infer<typeof MissionSchema>;
