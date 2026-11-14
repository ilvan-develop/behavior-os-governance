import { z } from 'zod';

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
// Type exports
// ============================================================

export type VoteChoice = z.infer<typeof VoteChoiceSchema>;
export type Vote = z.infer<typeof VoteSchema>;
export type DecisionPolicy = z.infer<typeof DecisionPolicySchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type ConsensusPolicy = z.infer<typeof ConsensusPolicySchema>;
export type ConsensusVote = z.infer<typeof ConsensusVoteSchema>;
export type ConsensusTally = z.infer<typeof ConsensusTallySchema>;
export type ConsensusOutcome = z.infer<typeof ConsensusOutcomeSchema>;
export type ConsensusRound = z.infer<typeof ConsensusRoundSchema>;
export type PredictionType = z.infer<typeof PredictionTypeSchema>;
export type Prediction = z.infer<typeof PredictionSchema>;
