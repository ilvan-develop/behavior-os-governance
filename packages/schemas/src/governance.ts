import { z } from 'zod';

// ============================================================
// Governance Schemas
// ============================================================

export const GovernanceVerdictSchema = z.enum(['allow', 'deny', 'escalate', 'transform']);

export const GovernanceDecisionSchema = z.object({
  id: z.string(),
  action: z.string(),
  verdict: GovernanceVerdictSchema,
  reason: z.string(),
  rulesEvaluated: z.array(z.string()),
  /**
   * Rule ids that actually matched and fired (block/escalate/warn/log/
   * transform) during this evaluation, as opposed to `rulesEvaluated`, which
   * lists every rule examined. Optional for backward compatibility.
   */
  firedRules: z.array(z.string()).optional(),
  timestamp: z.string(),
  agentId: z.string(),
  missionId: z.string().optional(),
  transformed: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
});

// ============================================================
// Audit Schemas
// ============================================================

export const AuditStageSchema = z.enum([
  'lint',
  'typecheck',
  'security',
  'coverage',
  'performance',
  'governance',
]);

export const AuditResultSchema = z.object({
  id: z.string(),
  stage: AuditStageSchema,
  status: z.enum(['passed', 'failed', 'warning', 'skipped']),
  details: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});

export const AuditReportSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  agentId: z.string(),
  /** DNA pattern active when the audit ran. */
  dnaPattern: z.string().nullable().optional(),
  /** Persona that authorized the audit, when the DNA defines one. */
  persona: z.string().nullable().optional(),
  stages: z.array(AuditResultSchema),
  overall: z.enum(['pass', 'fail', 'warning']),
  summary: z.string(),
  timestamp: z.string(),
  /**
   * `true` when the report comes from a simulated run. A simulated report is
   * never a verification: it is forced to `overall: 'warning'` and must not be
   * used as completion evidence.
   */
  simulated: z.boolean().optional(),
});

// ============================================================
// Pipeline Schemas
// ============================================================

/** Whether a gate runs before (pre) or after (post) an action executes. */
export const PipelinePhaseSchema = z.enum(['pre', 'post']);

export const GateStatusSchema = z.enum(['passed', 'failed', 'warning', 'skipped']);

export const GateResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: PipelinePhaseSchema,
  /** When true, a `failed` status halts the run and blocks the action. */
  blocking: z.boolean(),
  status: GateStatusSchema,
  details: z.record(z.string(), z.unknown()),
  durationMs: z.number(),
  timestamp: z.string(),
});

export const PipelineRunSchema = z.object({
  id: z.string(),
  overall: z.enum(['pass', 'fail', 'warning']),
  blocked: z.boolean(),
  blockedBy: z.string().optional(),
  phases: z.array(PipelinePhaseSchema),
  gates: z.array(GateResultSchema),
  durationMs: z.number(),
  timestamp: z.string(),
  missionId: z.string().optional(),
  agentId: z.string().optional(),
});

// ============================================================
// Type exports
// ============================================================

export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema> & {
  warnings?: string[];
};
export type AuditStage = z.infer<typeof AuditStageSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type PipelinePhase = z.infer<typeof PipelinePhaseSchema>;
export type GateStatus = z.infer<typeof GateStatusSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type PipelineRun = z.infer<typeof PipelineRunSchema>;
