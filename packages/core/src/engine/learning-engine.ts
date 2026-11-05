import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CodeFixProposal,
  EvolutionProposal,
  LearningEvent,
  LearningImpact,
  LearningRecord,
  LearningStage,
  LearningTransition,
  LearningType,
  Severity,
} from '@behavior-os/schemas';

export interface RecordOptions {
  type: LearningType;
  source: string;
  content: string;
  impact: LearningImpact;
  relatedMission?: string;
  relatedPattern?: string;
  metadata?: Record<string, unknown>;
}

export interface DetectedPattern {
  type: string;
  count: number;
  examples: string[];
  recommendation?: string;
}

/** Relative weight of each impact level when scoring confidence (0..1). */
const IMPACT_WEIGHT: Record<LearningImpact, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};

/** Occurrence count at which the frequency term of the confidence saturates. */
const SATURATION_OCCURRENCES = 5;

/** Learning types that describe a problem worth preventing via governance. */
const ACTIONABLE_TYPES: readonly LearningType[] = ['failure', 'fix'];

/**
 * Ordered governance lifecycle of a learning record. A record moves exactly one
 * stage forward per promotion; there is no skip and no regression.
 */
export const LEARNING_STAGES: readonly LearningStage[] = [
  'observation',
  'lesson',
  'candidate',
  'validated',
  'policy',
  'monitored',
];

/** Stages that may only be entered with at least one piece of evidence. */
const EVIDENCE_REQUIRED_STAGES: readonly LearningStage[] = ['validated', 'policy', 'monitored'];

export interface CreateLearningRecordOptions {
  title: string;
  content: string;
  source: string;
  impact: LearningImpact;
  relatedMission?: string;
  evidence?: string[];
  actor?: string;
}

export interface AdvanceLearningRecordOptions {
  actor?: string;
  reason?: string;
  /** Evidence appended while promoting; required to reach `validated`. */
  evidence?: string[];
}

export type LearningAdvanceResult =
  | { ok: true; record: LearningRecord }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'EVIDENCE_REQUIRED'; message: string };

// ---------------------------------------------------------------------------
// Governed policy versioning (Sprint 2).
//
// A learning record that reaches the `policy` stage becomes a *candidate*
// policy version. A version is an immutable snapshot: its content hash is
// computed once and every validation/approval/activation is bound to that
// exact `(versionId, contentHash)` pair, so a later edit can never reuse an
// older validation. Activation requires a passing validation **and** an
// approval authored by a human actor; the engine refuses `agent`/`llm`/`system`
// actors for approval, activation, deactivation and rollback.
// ---------------------------------------------------------------------------

export type PolicyActorKind = 'human' | 'agent' | 'llm' | 'system';

export interface PolicyActor {
  id: string;
  kind: PolicyActorKind;
}

export type PolicyVersionStatus = 'candidate' | 'validated' | 'approved' | 'active' | 'retired';

export interface PolicyVersionProvenance {
  source: string;
  actor: string;
  actorKind: PolicyActorKind;
  createdAt: string;
  reason?: string;
  mission?: string;
}

export type PolicyEnforcementAction = 'block' | 'escalate' | 'require' | 'warn';

/**
 * Optional machine-readable enforcement attached to a policy version. Without
 * it the version is documentation only; with it, activation makes the policy
 * affect `evaluateGovernance` for matching actions.
 */
export interface PolicyEnforcement {
  action: PolicyEnforcementAction;
  /** `*` for every action, otherwise a case-insensitive substring match. */
  match: string;
  severity: Severity;
  description?: string;
}

export interface PolicyVersion {
  /** Stable identity: the same logical policy keeps this id across restarts. */
  policyId: string;
  /** `${policyId}@${version}`; unique and deterministic. */
  versionId: string;
  version: number;
  content: string;
  /** SHA-256 over `{policyId, content, enforcement?}` in canonical JSON order. */
  contentHash: string;
  learningId?: string;
  enforcement?: PolicyEnforcement;
  provenance: PolicyVersionProvenance;
  createdAt: string;
}

export interface PolicyValidation {
  versionId: string;
  contentHash: string;
  valid: boolean;
  issues: string[];
  checkedAt: string;
  checkedBy: PolicyActor;
}

export interface PolicyApproval {
  versionId: string;
  contentHash: string;
  approvedBy: string;
  approvedAt: string;
  rationale: string;
  /** Only a human approver can create this record. */
  actorKind: 'human';
  /** How the human gate was verified: HMAC token or the actor-kind contract. */
  verification: 'hmac' | 'actor-kind';
}

export interface PolicyActivationRecord {
  versionId: string;
  contentHash: string;
  action: 'activated' | 'deactivated' | 'rolled-back';
  at: string;
  actor: PolicyActor;
  basis: 'governed' | 'legacy-import';
  fromVersionId?: string;
  reason?: string;
}

export type PolicyLedgerEventType =
  | 'candidate-created'
  | 'validated'
  | 'validation-failed'
  | 'approval-rejected'
  | 'approved'
  | 'activation-rejected'
  | 'activated'
  | 'deactivated'
  | 'rollback-rejected'
  | 'rolled-back'
  | 'monitored'
  | 'monitor-failed'
  | 'legacy-imported';

/** Append-only audit event: every lifecycle transition produces one. */
export interface PolicyLedgerEvent {
  id: string;
  at: string;
  type: PolicyLedgerEventType;
  policyId: string;
  versionId?: string;
  contentHash?: string;
  actor: PolicyActor;
  reason?: string;
  fromVersionId?: string;
  toVersionId?: string;
}

export interface PolicyMonitoring {
  checks: number;
  failures: number;
  lastCheckedAt?: string;
  lastDetail?: string;
}

/** Plain-JSON ledger persisted in the existing `meta` table. */
export interface PolicyLedgerState {
  versions: PolicyVersion[];
  validations: PolicyValidation[];
  approvals: PolicyApproval[];
  activations: PolicyActivationRecord[];
  events: PolicyLedgerEvent[];
  active: Record<string, string>;
  monitoring: Record<string, PolicyMonitoring>;
}

export type PolicyErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'VALIDATION_REQUIRED'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_TOKEN_REQUIRED'
  | 'APPROVAL_TOKEN_INVALID'
  | 'NOT_ACTIVE'
  | 'HASH_MISMATCH';

export type PolicyFailure = { ok: false; code: PolicyErrorCode; message: string };
export type PolicyCandidateResult = { ok: true; version: PolicyVersion } | PolicyFailure;
export type PolicyValidationResult = { ok: true; validation: PolicyValidation } | PolicyFailure;
export type PolicyApprovalResult = { ok: true; approval: PolicyApproval } | PolicyFailure;
export type PolicyActivationResult = { ok: true; version: PolicyVersion } | PolicyFailure;
export type PolicyDeactivationResult = { ok: true; policyId: string } | PolicyFailure;
export type PolicyRollbackResult = { ok: true; version: PolicyVersion } | PolicyFailure;
export type PolicyMonitorResult = { ok: true; monitoring: PolicyMonitoring } | PolicyFailure;

export interface PolicyEnforcementMatch {
  policyId: string;
  versionId: string;
  action: PolicyEnforcementAction;
  severity: Severity;
  /** Stable rule id surfaced in governance decisions and metrics. */
  ruleId: string;
  reason: string;
}

export interface PolicyEnforcementEvaluation {
  verdict: 'allow' | 'warn' | 'escalate' | 'deny';
  matches: PolicyEnforcementMatch[];
}

export interface CreatePolicyCandidateOptions {
  /** Stable policy identity. Defaults to `policy:<learningId>` when omitted. */
  policyId?: string;
  /** Optional originating learning record; must exist when provided. */
  learningId?: string;
  content: string;
  source?: string;
  actor: PolicyActor;
  reason?: string;
  mission?: string;
  /** Optional machine-readable enforcement applied when this version is active. */
  enforcement?: PolicyEnforcement;
}

/** Canonical JSON: sorted keys, stable across processes, hash-safe. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function policyContentHash(
  policyId: string,
  content: string,
  enforcement?: PolicyEnforcement,
): string {
  return createHash('sha256')
    .update(canonicalJson({ policyId, content, ...(enforcement ? { enforcement } : {}) }))
    .digest('hex');
}

function cloneVersion(version: PolicyVersion): PolicyVersion {
  return {
    ...version,
    provenance: { ...version.provenance },
    ...(version.enforcement ? { enforcement: { ...version.enforcement } } : {}),
  };
}

const ENFORCEMENT_ACTIONS: readonly PolicyEnforcementAction[] = [
  'block',
  'escalate',
  'require',
  'warn',
];
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Validate and normalize optional enforcement before it becomes immutable. */
function normalizeEnforcement(
  input: PolicyEnforcement | undefined,
): { ok: true; enforcement?: PolicyEnforcement } | { ok: false; message: string } {
  if (!input) return { ok: true };
  if (!ENFORCEMENT_ACTIONS.includes(input.action)) {
    return { ok: false, message: `Unknown enforcement action "${String(input.action)}"` };
  }
  if (!SEVERITIES.includes(input.severity)) {
    return { ok: false, message: `Unknown enforcement severity "${String(input.severity)}"` };
  }
  const match = input.match?.trim();
  if (!match) {
    return {
      ok: false,
      message: 'Enforcement requires a non-empty match (use "*" for any action)',
    };
  }
  const description = input.description?.trim();
  return {
    ok: true,
    enforcement: {
      action: input.action,
      match,
      severity: input.severity,
      ...(description ? { description } : {}),
    },
  };
}

function cloneValidation(validation: PolicyValidation): PolicyValidation {
  return { ...validation, issues: [...validation.issues], checkedBy: { ...validation.checkedBy } };
}

function cloneApproval(approval: PolicyApproval): PolicyApproval {
  return { ...approval };
}

function cloneActivation(activation: PolicyActivationRecord): PolicyActivationRecord {
  return { ...activation, actor: { ...activation.actor } };
}

function cloneEvent(event: PolicyLedgerEvent): PolicyLedgerEvent {
  return { ...event, actor: { ...event.actor } };
}

/** Environment variable that enables HMAC-verified human approvals. */
export const POLICY_APPROVAL_KEY_ENV = 'BEHAVIOR_OS_APPROVAL_KEY';

function approvalMacInput(version: PolicyVersion, rationale: string): string {
  return `${version.policyId}|${version.versionId}|${version.contentHash}|${rationale}`;
}

/**
 * When `BEHAVIOR_OS_APPROVAL_KEY` is set, a human approval must carry an HMAC
 * token over the exact version, content hash and rationale. Without the key the
 * engine keeps the documented actor-kind contract for local development.
 */
function verifyApprovalToken(
  version: PolicyVersion,
  rationale: string,
  token: string | undefined,
):
  | { ok: true; verification: 'hmac' | 'actor-kind' }
  | { ok: false; code: PolicyErrorCode; message: string } {
  const key = process.env[POLICY_APPROVAL_KEY_ENV];
  if (!key) return { ok: true, verification: 'actor-kind' };
  if (!token || token.trim().length === 0) {
    return {
      ok: false,
      code: 'APPROVAL_TOKEN_REQUIRED',
      message: `${POLICY_APPROVAL_KEY_ENV} is set; an HMAC approval token is required`,
    };
  }
  const expected = createHmac('sha256', key)
    .update(approvalMacInput(version, rationale))
    .digest('hex');
  const provided = token.trim().toLowerCase();
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  ) {
    return {
      ok: false,
      code: 'APPROVAL_TOKEN_INVALID',
      message: 'The approval token does not match this version and rationale',
    };
  }
  return { ok: true, verification: 'hmac' };
}

/** Export the MAC payload contract so CLI tooling can issue tokens. */
export function policyApprovalPayload(
  version: Pick<PolicyVersion, 'policyId' | 'versionId' | 'contentHash'>,
  rationale: string,
): string {
  return `${version.policyId}|${version.versionId}|${version.contentHash}|${rationale}`;
}

/** Drop empty/duplicate evidence strings so promotion checks stay meaningful. */
function normalizeEvidence(evidence: readonly string[] | undefined): string[] {
  if (!Array.isArray(evidence)) return [];
  return [...new Set(evidence.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
}

export class LearningEngine {
  private events: LearningEvent[] = [];
  private patterns: Map<string, DetectedPattern> = new Map();
  /** Governed lifecycle records, independent of the raw event stream. */
  private records: LearningRecord[] = [];
  /** Policy version history, keyed by stable policy id. Append-only. */
  private policyVersions = new Map<string, PolicyVersion[]>();
  private policyValidations: PolicyValidation[] = [];
  private policyApprovals: PolicyApproval[] = [];
  private policyActivations: PolicyActivationRecord[] = [];
  private policyEvents: PolicyLedgerEvent[] = [];
  private activePolicyVersions = new Map<string, string>();
  private policyMonitoring = new Map<string, PolicyMonitoring>();

  record(options: RecordOptions): LearningEvent {
    const event: LearningEvent = {
      id: `learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...options,
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);
    this.detectPatterns();
    return event;
  }

  detectPatterns(): DetectedPattern[] {
    const typeCounts = new Map<string, number>();
    const examples = new Map<string, string[]>();

    for (const event of this.events) {
      typeCounts.set(event.type, (typeCounts.get(event.type) || 0) + 1);
      const existing = examples.get(event.type) || [];
      if (existing.length < 5) {
        existing.push(event.content);
        examples.set(event.type, existing);
      }
    }

    const patterns: DetectedPattern[] = [];
    for (const [type, count] of typeCounts) {
      if (count >= 2) {
        patterns.push({
          type,
          count,
          examples: examples.get(type) || [],
          recommendation: this.generateRecommendation(type, count),
        });
      }
    }

    this.patterns.clear();
    for (const p of patterns) {
      this.patterns.set(p.type, p);
    }

    return patterns;
  }

  getEvents(): LearningEvent[] {
    return this.events;
  }

  getPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values());
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.events.filter((e) => e.impact === 'high' || e.impact === 'critical').slice(-limit);
  }

  // DNA evolution -----------------------------------------------------------
  /**
   * Confidence in [0, 1] that a recurring pattern is real rather than noise.
   *
   * `confidence = frequency * 0.6 + avgImpactWeight * 0.4` where
   * `frequency = min(1, occurrences / 5)` and the impact weights are
   * `{ low: 0.25, medium: 0.5, high: 0.75, critical: 1 }`. Five or more
   * occurrences of a high-impact problem therefore reach ~0.85, which is the
   * default bar for proposing a DNA change.
   */
  confidenceFor(occurrences: number, avgImpactWeight: number): number {
    const frequency = Math.min(1, Math.max(0, occurrences) / SATURATION_OCCURRENCES);
    const impact = Math.min(1, Math.max(0, avgImpactWeight));
    return Math.round((frequency * 0.6 + impact * 0.4) * 1000) / 1000;
  }

  /**
   * Derive DNA-change proposals from repeated `failure`/`fix` events that are
   * attributable to a concrete tool (`source: "tool:<name>"`, the shape the
   * plugin records on tool errors). Proposals apply as governance warn rules
   * whose condition matches the *real* context key hosts send (`tool`), so the
   * rule can actually fire. Events without a tool token produce no proposal:
   * a rule we cannot match would be an inert condition, and inert conditions
   * are dead code in a governance system. Pure computation — nothing mutated.
   * Proposals below `minConfidence` (default 0.8) are discarded.
   */
  proposeEvolution(dnaName: string, minConfidence = 0.8): EvolutionProposal[] {
    const byTool = new Map<string, LearningEvent[]>();
    for (const event of this.events) {
      if (!ACTIONABLE_TYPES.includes(event.type)) continue;
      const token = event.source.startsWith('tool:') ? event.source.slice('tool:'.length) : null;
      if (!token) continue;
      const bucket = byTool.get(token) ?? [];
      bucket.push(event);
      byTool.set(token, bucket);
    }

    const proposals: EvolutionProposal[] = [];
    for (const [token, events] of byTool) {
      const totalImpact = events.reduce((sum, e) => sum + IMPACT_WEIGHT[e.impact], 0);
      const confidence = this.confidenceFor(events.length, totalImpact / events.length);
      if (confidence < minConfidence) continue;

      const type = events[0]?.type ?? 'failure';
      proposals.push({
        id: `evo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        dnaName,
        // Default: add-warn proposals (safe, no vote required).
        changeType: 'add-warn',
        kind: 'governance-warn',
        pattern: `${type}@${token}`,
        condition: { type: 'tool', value: token },
        ruleId: `evo-warn-${type}-${token}`,
        description: `Add a warning rule for recurring "${type}" events from tool "${token}" (confidence ${confidence})`,
        confidence,
        occurrences: events.length,
        evidence: events.slice(-5).map((e) => e.content),
        timestamp: new Date().toISOString(),
        requiresVote: false,
        voteThreshold: 0,
      });

      // For high-impact failures with strong confidence, propose a vote-gated
      // block rule (requires 0.90 supermajority).
      const hasCritical = events.some((e) => e.impact === 'critical');
      if (hasCritical && confidence >= 0.9) {
        proposals.push({
          id: `evo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          dnaName,
          changeType: 'add-block',
          kind: 'governance-warn',
          pattern: `${type}@${token}`,
          condition: { type: 'tool', value: token },
          ruleId: `evo-block-${type}-${token}`,
          description: `Add a block rule for recurring critical "${type}" events from tool "${token}" (confidence ${confidence})`,
          confidence,
          occurrences: events.length,
          evidence: events.slice(-5).map((e) => e.content),
          timestamp: new Date().toISOString(),
          requiresVote: true,
          voteThreshold: 0.9,
        });
      }

      // For high-confidence failures on already-blocked tools, propose relaxing
      // the block (requires 0.67 supermajority).
      if (hasCritical && confidence >= 0.75) {
        proposals.push({
          id: `evo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          dnaName,
          changeType: 'relax-block',
          kind: 'governance-warn',
          pattern: `${type}@${token}`,
          condition: { type: 'tool', value: token },
          ruleId: `evo-relax-${type}-${token}`,
          description: `Relax existing block rule for tool "${token}" to escalate (confidence ${confidence})`,
          confidence,
          occurrences: events.length,
          evidence: events.slice(-5).map((e) => e.content),
          timestamp: new Date().toISOString(),
          requiresVote: true,
          voteThreshold: 0.67,
        });
      }
    }

    return proposals.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Derive code-fix proposals from repeated `fix` events. Each proposal is a
   * read-only suggestion — no files are touched. `minConfidence` defaults to
   * 0.8; three `fix` events of impact `critical` reach ~0.84 and qualify.
   */
  proposeCodeFixes(minConfidence = 0.8): CodeFixProposal[] {
    const byType = new Map<string, LearningEvent[]>();
    for (const event of this.events) {
      if (event.type !== 'fix') continue;
      const bucket = byType.get(event.type) ?? [];
      bucket.push(event);
      byType.set(event.type, bucket);
    }

    const proposals: CodeFixProposal[] = [];
    for (const [type, events] of byType) {
      const totalImpact = events.reduce((sum, e) => sum + IMPACT_WEIGHT[e.impact], 0);
      const confidence = this.confidenceFor(events.length, totalImpact / events.length);
      if (confidence < minConfidence) continue;

      proposals.push({
        id: `fix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pattern: type,
        confidence,
        occurrences: events.length,
        suggestion: `Repeat fix "${type}" ${events.length} time(s); consider a reusable template.`,
        evidence: events.slice(-5).map((e) => e.content),
        timestamp: new Date().toISOString(),
      });
    }

    return proposals.sort((a, b) => b.confidence - a.confidence);
  }

  /** Snapshot every learning event (JSON-serializable) for persistence. */
  snapshot(): LearningEvent[] {
    return [...this.events];
  }

  /** Replace all learning events and recompute the derived patterns. */
  restore(events: readonly LearningEvent[]): void {
    this.events = Array.isArray(events) ? [...events] : [];
    this.patterns.clear();
    this.detectPatterns();
  }

  // Governed lifecycle ------------------------------------------------------
  /**
   * Open a learning record at the `observation` stage. Recording an event and
   * opening a lifecycle record are separate concerns: the event stream feeds
   * pattern detection, while a record is promoted with evidence.
   */
  createRecord(options: CreateLearningRecordOptions): LearningRecord {
    const now = new Date().toISOString();
    const record: LearningRecord = {
      id: `learn-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage: 'observation',
      title: options.title,
      content: options.content,
      source: options.source,
      impact: options.impact,
      evidence: normalizeEvidence(options.evidence),
      transitions: [],
      createdAt: now,
      updatedAt: now,
      ...(options.relatedMission ? { relatedMission: options.relatedMission } : {}),
    };
    this.records.push(record);
    return { ...record, evidence: [...record.evidence], transitions: [] };
  }

  /**
   * Promote a record exactly one stage forward.
   *
   * Refusals are explicit: an unknown id (`NOT_FOUND`), a skip/regression/other
   * out-of-order target (`INVALID_TRANSITION`), or a promotion into `validated`
   * or later without any evidence (`EVIDENCE_REQUIRED`). A refused promotion
   * leaves the record untouched.
   */
  advanceRecord(
    id: string,
    to: LearningStage,
    options: AdvanceLearningRecordOptions = {},
  ): LearningAdvanceResult {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) {
      return { ok: false, code: 'NOT_FOUND', message: `No learning record with id "${id}"` };
    }

    const fromIndex = LEARNING_STAGES.indexOf(record.stage);
    const toIndex = LEARNING_STAGES.indexOf(to);
    if (toIndex !== fromIndex + 1) {
      const next = LEARNING_STAGES[fromIndex + 1] ?? 'none';
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot move learning ${id} from "${record.stage}" to "${to}"; the next stage is "${next}"`,
      };
    }

    const evidence = [...record.evidence, ...normalizeEvidence(options.evidence)];
    if (EVIDENCE_REQUIRED_STAGES.includes(to) && evidence.length === 0) {
      return {
        ok: false,
        code: 'EVIDENCE_REQUIRED',
        message: `Promotion to "${to}" requires at least one evidence entry`,
      };
    }

    const at = new Date().toISOString();
    const transition: LearningTransition = {
      from: record.stage,
      to,
      at,
      actor: options.actor ?? 'system',
      ...(options.reason ? { reason: options.reason } : {}),
    };

    record.stage = to;
    record.evidence = evidence;
    record.transitions.push(transition);
    record.updatedAt = at;

    // Entering the `policy` stage opens an *inactive* candidate version. It
    // does not become active until a validation and a human approval exist for
    // this exact content hash.
    if (to === 'policy') {
      const policyId = `policy:${record.id}`;
      if (!this.policyVersions.has(policyId)) {
        this.createPolicyCandidate({
          policyId,
          learningId: record.id,
          content: record.content,
          source: record.source,
          actor: { id: options.actor ?? 'system', kind: 'agent' },
          ...(options.reason ? { reason: options.reason } : {}),
          ...(record.relatedMission ? { mission: record.relatedMission } : {}),
        });
      }
    }

    return {
      ok: true,
      record: {
        ...record,
        evidence: [...record.evidence],
        transitions: [...record.transitions],
      },
    };
  }

  getRecords(): LearningRecord[] {
    return this.records.map((record) => ({
      ...record,
      evidence: [...record.evidence],
      transitions: [...record.transitions],
    }));
  }

  getRecord(id: string): LearningRecord | undefined {
    return this.getRecords().find((record) => record.id === id);
  }

  /** Snapshot every lifecycle record for persistence. */
  snapshotRecords(): LearningRecord[] {
    return this.getRecords();
  }

  /** Replace all lifecycle records; tolerates snapshots written before G-014. */
  restoreRecords(records: readonly LearningRecord[] | undefined): void {
    this.records = Array.isArray(records)
      ? records.map((record) => ({
          ...record,
          evidence: [...(record.evidence ?? [])],
          transitions: [...(record.transitions ?? [])],
        }))
      : [];
  }

  // Governed policy versioning ---------------------------------------------
  private findPolicyVersion(policyId: string, versionId: string): PolicyVersion | undefined {
    return this.policyVersions.get(policyId)?.find((version) => version.versionId === versionId);
  }

  private latestValidation(
    versionId: string,
    contentHash: string,
    validOnly: boolean,
  ): PolicyValidation | undefined {
    for (let index = this.policyValidations.length - 1; index >= 0; index--) {
      const validation = this.policyValidations[index];
      if (validation.versionId !== versionId || validation.contentHash !== contentHash) continue;
      if (validOnly && !validation.valid) continue;
      return validation;
    }
    return undefined;
  }

  private hasApproval(versionId: string, contentHash: string): PolicyApproval | undefined {
    return this.policyApprovals.find(
      (approval) => approval.versionId === versionId && approval.contentHash === contentHash,
    );
  }

  private appendPolicyEvent(input: Omit<PolicyLedgerEvent, 'id' | 'at'>): PolicyLedgerEvent {
    const event: PolicyLedgerEvent = {
      id: `policy-evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: new Date().toISOString(),
      ...input,
    };
    this.policyEvents.push(event);
    return event;
  }

  createPolicyCandidate(options: CreatePolicyCandidateOptions): PolicyCandidateResult {
    const policyId = (
      options.policyId ?? (options.learningId ? `policy:${options.learningId}` : '')
    ).trim();
    if (!policyId) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'A stable policyId (or a learningId to derive one) is required',
      };
    }
    const content = options.content.trim();
    if (!content) {
      return { ok: false, code: 'INVALID_INPUT', message: 'Policy content is required' };
    }
    if (options.learningId) {
      const record = this.records.find((candidate) => candidate.id === options.learningId);
      if (!record) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `No learning record with id "${options.learningId}"`,
        };
      }
    }
    const normalized = normalizeEnforcement(options.enforcement);
    if (!normalized.ok) {
      return { ok: false, code: 'INVALID_INPUT', message: normalized.message };
    }
    const enforcement = normalized.enforcement;

    const history = this.policyVersions.get(policyId) ?? [];
    const versionNumber = history.length + 1;
    const versionId = `${policyId}@${versionNumber}`;
    const now = new Date().toISOString();
    const version: PolicyVersion = {
      policyId,
      versionId,
      version: versionNumber,
      content,
      contentHash: policyContentHash(policyId, content, enforcement),
      ...(options.learningId ? { learningId: options.learningId } : {}),
      ...(enforcement ? { enforcement } : {}),
      provenance: {
        source: options.source ?? 'learning',
        actor: options.actor.id,
        actorKind: options.actor.kind,
        createdAt: now,
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.mission ? { mission: options.mission } : {}),
      },
      createdAt: now,
    };

    history.push(version);
    this.policyVersions.set(policyId, history);
    this.appendPolicyEvent({
      type: 'candidate-created',
      policyId,
      versionId,
      contentHash: version.contentHash,
      actor: options.actor,
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return { ok: true, version: cloneVersion(version) };
  }

  validatePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; issues?: string[] },
  ): PolicyValidationResult {
    const version = this.findPolicyVersion(policyId, versionId);
    if (!version) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No policy version "${versionId}" for "${policyId}"`,
      };
    }

    const issues = (options.issues ?? []).map((issue) => issue.trim()).filter(Boolean);
    if (!version.content.trim()) issues.push('Policy content is empty');
    if (!version.policyId.trim()) issues.push('Policy id is empty');
    if (!version.provenance.actor.trim()) issues.push('Provenance actor is missing');
    if (version.learningId && !this.records.some((record) => record.id === version.learningId)) {
      issues.push(`Learning record "${version.learningId}" no longer exists`);
    }
    if (version.enforcement) {
      const normalized = normalizeEnforcement(version.enforcement);
      if (!normalized.ok) issues.push(normalized.message);
      else if (normalized.enforcement) {
        if (normalized.enforcement.match !== version.enforcement.match) {
          issues.push('Enforcement match must not be empty or padded');
        }
      }
    }
    if (
      policyContentHash(version.policyId, version.content, version.enforcement) !==
      version.contentHash
    ) {
      issues.push('Content hash mismatch — the version content was modified');
    }

    const validation: PolicyValidation = {
      versionId: version.versionId,
      contentHash: version.contentHash,
      valid: issues.length === 0,
      issues,
      checkedAt: new Date().toISOString(),
      checkedBy: { ...options.actor },
    };
    this.policyValidations.push(validation);
    this.appendPolicyEvent({
      type: validation.valid ? 'validated' : 'validation-failed',
      policyId,
      versionId,
      contentHash: version.contentHash,
      actor: options.actor,
      ...(issues.length > 0 ? { reason: issues.join('; ') } : {}),
    });
    return { ok: true, validation: cloneValidation(validation) };
  }

  approvePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; rationale: string; approvalToken?: string },
  ): PolicyApprovalResult {
    const version = this.findPolicyVersion(policyId, versionId);
    if (!version) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No policy version "${versionId}" for "${policyId}"`,
      };
    }

    if (options.actor.kind !== 'human') {
      const message = 'Only a human approver may approve a policy version';
      this.appendPolicyEvent({
        type: 'approval-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', message };
    }

    const rationale = options.rationale.trim();
    if (rationale.length < 10) {
      const message = 'A human approval requires a rationale of at least 10 characters';
      this.appendPolicyEvent({
        type: 'approval-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'INVALID_INPUT', message };
    }

    if (!this.latestValidation(version.versionId, version.contentHash, true)) {
      const message = 'A passing validation for this exact version is required before approval';
      this.appendPolicyEvent({
        type: 'approval-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'VALIDATION_REQUIRED', message };
    }

    const tokenCheck = verifyApprovalToken(version, rationale, options.approvalToken);
    if (!tokenCheck.ok) {
      this.appendPolicyEvent({
        type: 'approval-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: tokenCheck.message,
      });
      return { ok: false, code: tokenCheck.code, message: tokenCheck.message };
    }

    const existing = this.hasApproval(version.versionId, version.contentHash);
    if (existing) return { ok: true, approval: cloneApproval(existing) };

    const approval: PolicyApproval = {
      versionId: version.versionId,
      contentHash: version.contentHash,
      approvedBy: options.actor.id,
      approvedAt: new Date().toISOString(),
      rationale,
      actorKind: 'human',
      verification: tokenCheck.verification,
    };
    this.policyApprovals.push(approval);
    this.appendPolicyEvent({
      type: 'approved',
      policyId,
      versionId,
      contentHash: version.contentHash,
      actor: options.actor,
      reason: rationale,
    });
    return { ok: true, approval: cloneApproval(approval) };
  }

  activatePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; reason?: string },
  ): PolicyActivationResult {
    const version = this.findPolicyVersion(policyId, versionId);
    if (!version) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No policy version "${versionId}" for "${policyId}"`,
      };
    }
    if (options.actor.kind !== 'human') {
      const message = 'Only a human may activate a policy version';
      this.appendPolicyEvent({
        type: 'activation-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', message };
    }
    if (!this.latestValidation(version.versionId, version.contentHash, true)) {
      const message = 'A passing validation for this exact version is required before activation';
      this.appendPolicyEvent({
        type: 'activation-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'VALIDATION_REQUIRED', message };
    }
    if (!this.hasApproval(version.versionId, version.contentHash)) {
      const message = 'A human approval for this exact version is required before activation';
      this.appendPolicyEvent({
        type: 'activation-rejected',
        policyId,
        versionId,
        contentHash: version.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'APPROVAL_REQUIRED', message };
    }

    const current = this.activePolicyVersions.get(policyId);
    if (current === versionId) return { ok: true, version: cloneVersion(version) };

    const at = new Date().toISOString();
    this.policyActivations.push({
      versionId: version.versionId,
      contentHash: version.contentHash,
      action: 'activated',
      at,
      actor: { ...options.actor },
      basis: 'governed',
      ...(current ? { fromVersionId: current } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });
    this.activePolicyVersions.set(policyId, versionId);
    this.appendPolicyEvent({
      type: 'activated',
      policyId,
      versionId,
      contentHash: version.contentHash,
      actor: options.actor,
      ...(current ? { fromVersionId: current } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return { ok: true, version: cloneVersion(version) };
  }

  deactivatePolicy(
    policyId: string,
    options: { actor: PolicyActor; reason: string },
  ): PolicyDeactivationResult {
    if (options.actor.kind !== 'human') {
      const message = 'Only a human may deactivate a policy';
      this.appendPolicyEvent({
        type: 'activation-rejected',
        policyId,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', message };
    }
    const current = this.activePolicyVersions.get(policyId);
    if (!current) {
      return {
        ok: false,
        code: 'NOT_ACTIVE',
        message: `Policy "${policyId}" has no active version`,
      };
    }
    const version = this.findPolicyVersion(policyId, current);
    if (!version) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `Active version "${current}" is missing from the ledger`,
      };
    }
    const reason = options.reason.trim();
    if (reason.length < 10) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Deactivation requires a reason of at least 10 characters',
      };
    }
    this.policyActivations.push({
      versionId: version.versionId,
      contentHash: version.contentHash,
      action: 'deactivated',
      at: new Date().toISOString(),
      actor: { ...options.actor },
      basis: 'governed',
      reason,
    });
    this.activePolicyVersions.delete(policyId);
    this.appendPolicyEvent({
      type: 'deactivated',
      policyId,
      versionId: version.versionId,
      contentHash: version.contentHash,
      actor: options.actor,
      reason,
    });
    return { ok: true, policyId };
  }

  rollbackPolicy(
    policyId: string,
    toVersionId: string,
    options: { actor: PolicyActor; reason: string },
  ): PolicyRollbackResult {
    if (options.actor.kind !== 'human') {
      const message = 'Only a human may roll back a policy';
      this.appendPolicyEvent({
        type: 'rollback-rejected',
        policyId,
        toVersionId,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'HUMAN_APPROVAL_REQUIRED', message };
    }
    const reason = options.reason.trim();
    if (reason.length < 10) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'A rollback requires a reason of at least 10 characters',
      };
    }
    const target = this.findPolicyVersion(policyId, toVersionId);
    if (!target) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `No policy version "${toVersionId}" for "${policyId}"`,
      };
    }
    if (!this.latestValidation(target.versionId, target.contentHash, true)) {
      const message = 'A rollback target must have a passing validation for its exact version';
      this.appendPolicyEvent({
        type: 'rollback-rejected',
        policyId,
        toVersionId,
        contentHash: target.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'VALIDATION_REQUIRED', message };
    }
    const approved = this.hasApproval(target.versionId, target.contentHash);
    const previouslyActive = this.policyActivations.some(
      (activation) => activation.versionId === target.versionId,
    );
    if (!approved && !previouslyActive) {
      const message = 'A rollback target must be approved or have been active before';
      this.appendPolicyEvent({
        type: 'rollback-rejected',
        policyId,
        toVersionId,
        contentHash: target.contentHash,
        actor: options.actor,
        reason: message,
      });
      return { ok: false, code: 'APPROVAL_REQUIRED', message };
    }

    const current = this.activePolicyVersions.get(policyId);
    if (current === toVersionId) return { ok: true, version: cloneVersion(target) };

    this.policyActivations.push({
      versionId: target.versionId,
      contentHash: target.contentHash,
      action: 'rolled-back',
      at: new Date().toISOString(),
      actor: { ...options.actor },
      basis: 'governed',
      ...(current ? { fromVersionId: current } : {}),
      reason,
    });
    this.activePolicyVersions.set(policyId, toVersionId);
    this.appendPolicyEvent({
      type: 'rolled-back',
      policyId,
      versionId: toVersionId,
      contentHash: target.contentHash,
      actor: options.actor,
      ...(current ? { fromVersionId: current } : {}),
      toVersionId,
      reason,
    });
    return { ok: true, version: cloneVersion(target) };
  }

  monitorPolicy(
    policyId: string,
    options: { actor: PolicyActor; success: boolean; detail?: string },
  ): PolicyMonitorResult {
    const current = this.activePolicyVersions.get(policyId);
    if (!current) {
      return {
        ok: false,
        code: 'NOT_ACTIVE',
        message: `Policy "${policyId}" has no active version`,
      };
    }
    const stats = this.policyMonitoring.get(policyId) ?? { checks: 0, failures: 0 };
    const updated: PolicyMonitoring = {
      ...stats,
      checks: stats.checks + 1,
      failures: stats.failures + (options.success ? 0 : 1),
      lastCheckedAt: new Date().toISOString(),
      ...(options.detail ? { lastDetail: options.detail } : {}),
    };
    this.policyMonitoring.set(policyId, updated);
    this.appendPolicyEvent({
      type: options.success ? 'monitored' : 'monitor-failed',
      policyId,
      versionId: current,
      actor: options.actor,
      ...(options.detail ? { reason: options.detail } : {}),
    });
    return { ok: true, monitoring: { ...updated } };
  }

  getPolicyVersions(policyId: string): PolicyVersion[] {
    return (this.policyVersions.get(policyId) ?? []).map(cloneVersion);
  }

  getPolicyVersion(policyId: string, versionId: string): PolicyVersion | undefined {
    const version = this.findPolicyVersion(policyId, versionId);
    return version ? cloneVersion(version) : undefined;
  }

  getActivePolicyVersion(policyId: string): PolicyVersion | undefined {
    const versionId = this.activePolicyVersions.get(policyId);
    if (!versionId) return undefined;
    const version = this.findPolicyVersion(policyId, versionId);
    return version ? cloneVersion(version) : undefined;
  }

  /** Every currently active policy version, in stable policy-id order. */
  getActivePolicies(): PolicyVersion[] {
    return [...this.activePolicyVersions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([policyId, versionId]) => this.findPolicyVersion(policyId, versionId))
      .filter((version): version is PolicyVersion => version !== undefined)
      .map(cloneVersion);
  }

  /**
   * Evaluate the enforcement carried by active policy versions. Only `active`
   * versions participate: a candidate, validated or approved version is
   * documentation until a human activates it. The strongest action wins
   * (`deny` > `escalate`/`require` > `warn` > `allow`).
   */
  evaluateActivePolicies(action: string): PolicyEnforcementEvaluation {
    const normalizedAction = action.trim().toLowerCase();
    const matches: PolicyEnforcementMatch[] = [];
    for (const version of this.getActivePolicies()) {
      const enforcement = version.enforcement;
      if (!enforcement) continue;
      const match = enforcement.match.trim().toLowerCase();
      if (match !== '*' && !normalizedAction.includes(match)) continue;
      matches.push({
        policyId: version.policyId,
        versionId: version.versionId,
        action: enforcement.action,
        severity: enforcement.severity,
        ruleId: `policy:${version.versionId}`,
        reason:
          enforcement.description ??
          `Active policy ${version.versionId} (${enforcement.action}) matched "${action}"`,
      });
    }

    let verdict: PolicyEnforcementEvaluation['verdict'] = 'allow';
    for (const match of matches) {
      if (match.action === 'block') {
        verdict = 'deny';
        break;
      }
      if (match.action === 'escalate' || match.action === 'require') {
        verdict = 'escalate';
      } else if (match.action === 'warn' && verdict === 'allow') {
        verdict = 'warn';
      }
    }
    return { verdict, matches };
  }

  getPolicyStatus(policyId: string, versionId: string): PolicyVersionStatus | undefined {
    const version = this.findPolicyVersion(policyId, versionId);
    if (!version) return undefined;
    if (this.activePolicyVersions.get(policyId) === versionId) return 'active';
    // A version that was ever activated and is not active now (deactivated,
    // superseded by a newer version, or rolled back from) is retired.
    if (this.policyActivations.some((activation) => activation.versionId === versionId)) {
      return 'retired';
    }
    if (this.hasApproval(version.versionId, version.contentHash)) return 'approved';
    if (this.latestValidation(version.versionId, version.contentHash, true)) return 'validated';
    return 'candidate';
  }

  getPolicyValidation(versionId: string): PolicyValidation | undefined {
    for (let index = this.policyValidations.length - 1; index >= 0; index--) {
      if (this.policyValidations[index].versionId === versionId) {
        return cloneValidation(this.policyValidations[index]);
      }
    }
    return undefined;
  }

  getPolicyApproval(versionId: string): PolicyApproval | undefined {
    const approval = this.policyApprovals.find((candidate) => candidate.versionId === versionId);
    return approval ? cloneApproval(approval) : undefined;
  }

  getPolicyActivations(policyId: string): PolicyActivationRecord[] {
    return this.policyActivations
      .filter((activation) => this.findPolicyVersion(policyId, activation.versionId) !== undefined)
      .map(cloneActivation);
  }

  getPolicyLedgerEvents(policyId?: string): PolicyLedgerEvent[] {
    return this.policyEvents
      .filter((event) => !policyId || event.policyId === policyId)
      .map(cloneEvent);
  }

  getPolicyMonitoring(policyId: string): PolicyMonitoring | undefined {
    const stats = this.policyMonitoring.get(policyId);
    return stats ? { ...stats } : undefined;
  }

  snapshotPolicyLedger(): PolicyLedgerState {
    const versions: PolicyVersion[] = [];
    for (const history of this.policyVersions.values()) {
      for (const version of history) versions.push(cloneVersion(version));
    }
    return {
      versions,
      validations: this.policyValidations.map(cloneValidation),
      approvals: this.policyApprovals.map(cloneApproval),
      activations: this.policyActivations.map(cloneActivation),
      events: this.policyEvents.map(cloneEvent),
      active: Object.fromEntries(this.activePolicyVersions),
      monitoring: Object.fromEntries(
        [...this.policyMonitoring.entries()].map(([key, stats]) => [key, { ...stats }] as const),
      ),
    };
  }

  restorePolicyLedger(state: unknown): boolean {
    if (!state || typeof state !== 'object') return false;
    const candidate = state as Partial<PolicyLedgerState>;
    if (
      !Array.isArray(candidate.versions) ||
      !Array.isArray(candidate.validations) ||
      !Array.isArray(candidate.approvals) ||
      !Array.isArray(candidate.activations) ||
      !Array.isArray(candidate.events)
    ) {
      return false;
    }
    const versions = new Map<string, PolicyVersion[]>();
    for (const version of candidate.versions) {
      if (
        !version ||
        typeof version.policyId !== 'string' ||
        typeof version.versionId !== 'string' ||
        typeof version.content !== 'string' ||
        typeof version.contentHash !== 'string' ||
        !version.provenance
      ) {
        return false;
      }
      const history = versions.get(version.policyId) ?? [];
      history.push(cloneVersion(version));
      versions.set(version.policyId, history);
    }
    this.policyVersions = versions;
    this.policyValidations = candidate.validations.map(cloneValidation);
    this.policyApprovals = candidate.approvals.map(cloneApproval);
    this.policyActivations = candidate.activations.map(cloneActivation);
    this.policyEvents = candidate.events.map(cloneEvent);
    this.activePolicyVersions = new Map(Object.entries(candidate.active ?? {}));
    this.policyMonitoring = new Map(
      Object.entries(candidate.monitoring ?? {}).map(
        ([key, stats]) => [key, { ...stats }] as const,
      ),
    );
    return true;
  }

  /**
   * Import learning records that predate the ledger. A record already at
   * `policy`/`monitored` is registered as an active version 1 with a
   * `legacy-import` activation basis, so legacy behavior is preserved while the
   * exception stays visible in the audit trail.
   */
  importLegacyPolicies(): number {
    let imported = 0;
    for (const record of this.records) {
      if (record.stage !== 'policy' && record.stage !== 'monitored') continue;
      const policyId = `policy:${record.id}`;
      if (this.policyVersions.has(policyId)) continue;
      const content = record.content.trim() || record.title;
      if (!content) continue;
      const version: PolicyVersion = {
        policyId,
        versionId: `${policyId}@1`,
        version: 1,
        content,
        contentHash: policyContentHash(policyId, content),
        learningId: record.id,
        provenance: {
          source: 'legacy',
          actor: 'system',
          actorKind: 'system',
          createdAt: record.updatedAt,
          reason: 'Imported from a learning record that predates policy versioning',
        },
        createdAt: record.updatedAt,
      };
      this.policyVersions.set(policyId, [version]);
      this.activePolicyVersions.set(policyId, version.versionId);
      this.policyActivations.push({
        versionId: version.versionId,
        contentHash: version.contentHash,
        action: 'activated',
        at: record.updatedAt,
        actor: { id: 'system', kind: 'system' },
        basis: 'legacy-import',
        reason: 'Legacy policy had no versioned activation record',
      });
      this.appendPolicyEvent({
        type: 'legacy-imported',
        policyId,
        versionId: version.versionId,
        contentHash: version.contentHash,
        actor: { id: 'system', kind: 'system' },
        reason: 'Legacy learning record imported as an active baseline version',
      });
      imported += 1;
    }
    return imported;
  }

  private generateRecommendation(type: string, count: number): string {
    const recommendations: Record<string, string> = {
      failure: `Detected ${count} failures. Review error patterns and add guardrails.`,
      insight: 'Consider documenting this insight in team knowledge base.',
      fix: 'Auto-fix pattern detected. Consider creating a reusable fix template.',
      optimization: 'Performance pattern detected. Consider optimization strategy.',
    };
    return recommendations[type] || `Pattern "${type}" observed ${count} times.`;
  }
}
