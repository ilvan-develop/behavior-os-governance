import { z } from 'zod';

// ============================================================
// Code Fix / Edit / Recommendation / Drift Schemas
// ============================================================

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
