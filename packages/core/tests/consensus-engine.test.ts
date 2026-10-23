import { describe, expect, it } from 'vitest';
import { ConsensusEngine } from '../src/engine/consensus-engine.js';

describe('ConsensusEngine', () => {
  const engine = new ConsensusEngine();

  it('approves with unanimous consent', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'approve' },
        { agentId: 'a2', choice: 'approve' },
      ],
      policy: 'unanimous',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('approved');
    }
  });

  it('rejects when any agent rejects under unanimous policy', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'approve' },
        { agentId: 'a2', choice: 'reject' },
      ],
      policy: 'unanimous',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('rejected');
    }
  });

  it('approves with majority', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'approve' },
        { agentId: 'a2', choice: 'approve' },
        { agentId: 'a3', choice: 'reject' },
      ],
      policy: 'majority',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('approved');
      expect(result.round.tally.approveWeight).toBe(2);
      expect(result.round.tally.rejectWeight).toBe(1);
    }
  });

  it('rejects on tie under majority', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'approve' },
        { agentId: 'a2', choice: 'reject' },
      ],
      policy: 'majority',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('rejected');
    }
  });

  it('all-abstain resolves to rejected', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'abstain' },
        { agentId: 'a2', choice: 'abstain' },
      ],
      policy: 'majority',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('rejected');
    }
  });

  it('respects quorum', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [{ agentId: 'a1', choice: 'approve' }],
      policy: 'majority',
      quorum: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.round.outcome).toBe('inconclusive');
    }
  });

  it('supports weighted votes', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [
        { agentId: 'a1', choice: 'approve', weight: 3 },
        { agentId: 'a2', choice: 'reject', weight: 1 },
      ],
      policy: 'supermajority',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3/4 = 75% >= 66.7%, so approve
      expect(result.round.outcome).toBe('approved');
    }
  });

  it('returns error for empty votes', () => {
    const result = engine.resolve({
      subject: 'Test',
      votes: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_VOTES');
    }
  });
});
