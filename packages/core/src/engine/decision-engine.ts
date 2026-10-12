import type {
  Decision,
  DecisionOutcome,
  DecisionPolicy,
  Vote,
  VoteChoice,
} from '@behavior-os/schemas';

export interface DecideOptions {
  subject: string;
  votes: Vote[];
  /** Defaults to `majority`. */
  policy?: DecisionPolicy;
  /**
   * Minimum participating weight (approve + reject + abstain) for the vote to be
   * valid. Defaults to 1 — i.e. at least one vote must be cast.
   */
  quorum?: number;
  missionId?: string;
}

export interface DecisionTally {
  approve: number;
  reject: number;
  abstain: number;
  participatingWeight: number;
}

/**
 * Deterministic voting/quorum engine. Given a set of weighted votes and a
 * policy, it returns an outcome. Ties and "all abstain" resolve to `rejected`
 * (fail-safe: a decision is never approved without positive support).
 */
export class DecisionEngine {
  decide(options: DecideOptions): Decision {
    const policy: DecisionPolicy = options.policy ?? 'majority';
    const quorum = Math.max(0, options.quorum ?? 1);
    const votes = (options.votes ?? []).map((vote) => this.normalize(vote));

    const tally = this.tally(votes);
    const decidedBy = votes.filter((vote) => vote.choice !== 'abstain').map((vote) => vote.voterId);
    const reasons = votes
      .filter((vote) => vote.reason)
      .map((vote) => `${vote.voterId}: ${vote.reason}`);

    const quorumMet = votes.length > 0 && tally.participatingWeight >= quorum;
    const outcome = this.resolve(policy, tally, quorumMet);

    return {
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject: options.subject,
      policy,
      outcome,
      quorum,
      quorumMet,
      approve: tally.approve,
      reject: tally.reject,
      abstain: tally.abstain,
      participatingWeight: tally.participatingWeight,
      votes,
      decidedBy,
      reasons,
      timestamp: new Date().toISOString(),
      ...(options.missionId ? { missionId: options.missionId } : {}),
    };
  }

  private normalize(vote: Vote): Vote {
    const weight = vote.weight === undefined ? 1 : Math.max(0, vote.weight);
    return { ...vote, weight };
  }

  private tally(votes: Vote[]): DecisionTally {
    let approve = 0;
    let reject = 0;
    let abstain = 0;
    for (const vote of votes) {
      const weight = vote.weight ?? 1;
      const choice: VoteChoice = vote.choice;
      if (choice === 'approve') approve += weight;
      else if (choice === 'reject') reject += weight;
      else abstain += weight;
    }
    return { approve, reject, abstain, participatingWeight: approve + reject + abstain };
  }

  private resolve(
    policy: DecisionPolicy,
    tally: DecisionTally,
    quorumMet: boolean,
  ): DecisionOutcome {
    if (!quorumMet) return 'no_quorum';

    const deciding = tally.approve + tally.reject;
    // Everyone abstained → no positive support: fail-safe reject.
    if (deciding === 0) return 'rejected';

    switch (policy) {
      case 'unanimous':
        return tally.reject === 0 && tally.approve > 0 ? 'approved' : 'rejected';
      case 'supermajority':
        return tally.approve >= (2 / 3) * deciding ? 'approved' : 'rejected';
      default:
        return tally.approve > tally.reject ? 'approved' : 'rejected';
    }
  }
}
