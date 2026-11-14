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
// Type exports
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
export type PipelinePhaseDefinitionType = z.infer<typeof PipelinePhaseDefinitionTypeSchema>;
export type ConstructionPipelineGate = z.infer<typeof ConstructionPipelineGateSchema>;
export type PipelinePhaseDefinition = z.infer<typeof PipelinePhaseDefinitionSchema>;
export type ConstructionPipeline = z.infer<typeof ConstructionPipelineSchema>;
