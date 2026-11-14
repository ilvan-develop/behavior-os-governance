import { z } from 'zod';
import { ConditionSchema, GovernanceActionSchema, GovernanceRuleSchema } from './dna.js';

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

// ============================================================
// Type exports
// ============================================================

export type BehaviorProfile = z.infer<typeof BehaviorProfileSchema>;
export type AnomalyScore = z.infer<typeof AnomalyScoreSchema>;
export type ExperiencePhase = z.infer<typeof ExperiencePhaseSchema>;
export type ExperienceRecord = z.infer<typeof ExperienceRecordSchema>;
export type ComplianceStatus = z.infer<typeof ComplianceStatusSchema>;
export type ComplianceMap = z.infer<typeof ComplianceMapSchema>;
export type HybridEvaluation = z.infer<typeof HybridEvaluationSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type IdentityVerificationResult = z.infer<typeof IdentityVerificationResultSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type DynamicPolicy = z.infer<typeof DynamicPolicySchema>;
export type CounterfactualResult = z.infer<typeof CounterfactualResultSchema>;
export type ExplainableReport = z.infer<typeof ExplainableReportSchema>;
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
export type FairnessVerdict = z.infer<typeof FairnessVerdictSchema>;
export type FairnessGroup = z.infer<typeof FairnessGroupSchema>;
export type FairnessThresholds = z.infer<typeof FairnessThresholdsSchema>;
export type DataProvenance = z.infer<typeof DataProvenanceSchema>;
export type HumanOversight = z.infer<typeof HumanOversightSchema>;
export type FairnessMetric = z.infer<typeof FairnessMetricSchema>;
export type FairnessEvaluation = z.infer<typeof FairnessEvaluationSchema>;
