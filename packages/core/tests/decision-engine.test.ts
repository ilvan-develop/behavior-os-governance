import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Vote } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { DecisionEngine } from '../src/engine/decision-engine.js';

const approve = (id: string, weight?: number): Vote => ({ voterId: id, choice: 'approve', weight });
const reject = (id: string, weight?: number): Vote => ({ voterId: id, choice: 'reject', weight });
const abstain = (id: string): Vote => ({ voterId: id, choice: 'abstain' });

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('approves on a simple majority', () => {
    const decision = engine.decide({
      subject: 'ship',
      votes: [approve('a'), approve('b'), reject('c')],
    });
    expect(decision.outcome).toBe('approved');
    expect(decision.approve).toBe(2);
    expect(decision.reject).toBe(1);
    expect(decision.decidedBy).toEqual(['a', 'b', 'c']);
  });

  it('rejects on a tie (fail-safe)', () => {
    expect(engine.decide({ subject: 'x', votes: [approve('a'), reject('b')] }).outcome).toBe(
      'rejected',
    );
  });

  it('enforces a supermajority of two thirds', () => {
    const ok = engine.decide({
      subject: 'x',
      policy: 'supermajority',
      votes: [approve('a'), approve('b'), reject('c')],
    });
    expect(ok.outcome).toBe('approved');

    const notOk = engine.decide({
      subject: 'x',
      policy: 'supermajority',
      votes: [approve('a'), approve('b'), approve('c'), reject('d'), reject('e')],
    });
    expect(notOk.outcome).toBe('rejected');
  });

  it('requires unanimity when asked', () => {
    expect(
      engine.decide({ subject: 'x', policy: 'unanimous', votes: [approve('a'), approve('b')] })
        .outcome,
    ).toBe('approved');
    expect(
      engine.decide({ subject: 'x', policy: 'unanimous', votes: [approve('a'), reject('b')] })
        .outcome,
    ).toBe('rejected');
  });

  it('honours weighted votes', () => {
    const decision = engine.decide({
      subject: 'x',
      votes: [approve('lead', 3), reject('a'), reject('b')],
    });
    expect(decision.approve).toBe(3);
    expect(decision.reject).toBe(2);
    expect(decision.outcome).toBe('approved');
  });

  it('clamps negative weights to zero', () => {
    const decision = engine.decide({ subject: 'x', votes: [approve('a', -5), reject('b')] });
    expect(decision.approve).toBe(0);
    expect(decision.outcome).toBe('rejected');
  });

  it('reports no_quorum when participation is below the threshold', () => {
    const decision = engine.decide({ subject: 'x', quorum: 3, votes: [approve('a')] });
    expect(decision.outcome).toBe('no_quorum');
    expect(decision.quorumMet).toBe(false);
  });

  it('counts abstentions toward quorum but never approves on them alone', () => {
    const decision = engine.decide({
      subject: 'x',
      quorum: 2,
      votes: [abstain('a'), abstain('b')],
    });
    expect(decision.quorumMet).toBe(true);
    expect(decision.participatingWeight).toBe(2);
    expect(decision.decidedBy).toEqual([]);
    expect(decision.outcome).toBe('rejected');
  });

  it('records reasons from votes', () => {
    const decision = engine.decide({
      subject: 'x',
      votes: [{ voterId: 'a', choice: 'approve', reason: 'looks good' }],
    });
    expect(decision.reasons).toEqual(['a: looks good']);
  });

  it('defaults to majority policy and quorum of 1', () => {
    const decision = engine.decide({ subject: 'x', votes: [] });
    expect(decision.policy).toBe('majority');
    expect(decision.quorum).toBe(1);
    expect(decision.outcome).toBe('no_quorum');
  });
});

describe('BehaviorOS decisions', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-decision-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies configured policy/quorum defaults', () => {
    const bos = new BehaviorOS({ decision: { policy: 'unanimous', quorum: 2 } });
    const decision = bos.decide({ subject: 'x', votes: [approve('a'), reject('b')] });
    expect(decision.policy).toBe('unanimous');
    expect(decision.quorum).toBe(2);
    expect(decision.outcome).toBe('rejected');
  });

  it('lets an explicit call override the configured defaults', () => {
    const bos = new BehaviorOS({ decision: { policy: 'unanimous' } });
    const decision = bos.decide({
      subject: 'x',
      policy: 'majority',
      votes: [approve('a'), reject('b')],
    });
    expect(decision.policy).toBe('majority');
  });

  it('persists decisions and survives a reopen', () => {
    const first = new BehaviorOS({ persistence: { path: dbPath } });
    const mission = first.createMission({ title: 'm', type: 'feature', priority: 'low' });
    first.startMission(mission.id);
    first.decide({ subject: 'ship', votes: [approve('a'), approve('b')] });
    expect(first.listDecisions()).toHaveLength(1);
    expect(first.listDecisions()[0]?.missionId).toBe(mission.id);
    first.closeStore();
    expect(first.listDecisions()).toHaveLength(0);

    const second = new BehaviorOS({ persistence: { path: dbPath } });
    const decisions = second.listDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.outcome).toBe('approved');
    second.closeStore();
  });
});
