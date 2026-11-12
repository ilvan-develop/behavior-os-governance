import type {
  CodeFixProposal,
  CodeFixResult,
  Decision,
  DecisionPolicy,
  DNA,
  EvolutionProposal,
  GovernanceAction,
  LearningEvent,
  LearningImpact,
  LearningRecord,
  LearningStage,
  LearningType,
  Vote,
} from '@behavior-os/schemas';
import type { CodeFixApplyResult, EvolutionResult } from '../engine/behavior-os-types.js';
import type { DecideOptions } from '../engine/decision-engine.js';
import type {
  AdvanceLearningRecordOptions,
  CreateLearningRecordOptions,
  CreatePolicyCandidateOptions,
  LearningAdvanceResult,
  LearningEngine,
  PolicyActivationResult,
  PolicyActor,
  PolicyApprovalResult,
  PolicyCandidateResult,
  PolicyDeactivationResult,
  PolicyLedgerEvent,
  PolicyLedgerState,
  PolicyMonitoring,
  PolicyMonitorResult,
  PolicyRollbackResult,
  PolicySummary,
  PolicyValidationResult,
  PolicyVersion,
  PolicyVersionStatus,
} from '../engine/learning-engine.js';
import type { MetricsEngine } from '../engine/metrics-engine.js';
import * as GovernanceLog from '../governance-log.js';
import type { Store } from '../persistence/store.js';

/**
 * What the learning + policy + evolution service needs from its host (the
 * BehaviorOS facade). The host owns the DNA, the agent state, the metrics
 * sink and the decision engine; the service owns the pure lifecycle logic.
 */
export interface LearningPolicyServiceHost {
  learningEngine(): LearningEngine;
  metricsEngine(): MetricsEngine;
  store(): Store | null;
  /** The full facade config (decision defaults, evolution toggles). */
  config(): {
    decision?: { policy?: DecisionPolicy; quorum?: number };
    evolution?: { minConfidence?: number; enabled?: boolean };
  };
  /** The currently loaded DNA (or null when no pattern is selected). */
  dna(): DNA | null;
  /** Advance the active DNA with new governance rules and rebuild its engines. */
  replaceDna(dna: DNA): void;
  /** Id of the mission currently in flight, used to stamp code-fix records. */
  activeMission(): string | null;
  /**
   * The 7-step protocol cursor, so policy-mutation log entries can be
   * attributed to the same context as every other governance event.
   */
  currentStep(): number;
  /** Advance the 7-step protocol when the caller is an explicit agent action. */
  advanceProtocolStep(tool: string): void;
  /** Evaluate a weighted vote through the decision engine. */
  decide(options: DecideOptions): Decision;
}

export interface RecordLearningRequest {
  type: string;
  source: string;
  content: string;
  impact: string;
  relatedMission?: string;
  relatedPattern?: string;
  /**
   * Whether recording this event should advance the 7-step protocol. Internal
   * automation (e.g. the OpenCode hook capturing tool failures) passes `false`
   * so only agent-driven calls move the protocol forward. Defaults to `true`.
   */
  advanceProtocol?: boolean;
}

/**
 * Learning events, the governed learning-record lifecycle (G-014), the
 * versioned policy ledger and DNA/code-fix evolution, extracted from the
 * BehaviorOS facade (Fase 2.6).
 *
 * The facade keeps the same public API as thin delegates; this service owns
 * the persistence + governance-log side effects and the evolution vote gates.
 */
export class LearningPolicyService {
  constructor(private readonly host: LearningPolicyServiceHost) {}

  // ── Learning events ─────────────────────────────────────────────────────

  recordLearning(options: RecordLearningRequest): LearningEvent {
    const event = this.host.learningEngine().record({
      ...options,
      type: options.type as LearningType,
      impact: options.impact as LearningImpact,
    });
    this.host.metricsEngine().recordLearningEvent(event.type);
    if (options.advanceProtocol !== false) {
      this.host.advanceProtocolStep('bos_record_learning');
    }
    this.host.store()?.saveLearning(event);
    return event;
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.host.learningEngine().getInsights(limit);
  }

  /** All recorded learning events, in the order the engine keeps them. */
  getLearningEvents(): LearningEvent[] {
    return this.host.learningEngine().getEvents();
  }

  // ── Governed learning lifecycle (G-014) ────────────────────────────────

  createLearningRecord(options: CreateLearningRecordOptions): LearningRecord {
    const record = this.host.learningEngine().createRecord(options);
    this.persistLearningRecords();
    return record;
  }

  /** Promote a learning record exactly one lifecycle stage forward. */
  advanceLearningRecord(
    id: string,
    to: LearningStage,
    options: AdvanceLearningRecordOptions = {},
  ): LearningAdvanceResult {
    const result = this.host.learningEngine().advanceRecord(id, to, options);
    if (result.ok) this.persistLearningRecords();
    return result;
  }

  getLearningRecords(): LearningRecord[] {
    return this.host.learningEngine().getRecords();
  }

  /** Write the learning-record lifecycle (G-014) to the store's metadata. */
  persistLearningRecords(): void {
    this.host
      .store()
      ?.setMeta('learning-records', JSON.stringify(this.host.learningEngine().snapshotRecords()));
  }

  // ── Governed policy versioning ─────────────────────────────────────────

  createPolicyCandidate(options: CreatePolicyCandidateOptions): PolicyCandidateResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().createPolicyCandidate(options);
    this.afterPolicyMutation(result.ok ? result.version.policyId : options.policyId, before);
    return result;
  }

  validatePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; issues?: string[] },
  ): PolicyValidationResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().validatePolicyVersion(policyId, versionId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  approvePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; rationale: string; approvalToken?: string },
  ): PolicyApprovalResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().approvePolicyVersion(policyId, versionId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  activatePolicyVersion(
    policyId: string,
    versionId: string,
    options: { actor: PolicyActor; reason?: string },
  ): PolicyActivationResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().activatePolicyVersion(policyId, versionId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  deactivatePolicy(
    policyId: string,
    options: { actor: PolicyActor; reason: string },
  ): PolicyDeactivationResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().deactivatePolicy(policyId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  rollbackPolicy(
    policyId: string,
    toVersionId: string,
    options: { actor: PolicyActor; reason: string },
  ): PolicyRollbackResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().rollbackPolicy(policyId, toVersionId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  monitorPolicy(
    policyId: string,
    options: { actor: PolicyActor; success: boolean; detail?: string },
  ): PolicyMonitorResult {
    const before = this.host.learningEngine().getPolicyLedgerEvents().length;
    const result = this.host.learningEngine().monitorPolicy(policyId, options);
    this.afterPolicyMutation(policyId, before);
    return result;
  }

  getPolicyVersions(policyId: string): PolicyVersion[] {
    return this.host.learningEngine().getPolicyVersions(policyId);
  }

  getPolicyVersion(policyId: string, versionId: string): PolicyVersion | undefined {
    return this.host.learningEngine().getPolicyVersion(policyId, versionId);
  }

  getActivePolicyVersion(policyId: string): PolicyVersion | undefined {
    return this.host.learningEngine().getActivePolicyVersion(policyId);
  }

  getPolicyStatus(policyId: string, versionId: string): PolicyVersionStatus | undefined {
    return this.host.learningEngine().getPolicyStatus(policyId, versionId);
  }

  getPolicyActivations(policyId: string) {
    return this.host.learningEngine().getPolicyActivations(policyId);
  }

  getPolicyValidation(versionId: string) {
    return this.host.learningEngine().getPolicyValidation(versionId);
  }

  getPolicyApproval(versionId: string) {
    return this.host.learningEngine().getPolicyApproval(versionId);
  }

  getPolicyLedgerEvents(policyId?: string): PolicyLedgerEvent[] {
    return this.host.learningEngine().getPolicyLedgerEvents(policyId);
  }

  getPolicyMonitoring(policyId: string): PolicyMonitoring | undefined {
    return this.host.learningEngine().getPolicyMonitoring(policyId);
  }

  /** Every policy identity with its latest/active version and status. */
  listPolicies(): PolicySummary[] {
    return this.host.learningEngine().listPolicies();
  }

  getPolicyLedgerSnapshot(): PolicyLedgerState {
    return this.host.learningEngine().snapshotPolicyLedger();
  }

  /** Write the policy ledger to the store's existing `meta` key-value table. */
  persistPolicyLedger(): void {
    const store = this.host.store();
    if (!store) return;
    store.setMeta(
      'policy-ledger',
      JSON.stringify(this.host.learningEngine().snapshotPolicyLedger()),
    );
  }

  /**
   * Persist after a policy mutation and mirror the newest ledger event into the
   * hash-chained governance log so every transition is auditable via
   * `bos_get_log` / `bos_verify_audit_trail`.
   */
  private afterPolicyMutation(_policyId?: string, previousEventCount = 0): void {
    this.persistPolicyLedger();
    const allEvents = this.host.learningEngine().getPolicyLedgerEvents();
    if (allEvents.length <= previousEventCount) return;
    const event = allEvents[allEvents.length - 1];
    const rejected =
      event.type.endsWith('-rejected') ||
      event.type === 'validation-failed' ||
      event.type === 'monitor-failed';
    const dna = this.host.dna();
    GovernanceLog.appendGovernanceLog({
      kind: 'learning',
      outcome: rejected ? 'deny' : 'info',
      dna: dna?.name ?? null,
      step: this.host.currentStep(),
      mission: this.host.activeMission() ?? null,
      action: `policy:${event.type}`,
      detail: `${event.policyId}${event.versionId ? ` ${event.versionId}` : ''} actor=${event.actor.id} (${event.actor.kind})${
        event.reason ? ` reason=${event.reason}` : ''
      }`,
    });
  }

  // ── DNA evolution (learning-driven) ────────────────────────────────────

  /**
   * Confidence-scored DNA-change proposals derived from repeated learning
   * events. Pure read: nothing is mutated. Default `minConfidence` is 0.8.
   */
  proposeEvolution(
    minConfidence = this.host.config().evolution?.minConfidence ?? 0.8,
  ): EvolutionProposal[] {
    return this.host
      .learningEngine()
      .proposeEvolution(this.host.dna()?.name ?? 'default', minConfidence);
  }

  /**
   * Apply evolution proposals to the active DNA. This only happens when
   * `config.evolution.enabled` is true and the caller passes `apply: true`.
   *
   * Proposals are applied per-type:
   * - `add-warn`: adds a new `warn` rule — no vote required, safe by construction.
   * - `relax-block`: relaxes a `block` rule to `escalate` or `warn` — requires
   *   a vote gate with threshold 0.67 (supermajority).
   * - `add-block`: adds a new `block` rule — requires a vote gate with
   *   threshold 0.90 (near-unanimous).
   *
   * When `votes` are supplied, the decision engine evaluates each vote-gated
   * proposal independently. Proposals without `requiresVote` are applied
   * directly; proposals with `requiresVote` are skipped unless the supplied
   * votes meet or exceed the proposal's `voteThreshold`.
   */
  applyEvolution(
    options: {
      minConfidence?: number;
      apply?: boolean;
      votes?: Vote[];
      policy?: DecisionPolicy;
    } = {},
  ): EvolutionResult {
    const minConfidence =
      options.minConfidence ?? this.host.config().evolution?.minConfidence ?? 0.8;
    const proposals = this.proposeEvolution(minConfidence);
    const enabled = this.host.config().evolution?.enabled === true;
    const dna = this.host.dna();

    if (options.apply !== true || !enabled || !dna) {
      return { proposals, applied: [], enabled };
    }

    // When votes are supplied, evaluate them against vote-gated proposals.
    let voteApproval: Decision | undefined;
    if (options.votes && options.votes.length > 0) {
      voteApproval = this.host.decide({
        subject: `DNA evolution (${proposals.length} proposal(s))`,
        votes: options.votes,
        policy: options.policy ?? 'majority',
      });
    }

    const governance = [...dna.governance];
    const applied: EvolutionProposal[] = [];
    const voteSkipped: EvolutionProposal[] = [];

    for (const proposal of proposals) {
      if (governance.some((rule) => rule.id === proposal.ruleId)) continue;
      // Guard against the inert rule regression: a proposal whose condition no
      // real host context key can match would never fire.
      if (!proposal.condition) continue;

      // Determine the effective action for this proposal
      let ruleAction: 'warn' | 'escalate' | 'block' = 'warn';

      // Vote-gate check for proposals that require approval.
      // Only vote-gated proposals are affected; add-warn proposals
      // (requiresVote: false) are applied directly.
      if (proposal.requiresVote && (proposal.voteThreshold ?? 0) > 0) {
        if (voteApproval?.outcome !== 'approved') {
          voteSkipped.push(proposal);
          continue;
        }
        const totalWeight = voteApproval.approve + voteApproval.reject + voteApproval.abstain;
        const approvalRatio = totalWeight > 0 ? voteApproval.approve / totalWeight : 0;
        if (approvalRatio < proposal.voteThreshold) {
          voteSkipped.push(proposal);
          continue;
        }
      }

      if (proposal.changeType === 'relax-block') {
        // Relax: find the existing block/escalate rule and soften it
        const existing = governance.find((r) => r.action === 'block' || r.action === 'escalate');
        if (existing) {
          ruleAction = existing.action === 'block' ? 'escalate' : 'warn';
          existing.action = ruleAction;
          existing.conditions = [...(existing.conditions ?? []), proposal.condition];
          existing.description = `${existing.description ?? ''} [relaxed by evolution]`;
          applied.push(proposal);
          continue;
        }
        // No block/escalate rule to relax — skip
        continue;
      }

      if (proposal.changeType === 'add-block') {
        ruleAction = 'block';
      }

      // Add the new rule
      const level =
        (ruleAction as 'warn' | 'escalate' | 'block') === 'block'
          ? 'critical'
          : (ruleAction as 'warn' | 'escalate' | 'block') === 'escalate'
            ? 'high'
            : 'medium';
      governance.push({
        id: proposal.ruleId,
        level,
        action: ruleAction as GovernanceAction,
        conditions: [proposal.condition],
        description: proposal.description,
      });
      applied.push(proposal);
    }

    if (applied.length > 0) {
      // New object identity so the registry rebuilds the DNA-bound engines.
      this.host.replaceDna({ ...dna, governance });
      for (const proposal of applied) {
        this.recordLearning({
          type: 'optimization',
          source: 'dna-evolution',
          content: `Applied ${proposal.changeType} rule ${proposal.ruleId} (confidence ${proposal.confidence})`,
          impact: proposal.changeType === 'add-block' ? 'high' : 'medium',
          relatedPattern: proposal.pattern,
          advanceProtocol: false,
        });
      }
    }

    return {
      proposals,
      applied,
      enabled,
      voteSkipped,
      ...(voteApproval ? { decision: voteApproval } : {}),
    };
  }

  // ── Code-fix evolution ─────────────────────────────────────────────────

  /**
   * Confidence-scored code-fix proposals derived from repeated `fix` events.
   * This is a pure read — no files are touched. Default `minConfidence` is
   * three `fix` events of impact `critical` reach ~0.84 and qualify.
   */
  proposeCodeFixes(
    minConfidence = this.host.config().evolution?.minConfidence ?? 0.8,
  ): CodeFixProposal[] {
    return this.host.learningEngine().proposeCodeFixes(minConfidence);
  }

  applyCodeFixes(
    options: {
      minConfidence?: number;
      apply?: boolean;
      votes?: Vote[];
      policy?: DecisionPolicy;
    } = {},
  ): CodeFixApplyResult {
    const minConfidence =
      options.minConfidence ?? this.host.config().evolution?.minConfidence ?? 0.8;
    const proposals = this.proposeCodeFixes(minConfidence);
    const enabled = this.host.config().evolution?.enabled === true;

    if (options.apply !== true || !enabled) {
      return { proposals, applied: [], rejected: [], enabled };
    }

    let decision: Decision | undefined;
    let voteOutcome: Decision['outcome'] | undefined;
    let voteTally: { approve: number; reject: number; abstain: number } | undefined;
    if (options.votes && options.votes.length > 0) {
      decision = this.host.decide({
        subject: `Code fix evolution (${proposals.length} proposal(s))`,
        votes: options.votes,
        policy: options.policy,
      });
      voteOutcome = decision.outcome;
      voteTally = { approve: decision.approve, reject: decision.reject, abstain: decision.abstain };
      if (decision.outcome !== 'approved') {
        // Record the refusal so the proposal history stays versioned: a rejected
        // proposal is evidence, not noise.
        const rejected = this.recordCodeFixResults(proposals, {
          applied: false,
          voteOutcome,
          voteTally,
        });
        return { proposals, applied: [], rejected, enabled, decision };
      }
    }

    // Only *applied* records block a re-application, so a proposal that was
    // rejected once can still be approved later.
    const existingPatterns = new Set(
      this.listCodeFixResults()
        .filter((result) => result.applied)
        .map((result) => result.pattern),
    );
    const fresh = proposals.filter((proposal) => !existingPatterns.has(proposal.pattern));
    const applied = this.recordCodeFixResults(fresh, {
      applied: true,
      ...(voteOutcome ? { voteOutcome } : {}),
      ...(voteTally ? { voteTally } : {}),
    });
    for (const result of applied) {
      this.recordLearning({
        type: 'optimization',
        source: 'code-fix-evolution',
        content: `Applied code fix for pattern ${result.pattern} (confidence ${result.confidence})`,
        impact: 'medium',
        relatedPattern: result.pattern,
        advanceProtocol: false,
      });
    }

    return { proposals, applied, rejected: [], enabled, ...(decision ? { decision } : {}) };
  }

  /**
   * Persist one {@link CodeFixResult} per proposal. Best effort: without a store
   * the records are still returned, like the rest of the engine.
   */
  private recordCodeFixResults(
    proposals: CodeFixProposal[],
    options: {
      applied: boolean;
      voteOutcome?: Decision['outcome'];
      voteTally?: { approve: number; reject: number; abstain: number };
    },
  ): CodeFixResult[] {
    return proposals.map((proposal) => {
      const result: CodeFixResult = {
        id: `fixr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        proposalId: proposal.id,
        pattern: proposal.pattern,
        confidence: proposal.confidence,
        applied: options.applied,
        ...(options.voteOutcome ? { voteOutcome: options.voteOutcome } : {}),
        ...(options.voteTally ? { voteTally: options.voteTally } : {}),
        ...(this.host.activeMission() ? { missionId: this.host.activeMission() ?? undefined } : {}),
        timestamp: new Date().toISOString(),
      };
      this.host.store()?.saveCodeFixResult(result);
      return result;
    });
  }

  /**
   * Read persisted code-fix results, newest first. Empty without a store.
   */
  listCodeFixResults(limit = 50): CodeFixResult[] {
    return this.host.store()?.listCodeFixResults(limit) ?? [];
  }
}
