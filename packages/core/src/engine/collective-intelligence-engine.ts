/**
 * G-015: Collective Intelligence Aggregation Engine.
 *
 * Aggregates votes from multiple agents to reach collective decisions,
 * using competence-weighted voting with quorum requirements.
 */

interface Vote {
  agentId: string;
  choice: 'approve' | 'reject' | 'abstain';
  weight: number;
  confidence: number;
  rationale?: string;
}

interface CollectiveVoteInternal {
  id: string;
  proposal: string;
  votes: Vote[];
  result: 'approved' | 'rejected' | 'tie';
  collectiveConfidence: number;
}

function resolveVote(
  votes: Vote[],
  policy: 'majority' | 'supermajority' | 'unanimous',
): CollectiveVoteInternal['result'] {
  const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const approveWeight = votes
    .filter((v) => v.choice === 'approve')
    .reduce((sum, v) => sum + v.weight, 0);
  const rejectWeight = votes
    .filter((v) => v.choice === 'reject')
    .reduce((sum, v) => sum + v.weight, 0);

  if (policy === 'unanimous') {
    const totalAbstainOrApprove = votes.filter((v) => v.choice !== 'reject').length;
    return totalAbstainOrApprove === votes.length ? 'approved' : 'rejected';
  }

  const threshold = policy === 'supermajority' ? totalWeight * 0.67 : totalWeight * 0.5;

  if (approveWeight >= threshold) return 'approved';
  if (rejectWeight >= threshold) return 'rejected';
  return 'tie';
}

function computeConfidence(votes: Vote[], result: CollectiveVoteInternal['result']): number {
  if (votes.length === 0) return 0;
  if (result === 'tie') return 0.5;

  // Weighted average of confidence from agents who voted in the majority
  const majorityChoice = result === 'approved' ? 'approve' : 'reject';
  const majorityVotes = votes.filter((v) => v.choice === majorityChoice);

  if (majorityVotes.length === 0) return 0.5;

  const weightedSum = majorityVotes.reduce((sum, v) => sum + v.confidence * v.weight, 0);
  const totalWeight = majorityVotes.reduce((sum, v) => sum + v.weight, 0);

  return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0.5;
}

export class CollectiveIntelligenceEngine {
  private votes: CollectiveVoteInternal[] = [];

  /**
   * Conduct a collective vote among multiple agents.
   *
   * @param proposal - What is being decided.
   * @param votes - Individual agent votes.
   * @param policy - Voting policy (default: majority).
   * @param quorum - Minimum number of non-abstain voters required.
   */
  vote(
    proposal: string,
    votes: Vote[],
    policy: 'majority' | 'supermajority' | 'unanimous' = 'majority',
    quorum: number = Math.floor(votes.length / 2) + 1,
  ): CollectiveVoteInternal {
    const nonAbstain = votes.filter((v) => v.choice !== 'abstain');

    if (nonAbstain.length < quorum) {
      const result: CollectiveVoteInternal = {
        id: `cv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        proposal,
        votes,
        result: 'tie',
        collectiveConfidence: 0,
      };
      this.votes.push(result);
      return result;
    }

    const result_val = resolveVote(votes, policy);
    const confidence = computeConfidence(votes, result_val);

    const result: CollectiveVoteInternal = {
      id: `cv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      proposal,
      votes,
      result: result_val,
      collectiveConfidence: confidence,
    };

    this.votes.push(result);
    return result;
  }

  /** Get all recorded collective votes. */
  getVotes(): CollectiveVoteInternal[] {
    return [...this.votes];
  }

  /** Get the latest vote for a proposal. */
  getLatestProposal(proposal: string): CollectiveVoteInternal | undefined {
    const proposalVotes = this.votes.filter((v) => v.proposal === proposal);
    return proposalVotes.length > 0 ? proposalVotes[proposalVotes.length - 1] : undefined;
  }
}

export type { CollectiveVoteInternal, Vote };
