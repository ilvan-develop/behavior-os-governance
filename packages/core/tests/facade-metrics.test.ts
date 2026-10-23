import type { DNA, GovernanceRule } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

function dnaWith(rules: GovernanceRule[]): DNA {
  return {
    name: 'metrics-dna',
    version: '1.0.0',
    description: 'fixture',
    personas: [],
    governance: rules,
    quality: [],
  };
}

describe('BehaviorOS metrics instrumentation', () => {
  it('counts every facade evaluation, even through the host-facing path', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(
      dnaWith([
        {
          id: 'exact-write',
          level: 'high',
          action: 'block',
          conditions: [{ type: 'tool', value: 'write' }],
          description: 'no writes',
        },
        {
          id: 'note',
          level: 'low',
          action: 'warn',
          conditions: [{ type: 'tool', value: 'note' }],
          description: 'note it',
        },
      ]),
    );

    const deny = bos.evaluateGovernance('deploy', { agent: 'a', context: { tool: 'write' } });
    expect(deny.verdict).toBe('deny');
    expect(deny.firedRules).toEqual(['exact-write']);

    const warn = bos.evaluateGovernance('deploy', { agent: 'a', context: { tool: 'note' } });
    expect(warn.verdict).toBe('allow');
    expect(warn.warnings).toEqual(['Warning from rule: note']);

    const allow = bos.evaluateGovernance('deploy', { agent: 'a', context: { tool: 'shell' } });
    expect(allow.verdict).toBe('allow');

    const metrics = bos.getMetrics();
    expect(metrics.governance.totalActions).toBe(3);
    expect(metrics.governance.denied).toBe(1);
    expect(metrics.governance.warned).toBe(1);
    expect(metrics.governance.allowed).toBe(1);
    expect(metrics.governance.latencySamples).toHaveLength(3);
    // avgRulesPerAction: 2 rules examined per evaluation.
    expect(metrics.governance.avgRulesPerAction).toBe(2);
    expect(metrics.governance.topRules).toEqual([
      { id: 'exact-write', count: 1, action: 'block' },
      { id: 'note', count: 1, action: 'warn' },
    ]);
  });

  it('records the softened verdict in lenient mode', async () => {
    const bos = new BehaviorOS({ governance: { level: 'lenient' } });
    await bos.loadDNA(
      dnaWith([
        {
          id: 'exact-write',
          level: 'high',
          action: 'block',
          conditions: [{ type: 'tool', value: 'write' }],
          description: 'no writes',
        },
      ]),
    );

    const decision = bos.evaluateGovernance('deploy', { agent: 'a', context: { tool: 'write' } });
    expect(decision.verdict).toBe('escalate');
    // The rule still fired (it was the deny), and the softened verdict is counted.
    expect(bos.getMetrics().governance.escalated).toBe(1);
    expect(bos.getMetrics().governance.denied).toBe(0);
    expect(bos.getMetrics().governance.topRules[0].id).toBe('exact-write');
  });

  it('counts consensus rounds and learning events', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dnaWith([]));

    const decision = bos.decide({
      subject: 'ship it',
      votes: [
        { voterId: 'v1', choice: 'approve' },
        { voterId: 'v2', choice: 'approve', weight: 3 },
      ],
    });
    expect(decision.outcome).toBe('approved'); // 4 approve weight vs 1 reject baseline

    bos.recordLearning({ type: 'failure', source: 'tool:shell', content: 'boom', impact: 'low' });

    const metrics = bos.getMetrics();
    expect(metrics.consensus.totalRounds).toBe(1);
    expect(metrics.consensus.approved).toBe(1);
    expect(metrics.consensus.avgVoteCount).toBe(2);
    expect(metrics.consensus.avgParticipatingWeight).toBe(4);
    expect(metrics.learningEventsByType.failure).toBe(1);
    expect(metrics.learningEventsTotal).toBe(1);
  });

  it('resetMetrics() zeroes everything through the facade', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dnaWith([]));
    bos.evaluateGovernance('deploy', { agent: 'a', context: {} });
    bos.recordLearning({ type: 'insight', source: 's', content: 'c', impact: 'low' });

    bos.resetMetrics();

    const metrics = bos.getMetrics();
    expect(metrics.governance.totalActions).toBe(0);
    expect(metrics.learningEventsTotal).toBe(0);
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
