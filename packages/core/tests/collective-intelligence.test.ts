import { describe, expect, it } from 'vitest';
import { CollectiveIntelligenceEngine } from '../src/engine/collective-intelligence-engine.js';

describe('CollectiveIntelligenceEngine (G-015)', () => {
  it('reaches majority decision for approvals', () => {
    const engine = new CollectiveIntelligenceEngine();

    const votes = [
      { agentId: 'a1', choice: 'approve' as const, weight: 1, confidence: 0.9 },
      { agentId: 'a2', choice: 'approve' as const, weight: 1, confidence: 0.8 },
      { agentId: 'a3', choice: 'reject' as const, weight: 1, confidence: 0.7 },
    ];

    const result = engine.vote('Deploy to prod?', votes);
    expect(result.result).toBe('approved');
    expect(result.collectiveConfidence).toBeGreaterThan(0);
  });

  it('requires quorum for decisions', () => {
    const engine = new CollectiveIntelligenceEngine();

    const votes = [
      { agentId: 'a1', choice: 'approve' as const, weight: 1, confidence: 0.9 },
      { agentId: 'a2', choice: 'abstain' as const, weight: 1, confidence: 0.8 },
      { agentId: 'a3', choice: 'abstain' as const, weight: 1, confidence: 0.7 },
      { agentId: 'a4', choice: 'abstain' as const, weight: 1, confidence: 0.6 },
    ];

    const result = engine.vote('Deploy?', votes, 'majority', 3);
    expect(result.result).toBe('tie'); // Not enough non-abstain votes
  });

  it('supports supermajority policy', () => {
    const engine = new CollectiveIntelligenceEngine();

    const votes = [
      { agentId: 'a1', choice: 'approve' as const, weight: 1, confidence: 0.9 },
      { agentId: 'a2', choice: 'reject' as const, weight: 1, confidence: 0.8 },
      { agentId: 'a3', choice: 'reject' as const, weight: 1, confidence: 0.7 },
      { agentId: 'a4', choice: 'reject' as const, weight: 1, confidence: 0.6 },
    ];

    const result = engine.vote('Major change?', votes, 'supermajority');
    // 3/4 reject = 75% which exceeds 67% supermajority threshold
    expect(result.result).toBe('rejected');
  });

  it('uses weighted voting', () => {
    const engine = new CollectiveIntelligenceEngine();

    const votes = [
      { agentId: 'junior', choice: 'approve' as const, weight: 0.5, confidence: 0.5 },
      { agentId: 'senior', choice: 'reject' as const, weight: 2, confidence: 0.9 },
      { agentId: 'senior2', choice: 'reject' as const, weight: 2, confidence: 0.8 },
    ];

    const result = engine.vote('Block risky deploy?', votes);
    // Senior votes (4.0 total) > junior (0.5), reject wins
    expect(result.result).toBe('rejected');
  });

  it('stores vote history', () => {
    const engine = new CollectiveIntelligenceEngine();
    engine.vote('Proposal A', [{ agentId: 'a1', choice: 'approve', weight: 1, confidence: 0.9 }]);
    engine.vote('Proposal B', [{ agentId: 'a2', choice: 'reject', weight: 1, confidence: 0.8 }]);

    expect(engine.getVotes()).toHaveLength(2);
    expect(engine.getLatestProposal('Proposal A')?.result).toBe('approved');
  });
});
