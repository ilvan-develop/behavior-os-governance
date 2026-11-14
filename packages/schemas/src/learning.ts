import { z } from 'zod';

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
// Type exports
// ============================================================

export type EvolutionProposal = z.infer<typeof EvolutionProposalSchema>;
export type CodeFixProposal = z.infer<typeof CodeFixProposalSchema>;
export type LearningType = z.infer<typeof LearningTypeSchema>;
export type LearningImpact = z.infer<typeof LearningImpactSchema>;
export type LearningEvent = z.infer<typeof LearningEventSchema>;
export type LearningStage = z.infer<typeof LearningStageSchema>;
export type LearningTransition = z.infer<typeof LearningTransitionSchema>;
export type LearningRecord = z.infer<typeof LearningRecordSchema>;
