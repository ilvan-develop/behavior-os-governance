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

// ============================================================
// DNA-Adaptive Construction Pipeline Schemas (G-021)
// ============================================================

/**
 * The type of a construction pipeline phase. These mirror the
 * phases a human software-factory director would mandate.
 */
export const PipelinePhaseDefinitionTypeSchema = z.enum([
  'architecture',
  'planning',
  'dependencies',
  'frontend',
  'backend',
  'integration',
  'testing',
  'deployment',
  'documentation',
]);

/**
 * A single gate within a construction pipeline phase.
 * Gates are evaluated by the PipelineEngine and must pass
 * before the phase (and subsequent phases) can proceed.
 */
export const ConstructionPipelineGateSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Which pipeline phase this gate belongs to. */
  phaseType: PipelinePhaseDefinitionTypeSchema,
  /** Whether a failure halts the pipeline. */
  blocking: z.boolean().default(true),
  /**
   * The gate evaluation condition as a structured key+value.
   * Evaluated against the phase context and project artifacts.
   */
  condition: z.object({
    type: z.string(),
    value: z.unknown(),
    description: z.string(),
  }),
});

/**
 * A phase definition within a construction pipeline. Each phase
 * is associated with specific agent personas, skills to autoload,
 * and gates to evaluate before proceeding.
 */
export const PipelinePhaseDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** The construction phase type (maps to PipelinePhaseDefinitionType). */
  type: PipelinePhaseDefinitionTypeSchema,
  /**
   * Agent personas that should own this phase (from the DNA personas).
   * These are resolved against the DNA pattern's personas section.
   */
  requiredAgents: z.array(z.string()),
  /**
   * Skills to auto-load when this phase begins. The SkillAutoLoader
   * maps these to .opencode/skills/<id>/SKILL.md files.
   */
  requiredSkills: z.array(z.string()),
  /** Gates evaluated during this phase. */
  gates: z.array(ConstructionPipelineGateSchema),
  /** Order determines which gate fails first. */
  order: z.number().int().nonnegative(),
  /**
   * Whether execution is blocked until this phase's gates pass.
   * When true, the pipeline will refuse to proceed to the next phase.
   */
  blocking: z.boolean().default(true),
  /**
   * Optional readiness artifact: a file or marker that must exist
   * before this phase can start (e.g. "adr/0001-architecture.md").
   */
  readinessArtifact: z.string().optional(),
});

/**
 * A named construction pipeline defined in a DNA pattern.
 * The PipelinePlanner selects which pipeline to use based on
 * the project context (web-app, API, mobile, etc.).
 */
export const ConstructionPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Phases in order of execution. */
  phases: z.array(PipelinePhaseDefinitionSchema),
  /**
   * Project types this pipeline is the default for.
   * Used by PipelinePlanner to auto-select the right pipeline.
   */
  appliesTo: z.array(z.string()),
});

export const DNASchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  personas: z.array(PersonaSchema),
  governance: z.array(GovernanceRuleSchema),
  quality: z.array(QualityGateSchema),
  workflows: z.array(WorkflowSchema).optional(),
  /** G-021: Construction pipelines — ordered phases with gates, agents, skills. */
  pipelines: z.array(ConstructionPipelineSchema).optional(),
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
// Consensus (multi-agent voting) Schemas
// ============================================================

export const ConsensusPolicySchema = z.enum(['unanimous', 'supermajority', 'majority']);

export const ConsensusVoteSchema = z.object({
  agentId: z.string(),
  weight: z.number().optional(),
  choice: VoteChoiceSchema,
  reason: z.string().optional(),
});

export const ConsensusTallySchema = z.object({
  approveWeight: z.number(),
  rejectWeight: z.number(),
  abstainWeight: z.number(),
  totalParticipating: z.number(),
  approveRatio: z.number(),
  rejectRatio: z.number(),
});

export const ConsensusOutcomeSchema = z.enum(['approved', 'rejected', 'inconclusive']);

export const ConsensusRoundSchema = z.object({
  id: z.string(),
  subject: z.string(),
  policy: ConsensusPolicySchema,
  quorum: z.number(),
  votes: z.array(ConsensusVoteSchema),
  tally: ConsensusTallySchema,
  outcome: ConsensusOutcomeSchema,
  reason: z.string(),
  timestamp: z.string(),
});

// ============================================================
// Prediction Schemas
// ============================================================

export const PredictionTypeSchema = z.enum([
  'governance-block',
  'mission-failure',
  'quality-fall',
  'drift-significant',
  'pattern-repeated',
]);

export const PredictionSchema = z.object({
  id: z.string(),
  type: PredictionTypeSchema,
  subject: z.string(),
  confidence: z.number(),
  horizonHours: z.number(),
  evidence: z.array(z.string()),
  recommendation: z.string(),
  timestamp: z.string(),
});

// ============================================================
// DNA Evolution (learning-driven) Schemas
// ============================================================

export const EvolutionProposalSchema = z.object({
  id: z.string(),
  dnaName: z.string(),
  /**
   * The type of change this proposal represents.
   * - `add-warn`: add a new warn rule (no vote required, safe by construction)
   * - `relax-block`: relax a `block` or `escalate` rule — requires vote gate (0.67 threshold)
   * - `add-block`: add a new `block` rule — requires vote gate (0.90 threshold)
   */
  changeType: z.enum(['add-warn', 'relax-block', 'add-block']),
  kind: z.enum(['governance-warn']),
  pattern: z.string(),
  condition: z.object({ type: z.string(), value: z.unknown() }).optional(),
  ruleId: z.string(),
  description: z.string(),
  confidence: z.number(),
  occurrences: z.number(),
  evidence: z.array(z.string()),
  timestamp: z.string(),
  /** Whether this proposal requires a vote to be applied. */
  requiresVote: z.boolean().default(false),
  /**
   * Vote threshold (0..1) to approve this proposal when `requiresVote` is true.
   * Default: 0.67 for relax-block, 0.90 for add-block, 0.0 for add-warn.
   */
  voteThreshold: z.number().min(0).max(1).default(0),
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
export type PipelinePhaseDefinitionType = z.infer<typeof PipelinePhaseDefinitionTypeSchema>;
export type ConstructionPipelineGate = z.infer<typeof ConstructionPipelineGateSchema>;
export type PipelinePhaseDefinition = z.infer<typeof PipelinePhaseDefinitionSchema>;
export type ConstructionPipeline = z.infer<typeof ConstructionPipelineSchema>;
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
export type ConsensusPolicy = z.infer<typeof ConsensusPolicySchema>;
export type ConsensusVote = z.infer<typeof ConsensusVoteSchema>;
export type ConsensusTally = z.infer<typeof ConsensusTallySchema>;
export type ConsensusOutcome = z.infer<typeof ConsensusOutcomeSchema>;
export type ConsensusRound = z.infer<typeof ConsensusRoundSchema>;
export type PredictionType = z.infer<typeof PredictionTypeSchema>;
export type Prediction = z.infer<typeof PredictionSchema>;
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

// ============================================================
// Anti-Pattern Schemas
// ============================================================

export const AntiPatternTypeSchema = z.enum([
  'typescript-error',
  'lint-violation',
  'security-vulnerability',
  'performance-issue',
  'architecture-violation',
  'code-smell',
  'test-gap',
  'documentation-gap',
  'governance-bypass',
  'pattern-debt',
]);

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const AntiPatternSchema = z.object({
  id: z.string(),
  type: AntiPatternTypeSchema,
  severity: SeveritySchema,
  pattern: z.string(),
  description: z.string(),
  location: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  evidence: z.array(z.string()),
  recommendation: z.string(),
  detectedAt: z.string(),
  resolved: z.boolean().default(false),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
});

export const ConversationTurnSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  role: z.enum(['system', 'user', 'agent', 'expert']),
  content: z.string(),
  timestamp: z.string(),
});

export const PragmaticConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  problem: z.string(),
  status: z.enum(['open', 'in-progress', 'resolved', 'closed', 'cancelled']),
  participants: z.array(z.string()),
  turns: z.array(ConversationTurnSchema),
  antiPatterns: z.array(z.string()),
  solution: z.string().optional(),
  resolvedBy: z.string().optional(),
  lessonsLearned: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  condition: z.string(),
  action: z.enum(['require', 'warn', 'block', 'auto-fix']),
  severity: SeveritySchema,
  appliesTo: z.array(z.enum(['persona', 'role', 'agent', 'project'])).optional(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().optional(),
});

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  responsibilities: z.array(z.string()),
  policies: z.array(z.string()).optional(),
  canAudit: z.boolean().default(false),
  canEnforce: z.boolean().default(false),
  canTeach: z.boolean().default(false),
});

export type AntiPatternType = z.infer<typeof AntiPatternTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type AntiPattern = z.infer<typeof AntiPatternSchema>;
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export type PragmaticConversation = z.infer<typeof PragmaticConversationSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type Role = z.infer<typeof RoleSchema>;

// ============================================================
// Knowledge Graph Schemas (G-001)
// ============================================================
export * from './knowledge-graph.js';

// ============================================================
// G-009: Behavioral Anomaly Detection
// ============================================================

export const BehaviorProfileSchema = z.object({
  /** Action frequency per hour (0..1 normalized). */
  actionRate: z.number().min(0).max(1),
  /** Fraction of actions that were denied/blocked. */
  denialRate: z.number().min(0).max(1),
  /** Fraction of actions that were escalated. */
  escalationRate: z.number().min(0).max(1),
  /** Number of distinct tools used in the window. */
  toolDiversity: z.number().int().nonnegative(),
  /** Whether the agent operated outside its normal time window. */
  offHoursRatio: z.number().min(0).max(1),
});

export const AnomalyScoreSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  baseline: BehaviorProfileSchema,
  current: BehaviorProfileSchema,
  /** 0..1 — higher = more anomalous. */
  deviation: z.number().min(0).max(1),
  /** Human-readable explanation. */
  explanation: z.string(),
  timestamp: z.string(),
});

// ============================================================
// G-013: Experiential Learning Loop
// ============================================================

export const ExperiencePhaseSchema = z.enum(['execute', 'observe', 'reflect', 'abstract', 'apply']);

export const ExperienceRecordSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  /** The action that was executed. */
  action: z.string(),
  /** Result of the execution. */
  outcome: z.enum(['success', 'failure', 'partial']),
  /** Observation collected after execution. */
  observation: z.string(),
  /** Reflection: what was learned. */
  reflection: z.string(),
  /** Abstracted principle. */
  abstraction: z.string(),
  /** How the abstraction was applied. */
  application: z.string(),
  phase: ExperiencePhaseSchema,
  confidence: z.number().min(0).max(1),
  createdAt: z.string(),
});

// ============================================================
// G-016: Regulatory Compliance Mapper
// ============================================================

export const ComplianceStatusSchema = z.enum(['compliant', 'at-risk', 'violation']);

export const ComplianceMapSchema = z.object({
  id: z.string(),
  /** e.g. "GDPR Article 5", "SOX 302", "HIPAA Privacy Rule". */
  regulation: z.string(),
  /** The mapping of governance rules to this regulation. */
  rules: z.array(z.string()),
  /** Evidence collected for compliance. */
  evidence: z.array(z.string()),
  lastAudit: z.string(),
  status: ComplianceStatusSchema,
  /** Score 0..1 — higher = more compliant. */
  score: z.number().min(0).max(1),
});

export type BehaviorProfile = z.infer<typeof BehaviorProfileSchema>;
export type AnomalyScore = z.infer<typeof AnomalyScoreSchema>;
export type ExperiencePhase = z.infer<typeof ExperiencePhaseSchema>;
export type ExperienceRecord = z.infer<typeof ExperienceRecordSchema>;
export type ComplianceStatus = z.infer<typeof ComplianceStatusSchema>;
export type ComplianceMap = z.infer<typeof ComplianceMapSchema>;

// ============================================================
// G-004: Symbolic-Neural Hybrid Engine
// ============================================================

export const HybridEvaluationSchema = z.object({
  id: z.string(),
  /** The deterministic symbolic (rule-based) verdict. */
  symbolicVerdict: z.enum(['allow', 'deny', 'escalate', 'warn']),
  /** Neural confidence score (0..1). In PoC this is derived from pattern frequency. */
  neuralConfidence: z.number().min(0).max(1),
  /** The combined hybrid verdict. */
  hybridVerdict: z.enum(['allow', 'deny', 'escalate', 'warn']),
  /** Whether the hybrid diverged from the symbolic result and why. */
  diverged: z.boolean(),
  explanation: z.string(),
  timestamp: z.string(),
});

// ============================================================
// G-010: Zero-Trust Identity
// ============================================================

export const AgentIdentitySchema = z.object({
  agentId: z.string(),
  /** Decentralized Identifier (DID) for the agent, e.g. "did:bos:abc123". */
  did: z.string(),
  /** SHA-256 hash of the public key (hex, 64 chars). */
  publicKeyHash: z.string().length(64),
  /** The capabilities this identity is authorized for. */
  capabilities: z.array(z.string()),
  /** When this identity was issued. */
  issuedAt: z.string(),
  /** When this identity expires, or null for indefinite. */
  expiresAt: z.string().nullable(),
});

export const IdentityVerificationResultSchema = z.object({
  agentId: z.string(),
  did: z.string(),
  /** Whether the signature was valid. */
  valid: z.boolean(),
  /** Reason when invalid. */
  reason: z.string().optional(),
  verifiedAt: z.string(),
});

// ============================================================
// G-011: Dynamic Policy Adjustment
// ============================================================

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const RiskAssessmentSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  /** The risk level assessed. */
  level: RiskLevelSchema,
  /** 0..1 risk score. */
  score: z.number().min(0).max(1),
  /** Which factors contributed to the risk score. */
  factors: z.array(z.string()),
  /** The threshold adjustments applied. */
  adjustedThresholds: z.record(z.string(), z.number()),
  timestamp: z.string(),
});

export const DynamicPolicySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  /** The base rule ids this policy is derived from. */
  baseRuleIds: z.array(z.string()),
  /** The risk level at the time of assessment. */
  riskLevel: RiskLevelSchema,
  /** Multiplier applied to enforcement thresholds. */
  enforcementMultiplier: z.number().positive(),
  /** Whether elevated scrutiny is in effect. */
  elevatedScrutiny: z.boolean(),
  activeSince: z.string(),
});

// ============================================================
// G-017: Counterfactual Audit
// ============================================================

export const CounterfactualResultSchema = z.object({
  id: z.string(),
  /** The original decision being replayed. */
  originalDecisionId: z.string(),
  /** The hypothetical modification applied. */
  modification: z.string(),
  /** The hypothetical result. */
  hypotheticalVerdict: z.enum(['allow', 'deny', 'escalate', 'warn', 'transform']),
  /** The actual verdict. */
  actualVerdict: z.enum(['allow', 'deny', 'escalate', 'warn', 'transform']),
  /** Whether the hypothetical differs from the actual. */
  diverged: z.boolean(),
  /** Human-readable explanation. */
  explanation: z.string(),
  timestamp: z.string(),
});

// ============================================================
// G-018: Explainable Reports
// ============================================================

export const ExplainableReportSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The agent the report is about. */
  agentId: z.string(),
  /** The time window covered. */
  from: z.string(),
  to: z.string(),
  /** Number of decisions summarized. */
  decisionsAnalyzed: z.number().int().nonnegative(),
  /** Plain-language summary of what happened. */
  summary: z.string(),
  /** Key findings for non-technical stakeholders. */
  findings: z.array(z.string()),
  /** Recommendations. */
  recommendations: z.array(z.string()),
  /** Severity of the overall posture. */
  severity: z.enum(['healthy', 'attention', 'critical']),
  timestamp: z.string(),
});

// ============================================================
// G-005: Temporal Pattern Engine
// ============================================================

export const TemporalPatternSchema = z.object({
  id: z.string(),
  /** Human-readable description of the pattern. */
  description: z.string(),
  /** The DNA rule id the pattern relates to. */
  ruleId: z.string().uuid().optional(),
  /** ISO cron expression for the recurring window. */
  cronSchedule: z.string(),
  /** Days of the week the pattern is active (0=Sun..6=Sat). */
  activeDays: z.array(z.number().int().min(0).max(6)).optional(),
  /** Number of times this pattern has been observed. */
  occurrences: z.number().int().nonnegative(),
  /** Average deviation when the pattern fires (0..1). */
  avgDeviation: z.number().min(0).max(1),
  /** Whether the pattern is flagged as a risk. */
  isRisk: z.boolean(),
  /** Detected timestamp (when the pattern was first identified). */
  detectedAt: z.string(),
  /** When the pattern was last observed. */
  lastSeen: z.string(),
});

export const TemporalPatternSuggestionSchema = z.object({
  patternId: z.string(),
  /** The suggested cron schedule for a new temporal rule. */
  suggestedCron: z.string(),
  /** Confidence in the suggestion (0..1). */
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

// ============================================================
// G-007: Cross-Domain Knowledge Transfer (enhanced)
// ============================================================

export const CrossDomainTransferSchema = z.object({
  id: z.string(),
  /** Source DNA pattern. */
  sourceDna: z.string(),
  /** Target DNA pattern. */
  targetDna: z.string(),
  /** The rule id transferred. */
  ruleId: z.string(),
  /** Structural similarity score (0..1). */
  similarity: z.number().min(0).max(1),
  /** Why this transfer is suggested. */
  justification: z.string(),
  /** When the transfer was identified. */
  createdAt: z.string(),
});

// ============================================================
// G-008: Memory Consolidation Engine
// ============================================================

export const SemanticFactSchema = z.object({
  id: z.string(),
  /** The factual statement. */
  fact: z.string(),
  /** Source episode ids that led to this fact. */
  sourceEpisodes: z.array(z.string()),
  /** Confidence in the fact (0..1). */
  confidence: z.number().min(0).max(1),
  /** When the fact was consolidated. */
  createdAt: z.string(),
  /** When the fact was last validated. */
  lastValidated: z.string().optional(),
});

export const ConsolidatedKnowledgeSchema = z.object({
  /** Semantic facts extracted from episodes. */
  semanticFacts: z.array(SemanticFactSchema),
  /** Summary of the consolidation run. */
  summary: z.string(),
  /** How many episodes were processed. */
  episodesProcessed: z.number().int().nonnegative(),
  /** How many facts were pruned (obsolete). */
  factsPruned: z.number().int().nonnegative(),
  timestamp: z.string(),
});

// ============================================================
// G-012: Circuit Breaker Intelligence
// ============================================================

export const FailurePatternSchema = z.object({
  id: z.string(),
  /** The operation type that failed. */
  operationType: z.string(),
  /** Error signature (normalized error message pattern). */
  errorPattern: z.string(),
  /** Number of occurrences. */
  occurrences: z.number().int().nonnegative(),
  /** Failure rate (0..1). */
  failureRate: z.number().min(0).max(1),
  /** Recommended breaker threshold for this pattern. */
  recommendedThreshold: z.number().min(0).max(1),
});

export const BreakerAdjustmentSchema = z.object({
  id: z.string(),
  failurePatternId: z.string(),
  /** The breaker name adjusted. */
  breakerName: z.string(),
  /** Previous threshold. */
  previousThreshold: z.number(),
  /** New threshold applied. */
  newThreshold: z.number(),
  reason: z.string(),
  timestamp: z.string(),
});

// ============================================================
// G-014: Value Alignment Engine
// ============================================================

export const ValueDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Keywords that indicate this value is at stake. */
  keywords: z.array(z.string()),
});

export const AlignmentScoreSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  /** The values being scored. */
  values: z.array(ValueDefinitionSchema),
  /** Per-value alignment score (0..1). */
  scores: z.record(z.string(), z.number().min(0).max(1)),
  /** Overall alignment score (0..1). */
  overallScore: z.number().min(0).max(1),
  /** Violations detected (actions that conflict with values). */
  violations: z.array(z.string()),
  timestamp: z.string(),
});

// ============================================================
// G-015: Collective Intelligence Aggregation
// ============================================================

export const CollectiveVoteSchema = z.object({
  id: z.string(),
  /** The proposal being voted on. */
  proposal: z.string(),
  /** Per-agent votes. */
  votes: z
    .array(
      z.object({
        agentId: z.string(),
        choice: z.enum(['approve', 'reject', 'abstain']),
        weight: z.number().nonnegative(),
        confidence: z.number().min(0).max(1),
        rationale: z.string().optional(),
      }),
    )
    .min(1),
  /** Aggregated result. */
  result: z.enum(['approved', 'rejected', 'tie']),
  /** Confidence in the collective decision (0..1). */
  collectiveConfidence: z.number().min(0).max(1),
});

// ============================================================
// G-019: External System Adapter Framework
// ============================================================

export const ExternalEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  receivedAt: z.string(),
});

export const ExternalPolicySchema = z.object({
  id: z.string(),
  source: z.string(),
  ruleId: z.string(),
  action: GovernanceActionSchema,
  conditions: z.array(ConditionSchema),
  /** When the policy was imported. */
  importedAt: z.string(),
});

// ============================================================
// G-020: Governance-as-Code Repository
// ============================================================

export const GovernanceChangeRequestSchema = z.object({
  id: z.string(),
  /** The DNA pattern being modified. */
  dnaName: z.string(),
  /** The rule id being added/changed/removed. */
  ruleId: z.string(),
  changeType: z.enum(['add', 'modify', 'delete']),
  proposedRule: GovernanceRuleSchema.optional(),
  /** Rationale for the change. */
  rationale: z.string(),
  /** CI status of the change. */
  ciStatus: z.enum(['pending', 'passing', 'failing', 'approved']),
  createdAt: z.string(),
});

// ============================================================
// Responsible AI: fairness, data provenance, human oversight
// ============================================================

export const FairnessVerdictSchema = z.enum(['pass', 'warn', 'block', 'insufficient_data']);

export const FairnessGroupSchema = z.object({
  group: z.string().min(1),
  total: z.number().int().nonnegative(),
  positive: z.number().int().nonnegative(),
  /** Ground-truth positives; required to compute equal opportunity. */
  actualPositive: z.number().int().nonnegative().optional(),
  /** True positives among the favourable decisions. */
  truePositive: z.number().int().nonnegative().optional(),
});

export const FairnessThresholdsSchema = z.object({
  maxParityDifference: z.number().min(0).max(1).default(0.1),
  minDisparateImpactRatio: z.number().min(0).max(1).default(0.8),
  maxEqualOpportunityDifference: z.number().min(0).max(1).default(0.1),
});

export const DataProvenanceSchema = z.object({
  datasetId: z.string().min(1),
  source: z.string().min(1),
  /** ISO-8601 timestamp; validated by the engine so the schema stays portable. */
  collectedAt: z.string().min(1),
  /** Legal or ethical basis for using the data. */
  consentBasis: z.string().min(1),
  transformations: z.array(z.string()).optional(),
  lineage: z.array(z.string()).optional(),
});

export const HumanOversightSchema = z.object({
  required: z.boolean(),
  approved: z.boolean(),
  reviewerId: z.string().optional(),
  reviewedAt: z.string().optional(),
  rationale: z.string().optional(),
});

export const FairnessMetricSchema = z.object({
  name: z.enum([
    'demographic_parity_difference',
    'disparate_impact_ratio',
    'equal_opportunity_difference',
  ]),
  value: z.number(),
  threshold: z.number(),
  passed: z.boolean(),
  detail: z.string(),
});

export const FairnessEvaluationSchema = z.object({
  verdict: FairnessVerdictSchema,
  passed: z.boolean(),
  metrics: z.array(FairnessMetricSchema),
  violations: z.array(z.string()),
  provenanceComplete: z.boolean(),
  provenanceIssues: z.array(z.string()),
  oversightSatisfied: z.boolean(),
  reasons: z.array(z.string()),
  thresholds: FairnessThresholdsSchema,
  evaluatedAt: z.string(),
});

export type FairnessVerdict = z.infer<typeof FairnessVerdictSchema>;
export type FairnessGroup = z.infer<typeof FairnessGroupSchema>;
export type FairnessThresholds = z.infer<typeof FairnessThresholdsSchema>;
export type DataProvenance = z.infer<typeof DataProvenanceSchema>;
export type HumanOversight = z.infer<typeof HumanOversightSchema>;
export type FairnessMetric = z.infer<typeof FairnessMetricSchema>;
export type FairnessEvaluation = z.infer<typeof FairnessEvaluationSchema>;

export type TemporalPattern = z.infer<typeof TemporalPatternSchema>;
export type TemporalPatternSuggestion = z.infer<typeof TemporalPatternSuggestionSchema>;
export type CrossDomainTransfer = z.infer<typeof CrossDomainTransferSchema>;
export type SemanticFact = z.infer<typeof SemanticFactSchema>;
export type ConsolidatedKnowledge = z.infer<typeof ConsolidatedKnowledgeSchema>;
export type FailurePattern = z.infer<typeof FailurePatternSchema>;
export type BreakerAdjustment = z.infer<typeof BreakerAdjustmentSchema>;
export type ValueDefinition = z.infer<typeof ValueDefinitionSchema>;
export type AlignmentScore = z.infer<typeof AlignmentScoreSchema>;
export type CollectiveVote = z.infer<typeof CollectiveVoteSchema>;
export type ExternalEvent = z.infer<typeof ExternalEventSchema>;
export type ExternalPolicy = z.infer<typeof ExternalPolicySchema>;
export type GovernanceChangeRequest = z.infer<typeof GovernanceChangeRequestSchema>;
