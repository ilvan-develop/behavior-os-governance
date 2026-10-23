/**
 * A single agent's vote in a consensus round.
 *
 * Votes are weighted: higher-weight agents (e.g. " Lead Surgeon" in surgical-team)
 * tilt the outcome, but a unanimous reject still overrides a majority approve.
 */
export interface ConsensusVote {
  /** Stable agent identifier. */
  agentId: string;
  /** Weight in the tally; defaults to 1. */
  weight?: number;
  /** `approve`, `reject` or `abstain`. */
  choice: 'approve' | 'reject' | 'abstain';
  /** Human-readable justification. */
  reason?: string;
}

/** Policy used to resolve a round. */
export type ConsensusPolicy = 'unanimous' | 'supermajority' | 'majority';

/** Threshold for supermajority (default 2/3). */
export const DEFAULT_SUPERMAJORITY_THRESHOLD = 2 / 3;

/** One round of multi-agent consensus. */
export interface ConsensusRound {
  /** Unique run id. */
  id: string;
  /** Subject being decided (e.g. mission title, rule id, proposed change). */
  subject: string;
  /** Policy applied. */
  policy: ConsensusPolicy;
  /** Minimum participating weight. */
  quorum: number;
  /** Votes cast. */
  votes: ConsensusVote[];
  /** Tally summary. */
  tally: ConsensusTally;
  /** Resolved outcome. */
  outcome: 'approved' | 'rejected' | 'inconclusive';
  /** Reason text for the outcome. */
  reason: string;
  /** Timestamp of resolution. */
  timestamp: string;
}

export interface ConsensusTally {
  approveWeight: number;
  rejectWeight: number;
  abstainWeight: number;
  totalParticipating: number;
  approveRatio: number;
  rejectRatio: number;
}

export interface ResolveConsensusOptions {
  subject: string;
  votes: ConsensusVote[];
  policy?: ConsensusPolicy;
  quorum?: number;
  supermajorityThreshold?: number;
}

export interface ConsensusResult {
  ok: true;
  round: ConsensusRound;
}

export interface ConsensusError {
  ok: false;
  code: 'INVALID_VOTES' | 'QUORUM_NOT_MET' | 'POLICY_UNKNOWN';
  message: string;
}

export type ConsensusOutcome = ConsensusResult | ConsensusError;

/**
 * Deterministic consensus resolver.
 *
 * Rules:
 * - Ties and all-abstain resolve to `rejected` (fail-safe).
 * - `unanimous`: every non-abstain vote must be `approve`.
 * - `supermajority`: approve ratio must meet the threshold.
 * - `majority`: more approve than reject.
 * - Quorum is a participation floor; if not met the round is `inconclusive`.
 */
export class ConsensusEngine {
  resolve(options: ResolveConsensusOptions): ConsensusOutcome {
    const votes = (options.votes ?? []).map((v) => this.normalize(v));
    const policy: ConsensusPolicy = options.policy ?? 'majority';
    const quorum = Math.max(0, options.quorum ?? 1);
    const threshold =
      options.supermajorityThreshold ??
      (policy === 'supermajority' ? DEFAULT_SUPERMAJORITY_THRESHOLD : 1);

    if (votes.length === 0) {
      return {
        ok: false,
        code: 'INVALID_VOTES',
        message: 'At least one vote is required',
      };
    }

    const tally = this.tally(votes);
    const quorumMet = tally.totalParticipating >= quorum;

    if (!quorumMet) {
      return {
        ok: true,
        round: this.toRound(
          options.subject,
          policy,
          quorum,
          votes,
          tally,
          'inconclusive',
          'Quorum not met',
        ),
      };
    }

    const outcome = this.resolveOutcome(policy, tally, threshold);
    const reason = this.outcomeReason(policy, tally, outcome);

    return {
      ok: true,
      round: this.toRound(options.subject, policy, quorum, votes, tally, outcome, reason),
    };
  }

  private normalize(vote: ConsensusVote): ConsensusVote {
    const weight = Math.max(0, vote.weight ?? 1);
    return { ...vote, weight };
  }

  private tally(votes: ConsensusVote[]): ConsensusTally {
    let approve = 0;
    let reject = 0;
    let abstain = 0;

    for (const v of votes) {
      const w = v.weight ?? 1;
      if (v.choice === 'approve') approve += w;
      else if (v.choice === 'reject') reject += w;
      else abstain += w;
    }

    const total = approve + reject + abstain;
    return {
      approveWeight: approve,
      rejectWeight: reject,
      abstainWeight: abstain,
      totalParticipating: total,
      approveRatio: total > 0 ? approve / total : 0,
      rejectRatio: total > 0 ? reject / total : 0,
    };
  }

  private resolveOutcome(
    policy: ConsensusPolicy,
    tally: ConsensusTally,
    threshold: number,
  ): 'approved' | 'rejected' | 'inconclusive' {
    if (tally.totalParticipating === 0) return 'rejected';

    if (policy === 'unanimous') {
      // Every non-abstain must approve; any reject → rejected.
      return tally.rejectWeight > 0 ? 'rejected' : 'approved';
    }

    if (policy === 'supermajority') {
      if (tally.rejectWeight > 0 && tally.rejectRatio >= threshold) return 'rejected';
      return tally.approveRatio >= threshold ? 'approved' : 'rejected';
    }

    // majority
    if (tally.approveWeight > tally.rejectWeight) return 'approved';
    return 'rejected';
  }

  private outcomeReason(
    policy: ConsensusPolicy,
    tally: ConsensusTally,
    outcome: 'approved' | 'rejected' | 'inconclusive',
  ): string {
    if (outcome === 'inconclusive') return 'Quorum not met';
    if (outcome === 'approved') {
      if (policy === 'unanimous')
        return `Unanimous approve (${tally.approveWeight}/${tally.totalParticipating})`;
      if (policy === 'supermajority')
        return `Supermajority approve (${(tally.approveRatio * 100).toFixed(0)}%)`;
      return `Majority approve (${tally.approveWeight} vs ${tally.rejectWeight})`;
    }
    if (policy === 'unanimous') return `Unanimous reject — at least one reject`;
    if (policy === 'supermajority')
      return `Supermajority failed — approve ${(tally.approveRatio * 100).toFixed(0)}% < ${(DEFAULT_SUPERMAJORITY_THRESHOLD * 100).toFixed(0)}%`;
    return `Majority reject (${tally.rejectWeight} vs ${tally.approveWeight})`;
  }

  private toRound(
    subject: string,
    policy: ConsensusPolicy,
    quorum: number,
    votes: ConsensusVote[],
    tally: ConsensusTally,
    outcome: 'approved' | 'rejected' | 'inconclusive',
    reason: string,
  ): ConsensusRound {
    return {
      id: `consensus-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject,
      policy,
      quorum,
      votes,
      tally,
      outcome,
      reason,
      timestamp: new Date().toISOString(),
    };
  }
}
