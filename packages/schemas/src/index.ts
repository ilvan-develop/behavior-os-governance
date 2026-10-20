import { z } from 'zod';

// ============================================================
// DNA Pattern Schemas
// ============================================================

export const GovernanceActionSchema = z.enum(['block', 'escalate', 'warn', 'log', 'transform']);

export const ConditionSchema = z.object({
  type: z.string(),
  value: z.unknown(),
});

export const GovernanceRuleSchema = z.object({
  id: z.string(),
  level: z.enum(['critical', 'high', 'medium', 'low']),
  action: GovernanceActionSchema,
  conditions: z.array(ConditionSchema),
  description: z.string().optional(),
});

export const QualityGateSchema = z.object({
  id: z.string(),
  type: z.enum(['test_coverage', 'lint', 'typecheck', 'security', 'performance', 'access_control']),
  threshold: z.number(),
  operator: z.enum(['gte', 'lte', 'eq', 'neq']).optional(),
});

export const PersonaBoundarySchema = z.object({
  id: z.string(),
  type: z.enum(['max_modules', 'max_files', 'max_lines', 'max_time', 'max_actions']),
  value: z.number(),
});

export const PersonaSchema = z.object({
  role: z.string(),
  name: z.string(),
  /**
   * Free-form authority label used by a persona (e.g. "architect", "tech-lead",
   * "compliance", "pi"). This is intentionally a string: shipped DNA patterns in
   * `dnas/*.yaml` use domain-specific authorities, so a closed enum would reject
   * the project's own patterns.
   */
  authority: z.string(),
  boundaries: z.array(PersonaBoundarySchema).optional(),
  skills: z.array(z.string()),
  description: z.string().optional(),
});

export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  required: z.boolean().default(true),
  approvalRequired: z.boolean().default(false),
  timeoutSeconds: z.number().optional(),
});

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(WorkflowStepSchema),
});

export const DNASchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  personas: z.array(PersonaSchema),
  governance: z.array(GovernanceRuleSchema),
  quality: z.array(QualityGateSchema),
  workflows: z.array(WorkflowSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
// Agent Schemas
// ============================================================

export const AgentTypeSchema = z.enum([
  'orchestrator',
  'developer',
  'architect',
  'reviewer',
  'operator',
  'analyst',
]);

export const AgentStatusSchema = z.enum(['idle', 'busy', 'offline', 'error']);

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AgentTypeSchema,
  status: AgentStatusSchema,
  dnaPattern: z.string(),
  capabilities: z.array(z.string()),
  currentMission: z.string().nullable(),
  metrics: z.object({
    tasksCompleted: z.number(),
    tasksFailed: z.number(),
    avgResponseTime: z.number(),
    governanceViolations: z.number(),
  }),
});

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
// Decision (voting) Schemas
// ============================================================

export const VoteChoiceSchema = z.enum(['approve', 'reject', 'abstain']);

export const VoteSchema = z.object({
  voterId: z.string(),
  choice: VoteChoiceSchema,
  /** Voting weight. Defaults to 1; negative weights are clamped to 0. */
  weight: z.number().optional(),
  reason: z.string().optional(),
});

export const DecisionPolicySchema = z.enum(['majority', 'supermajority', 'unanimous']);

export const DecisionOutcomeSchema = z.enum(['approved', 'rejected', 'no_quorum']);

export const DecisionSchema = z.object({
  id: z.string(),
  subject: z.string(),
  policy: DecisionPolicySchema,
  outcome: DecisionOutcomeSchema,
  quorum: z.number(),
  quorumMet: z.boolean(),
  /** Sum of weights per choice. */
  approve: z.number(),
  reject: z.number(),
  abstain: z.number(),
  /** Total participating weight (approve + reject + abstain). */
  participatingWeight: z.number(),
  votes: z.array(VoteSchema),
  /** Voters that cast a non-abstain vote. */
  decidedBy: z.array(z.string()),
  reasons: z.array(z.string()),
  timestamp: z.string(),
  missionId: z.string().optional(),
});

// ============================================================
// DNA Evolution (learning-driven) Schemas
// ============================================================

export const EvolutionProposalSchema = z.object({
  id: z.string(),
  dnaName: z.string(),
  /** Only `governance-warn` is ever applied: evolution can only add warnings. */
  kind: z.enum(['governance-warn']),
  /** The learning-event type that motivated the proposal. */
  pattern: z.string(),
  ruleId: z.string(),
  description: z.string(),
  /** 0..1; see `LearningEngine.confidenceFor` for the exact formula. */
  confidence: z.number(),
  occurrences: z.number(),
  evidence: z.array(z.string()),
  timestamp: z.string(),
});

export const CodeFixProposalSchema = z.object({
  id: z.string(),
  /** Learning event type or extracted keyword. */
  pattern: z.string(),
  /** 0..1; see `LearningEngine.confidenceFor`. */
  confidence: z.number(),
  occurrences: z.number(),
  suggestion: z.string(),
  /** Up to 5 representative examples of the pattern. */
  evidence: z.array(z.string()),
  timestamp: z.string(),
});

// ============================================================
// Learning Schemas
// ============================================================

export const LearningTypeSchema = z.enum(['insight', 'pattern', 'fix', 'failure', 'optimization']);

export const LearningImpactSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const LearningEventSchema = z.object({
  id: z.string(),
  type: LearningTypeSchema,
  source: z.string(),
  content: z.string(),
  impact: LearningImpactSchema,
  relatedMission: z.string().optional(),
  relatedPattern: z.string().optional(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Lifecycle of a governed learning:
 * `observation -> lesson -> candidate -> validated -> policy -> monitored`.
 * Each record moves exactly one stage forward and keeps an auditable trail of
 * transitions; `validated` (and every later stage) requires evidence.
 */
export const LearningStageSchema = z.enum([
  'observation',
  'lesson',
  'candidate',
  'validated',
  'policy',
  'monitored',
]);

export const LearningTransitionSchema = z.object({
  from: LearningStageSchema,
  to: LearningStageSchema,
  at: z.string(),
  actor: z.string(),
  reason: z.string().optional(),
});

export const LearningRecordSchema = z.object({
  id: z.string(),
  stage: LearningStageSchema,
  title: z.string(),
  content: z.string(),
  source: z.string(),
  impact: LearningImpactSchema,
  /** Evidence accumulated while promoting the record (command output, ids, ...). */
  evidence: z.array(z.string()),
  transitions: z.array(LearningTransitionSchema),
  relatedMission: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================================
// Protocol Schemas
// ============================================================

export const ProtocolStepSchema = z.object({
  number: z.number(),
  name: z.string(),
  description: z.string(),
  tool: z.string(),
  required: z.boolean().default(true),
});

export const AgentStateSchema = z.object({
  currentStep: z.number().default(0),
  selectedDna: z.string().nullable(),
  /**
   * Id of the governed agent acting in this session. Never a model name: it is
   * either an explicitly registered agent id, or a DNA persona identity such as
   * `persona:architect`, or `null` when no DNA/agent has been selected yet.
   */
  agentId: z.string().nullable().default(null),
  /** Persona name/role selected from the active DNA, if any. */
  persona: z.string().nullable().default(null),
  activeMission: z.string().nullable(),
  stepHistory: z.array(z.record(z.string(), z.unknown())),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================================
// MCP Schemas
// ============================================================

export const McpToolSchema = z.object({
  name: z.string().max(64),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export const McpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

// ============================================================
// Export all
// ============================================================

export type GovernanceAction = z.infer<typeof GovernanceActionSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type GovernanceRule = z.infer<typeof GovernanceRuleSchema>;
export type QualityGate = z.infer<typeof QualityGateSchema>;
export type PersonaBoundary = z.infer<typeof PersonaBoundarySchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type DNA = z.infer<typeof DNASchema>;
export type MissionType = z.infer<typeof MissionTypeSchema>;
export type MissionPriority = z.infer<typeof MissionPrioritySchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type MissionEvidence = z.infer<typeof MissionEvidenceSchema>;
export type MissionTransition = z.infer<typeof MissionTransitionSchema>;
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;
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
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
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
export type VoteChoice = z.infer<typeof VoteChoiceSchema>;
export type Vote = z.infer<typeof VoteSchema>;
export type DecisionPolicy = z.infer<typeof DecisionPolicySchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type EvolutionProposal = z.infer<typeof EvolutionProposalSchema>;
export type CodeFixProposal = z.infer<typeof CodeFixProposalSchema>;
export const CodeFixResultSchema = z.object({
  id: z.string(),
  /** The originating proposal id returned by `proposeCodeFixes`. */
  proposalId: z.string(),
  pattern: z.string(),
  confidence: z.number(),
  applied: z.boolean(),
  /** Present when votes were supplied — mirrors DecisionOutcome. */
  voteOutcome: z.enum(['approved', 'rejected', 'no_quorum']).optional(),
  /** Vote tally at the time of application. */
  voteTally: z.object({ approve: z.number(), reject: z.number(), abstain: z.number() }).optional(),
  timestamp: z.string(),
  missionId: z.string().optional(),
});
export type CodeFixResult = z.infer<typeof CodeFixResultSchema>;

/**
 * A governed, persisted code-edit record.
 *
 * Every evaluated edit is recorded — including dry-runs and refusals — so the
 * history of rejected proposals is versioned, not just the applied ones.
 */
export const CodeEditRecordSchema = z.object({
  id: z.string(),
  /** File path relative to the workspace root, with `/` separators. */
  file: z.string(),
  /** `sha256:<hex>` of the file before the edit. */
  beforeHash: z.string(),
  /** `sha256:<hex>` the file has (applied) or would have (dry-run). */
  afterHash: z.string(),
  bytesBefore: z.number(),
  bytesAfter: z.number(),
  addedLines: z.number(),
  removedLines: z.number(),
  /** Occurrences of the searched text; exactly 1 is required to apply. */
  occurrences: z.number(),
  /** Whether the file on disk was actually rewritten. */
  applied: z.boolean(),
  /** Why nothing was written (`dry-run`, `opt-in-disabled`, `vote-rejected`, …). */
  reason: z.string().optional(),
  /** Agent identity that requested the edit (from the DNA, never the model). */
  agentId: z.string(),
  /** DNA pattern active at the time. */
  dnaPattern: z.string().nullable().optional(),
  /** Present when votes were supplied — mirrors DecisionOutcome. */
  voteOutcome: z.enum(['approved', 'rejected', 'no_quorum']).optional(),
  /** Vote tally at the time of the decision. */
  voteTally: z.object({ approve: z.number(), reject: z.number(), abstain: z.number() }).optional(),
  missionId: z.string().optional(),
  timestamp: z.string(),
});
export type CodeEditRecord = z.infer<typeof CodeEditRecordSchema>;
export const RankedRecommendationSchema = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  timestamp: z.string(),
});
export type RankedRecommendation = z.infer<typeof RankedRecommendationSchema>;
export const DriftInfoSchema = z.object({
  id: z.string(),
  newerName: z.string(),
  olderName: z.string(),
  rulesAdded: z.number(),
  rulesRemoved: z.number(),
  /** Ids present in both DNAs whose rule body changed. */
  rulesChanged: z.array(z.string()),
  gatesAdded: z.number(),
  gatesRemoved: z.number(),
  /** Ids present in both DNAs whose quality-gate body changed. */
  gatesChanged: z.array(z.string()),
  totalChanges: z.number(),
  significant: z.boolean(),
  summary: z.string(),
  timestamp: z.string(),
});
export type DriftInfo = z.infer<typeof DriftInfoSchema>;
export type LearningType = z.infer<typeof LearningTypeSchema>;
export type LearningImpact = z.infer<typeof LearningImpactSchema>;
export type LearningEvent = z.infer<typeof LearningEventSchema>;
export type LearningStage = z.infer<typeof LearningStageSchema>;
export type LearningTransition = z.infer<typeof LearningTransitionSchema>;
export type LearningRecord = z.infer<typeof LearningRecordSchema>;
export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type McpTool = z.infer<typeof McpToolSchema>;
export type McpResource = z.infer<typeof McpResourceSchema>;
