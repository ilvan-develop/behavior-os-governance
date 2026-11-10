import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { LearningEngine } from '../src/engine/learning-engine.js';

function makeDNA(): DNA {
  return {
    name: 'test-dna',
    version: '1.0.0',
    description: 'fixture',
    personas: [{ role: 'engineer', name: 'Eng', authority: 'architect', skills: ['ts'] }],
    governance: [],
    quality: [],
  };
}

async function bosWithFailures(
  config: ConstructorParameters<typeof BehaviorOS>[0] = {},
  source = 'tool:write',
): Promise<BehaviorOS> {
  const bos = new BehaviorOS(config);
  await bos.loadDNA(makeDNA());
  for (let i = 0; i < 5; i++) {
    bos.recordLearning({ type: 'failure', source, content: `fail ${i}`, impact: 'high' });
  }
  return bos;
}

describe('LearningEngine confidence', () => {
  it('scores frequency and impact on a 0..1 scale', () => {
    const engine = new LearningEngine();
    expect(engine.confidenceFor(5, 0.75)).toBe(0.9);
    expect(engine.confidenceFor(2, 0.5)).toBe(0.44);
    expect(engine.confidenceFor(0, 0)).toBe(0);
    expect(engine.confidenceFor(99, 1)).toBe(1);
  });

  it('proposes nothing below the confidence bar', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 3; i++) {
      engine.record({ type: 'failure', source: 'tool:ci', content: `f${i}`, impact: 'medium' });
    }
    expect(engine.proposeEvolution('dna')).toEqual([]);
  });

  it('proposes a tool-scoped warn rule for repeated high-impact tool failures', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'failure', source: 'tool:write', content: `f${i}`, impact: 'high' });
    }
    const proposals = engine.proposeEvolution('my-dna');
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    // The condition key must be one real hosts actually send in the context
    // bag (`tool`), so the applied rule can fire instead of being inert.
    expect(proposal.pattern).toBe('failure@write');
    expect(proposal.condition).toEqual({ type: 'tool', value: 'write' });
    expect(proposal.kind).toBe('governance-warn');
    expect(proposal.ruleId).toBe('evo-warn-failure-write');
    expect(proposal.confidence).toBe(0.9);
    expect(proposal.occurrences).toBe(5);
    expect(proposal.dnaName).toBe('my-dna');
    expect(proposal.evidence).toHaveLength(5);
  });

  it('never proposes for events without a tool token (inert rules are dead code)', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'failure', source: 'self-review', content: `f${i}`, impact: 'high' });
    }
    expect(engine.proposeEvolution('dna')).toEqual([]);
  });

  it('scopes proposals per failing tool', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'failure', source: 'tool:write', content: `w${i}`, impact: 'high' });
      engine.record({ type: 'failure', source: 'tool:shell', content: `s${i}`, impact: 'high' });
    }
    const proposals = engine.proposeEvolution('dna');
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.condition?.value).sort()).toEqual(['shell', 'write']);
  });

  it('ignores non-actionable event types', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'insight', source: 'a', content: `i${i}`, impact: 'critical' });
    }
    expect(engine.proposeEvolution('dna')).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 3; i++) {
      engine.record({ type: 'fix', source: 'tool:ci', content: `x${i}`, impact: 'critical' });
    }
    // 3 occurrences, critical impact -> 0.6 * 0.6 + 1 * 0.4 = 0.76
    expect(engine.proposeEvolution('dna', 0.8)).toHaveLength(0);
    // At 0.7 threshold: add-warn (0.76 >= 0.7) + relax-block (0.76 >= 0.75, hasCritical) = 2
    // add-block is NOT proposed (0.76 < 0.9)
    expect(engine.proposeEvolution('dna', 0.7)).toHaveLength(2);
  });
});

describe('BehaviorOS DNA evolution', () => {
  it('never applies without the opt-in flag', async () => {
    const bos = await bosWithFailures();
    const result = bos.applyEvolution({ apply: true });
    expect(result.enabled).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(bos.getDNA()?.governance).toEqual([]);
  });

  it('proposes (read-only) without mutating the DNA', async () => {
    const bos = await bosWithFailures();
    expect(bos.proposeEvolution()).toHaveLength(1);
    expect(bos.getDNA()?.governance).toEqual([]);
  });

  it('applies a non-blocking warn rule when enabled', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    const result = bos.applyEvolution({ apply: true });
    expect(result.applied).toHaveLength(1);

    const rules = bos.getDNA()?.governance ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      id: 'evo-warn-failure-write',
      level: 'medium',
      action: 'warn',
      conditions: [{ type: 'tool', value: 'write' }],
      description: expect.stringContaining('write'),
    });
  });

  it('warns on a matching tool context but never denies', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    bos.applyEvolution({ apply: true });

    const decision = bos.evaluateGovernance('run-task', {
      agent: 'a',
      context: { tool: 'write' },
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.warnings).toEqual(['Warning from rule: evo-warn-failure-write']);

    const unrelated = bos.evaluateGovernance('run-task', {
      agent: 'a',
      context: { tool: 'shell' },
    });
    expect(unrelated.verdict).toBe('allow');
    expect(unrelated.warnings).toBeUndefined();
  });

  it('records an auditable learning event per applied proposal', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    bos.applyEvolution({ apply: true });
    const learnings = bos.exportState().learnings;
    expect(learnings.some((l) => l.source === 'dna-evolution')).toBe(true);
  });

  it('applies non-vote-gated proposals regardless of vote outcome', async () => {
    // bosWithFailures uses impact: 'high' -> only add-warn proposal (requiresVote: false)
    const bos = await bosWithFailures({ evolution: { enabled: true } });

    // Rejected vote — add-warn (no vote required) is still applied
    const rejected = bos.applyEvolution({
      apply: true,
      votes: [{ voterId: 'a', choice: 'reject' }],
    });
    expect(rejected.decision?.outcome).toBe('rejected');
    expect(rejected.applied).toHaveLength(1); // add-warn applied (doesn't require vote)
    expect(bos.getDNA()?.governance).toHaveLength(1);

    // Second call: rule already applied, so no new proposals
    await bos.loadDNA(makeDNA());
    const approved = bos.applyEvolution({
      apply: true,
      votes: [{ voterId: 'a', choice: 'approve' }],
    });
    expect(approved.decision?.outcome).toBe('approved');
    expect(approved.applied).toHaveLength(1);
  });

  it('is idempotent on the proposal rule id', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    expect(bos.applyEvolution({ apply: true }).applied).toHaveLength(1);
    expect(bos.applyEvolution({ apply: true }).applied).toHaveLength(0);
    expect(bos.getDNA()?.governance).toHaveLength(1);
  });

  it('proposes add-warn, add-block, and relax-block for critical failures', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true } });
    await bos.loadDNA(makeDNA());
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'failure',
        source: 'tool:write',
        content: `critical fail ${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }

    const proposals = bos.proposeEvolution();
    // 5 critical events: confidence = min(1, 5/5)*0.6 + 1.0*0.4 = 1.0
    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.changeType).sort()).toEqual([
      'add-block',
      'add-warn',
      'relax-block',
    ]);
  });

  it('does not apply add-block without an approving vote', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true } });
    await bos.loadDNA(makeDNA());
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'failure',
        source: 'tool:shell',
        content: `critical ${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }

    // Without votes, add-block and relax-block should be skipped
    const result = bos.applyEvolution({ apply: true });
    expect(result.applied).toHaveLength(1); // only the add-warn proposal
    expect(result.voteSkipped).toHaveLength(2); // add-block and relax-block skipped
    const actions = bos.getDNA()?.governance.map((r) => r.action);
    expect(actions).toEqual(['warn']);
  });

  it('applies vote-gated proposals only when threshold is met', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true } });

    function freshDNAToRelax(): DNA {
      return {
        ...makeDNA(),
        governance: [
          {
            id: 'existing-block',
            level: 'critical',
            action: 'block',
            conditions: [{ type: 'tool', value: 'shell' }],
            description: 'Existing block rule',
          },
        ],
      };
    }
    await bos.loadDNA(freshDNAToRelax());
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'failure',
        source: 'tool:shell',
        content: `critical ${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }

    // No votes supplied — add-warn applied, vote-gated proposals skipped
    const noVotes = bos.applyEvolution({ apply: true });
    expect(noVotes.applied).toHaveLength(1); // add-warn only
    expect(noVotes.voteSkipped).toHaveLength(2); // add-block + relax-block

    // Rejected vote — add-warn still applied, vote-gated skipped
    await bos.loadDNA(freshDNAToRelax());
    const rejected = bos.applyEvolution({
      apply: true,
      votes: [
        { voterId: 'a', choice: 'reject' },
        { voterId: 'b', choice: 'reject' },
      ],
    });
    expect(rejected.applied).toHaveLength(1); // add-warn
    expect(rejected.voteSkipped).toHaveLength(2);

    // Simple majority: 60% approval (3/5) — below both thresholds
    await bos.loadDNA(freshDNAToRelax());
    const lowApproval = bos.applyEvolution({
      apply: true,
      votes: [
        { voterId: 'a', choice: 'approve' },
        { voterId: 'b', choice: 'approve' },
        { voterId: 'c', choice: 'approve' },
        { voterId: 'd', choice: 'reject' },
        { voterId: 'e', choice: 'reject' },
      ],
      policy: 'majority',
    });
    expect(lowApproval.applied).toHaveLength(1); // add-warn only
    expect(lowApproval.voteSkipped).toHaveLength(2); // 0.60 < 0.67 and < 0.90

    // Supermajority with 75% approval (3/4) — above relax-block threshold (0.67), below add-block (0.90)
    await bos.loadDNA(freshDNAToRelax());
    const supermajority = bos.applyEvolution({
      apply: true,
      votes: [
        { voterId: 'a', choice: 'approve' },
        { voterId: 'b', choice: 'approve' },
        { voterId: 'c', choice: 'approve' },
        { voterId: 'd', choice: 'reject' },
      ],
      policy: 'supermajority',
    });
    expect(supermajority.applied).toHaveLength(2); // add-warn + relax-block
    expect(supermajority.voteSkipped).toHaveLength(1); // add-block (0.75 < 0.90)

    // Near-unanimous 90% approval (9/10) — above both thresholds
    await bos.loadDNA(freshDNAToRelax());
    const nearUnanimous = bos.applyEvolution({
      apply: true,
      votes: [
        { voterId: 'a', choice: 'approve' },
        { voterId: 'b', choice: 'approve' },
        { voterId: 'c', choice: 'approve' },
        { voterId: 'd', choice: 'approve' },
        { voterId: 'e', choice: 'approve' },
        { voterId: 'f', choice: 'approve' },
        { voterId: 'g', choice: 'approve' },
        { voterId: 'h', choice: 'approve' },
        { voterId: 'i', choice: 'approve' },
        { voterId: 'j', choice: 'reject' },
      ],
      policy: 'supermajority',
    });
    expect(nearUnanimous.applied).toHaveLength(3); // all three
    expect(nearUnanimous.voteSkipped).toHaveLength(0);
    const actions = bos
      .getDNA()
      ?.governance.map((r) => r.action)
      .sort();
    expect(actions).toEqual(['block', 'escalate', 'warn']);
  });

  it('tracks voteSkipped proposals in the result', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true } });
    await bos.loadDNA(makeDNA());
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'failure',
        source: 'tool:shell',
        content: `critical ${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }

    const result = bos.applyEvolution({ apply: true });
    expect(result.voteSkipped).toBeDefined();
    expect(result.voteSkipped).toHaveLength(2);
    expect(result.voteSkipped?.map((p) => p.changeType).sort()).toEqual([
      'add-block',
      'relax-block',
    ]);
  });
});

describe('LearningEngine proposeCodeFixes', () => {
  it('proposes nothing below the confidence bar', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 2; i++) {
      engine.record({ type: 'fix', source: 'a', content: `f${i}`, impact: 'medium' });
    }
    expect(engine.proposeCodeFixes(0.8)).toEqual([]);
  });

  it('produces a proposal for repeated critical fixes', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'fix', source: 'ci', content: `fail-${i}`, impact: 'critical' });
    }
    const proposals = engine.proposeCodeFixes();
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.pattern).toBe('fix');
    expect(p.confidence).toBe(1);
    expect(p.occurrences).toBe(5);
    expect(p.suggestion).toContain('fix "fix" 5 time(s)');
    expect(p.evidence).toHaveLength(5);
  });

  it('ignores non-fix event types', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'failure', source: 'a', content: `x${i}`, impact: 'critical' });
    }
    expect(engine.proposeCodeFixes()).toEqual([]);
  });
});

describe('BehaviorOS proposeCodeFixes', () => {
  it('delegates to LearningEngine with the configured minConfidence', () => {
    const bos = new BehaviorOS({ evolution: { minConfidence: 0.9 } });
    // 3 critical fixes -> frequency 0.6, impact 1.0 -> confidence 0.76
    for (let i = 0; i < 3; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    // Below the configured default of 0.9
    expect(bos.proposeCodeFixes()).toHaveLength(0);
    // Explicit threshold overrides config
    expect(bos.proposeCodeFixes(0.7)).toHaveLength(1);
    expect(bos.proposeCodeFixes(0.7)?.[0].confidence).toBe(0.76);
  });
});

describe('BehaviorOS applyCodeFixes', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-codefix-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    // Best-effort cleanup; rmSync may fail on Windows if handles are still open.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
  it('never applies without the opt-in flag', async () => {
    const bos = new BehaviorOS({ persistence: { path: dbPath } });
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    const result = bos.applyCodeFixes({ apply: true });
    expect(result.enabled).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    bos.closeStore();
  });

  it('proposes (read-only) without mutating state', async () => {
    const bos = new BehaviorOS();
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    expect(bos.proposeCodeFixes()).toHaveLength(1);
    expect(bos.listCodeFixResults()).toHaveLength(0);
  });

  it('persists applied proposals when enabled', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true }, persistence: { path: dbPath } });
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    const result = bos.applyCodeFixes({ apply: true });
    expect(result.applied).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
    expect(bos.listCodeFixResults()).toHaveLength(1);
    const saved = bos.listCodeFixResults()[0];
    expect(saved.pattern).toBe('fix');
    expect(saved.confidence).toBe(1);
    expect(saved.applied).toBe(true);
    bos.closeStore();
  });

  it('requires approval when votes are supplied', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true }, persistence: { path: dbPath } });
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }

    const rejected = bos.applyCodeFixes({
      apply: true,
      votes: [{ voterId: 'a', choice: 'reject' }],
    });
    expect(rejected.decision?.outcome).toBe('rejected');
    expect(rejected.applied).toEqual([]);
    // The refusal itself is recorded: a rejected proposal is versioned history.
    expect(rejected.rejected).toHaveLength(1);
    const persisted = bos.listCodeFixResults();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].applied).toBe(false);
    expect(persisted[0].voteOutcome).toBe('rejected');

    const approved = bos.applyCodeFixes({
      apply: true,
      votes: [{ voterId: 'a', choice: 'approve' }],
    });
    expect(approved.decision?.outcome).toBe('approved');
    expect(approved.applied).toHaveLength(1);
    expect(approved.applied[0].voteOutcome).toBe('approved');
    bos.closeStore();
  });

  it('records an auditable learning event per applied proposal', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true }, persistence: { path: dbPath } });
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    bos.applyCodeFixes({ apply: true });
    const learnings = bos.exportState().learnings;
    expect(learnings.some((l) => l.source === 'code-fix-evolution')).toBe(true);
    bos.closeStore();
  });

  it('is idempotent on the proposal id (already-applied proposals are skipped)', async () => {
    const bos = new BehaviorOS({ evolution: { enabled: true }, persistence: { path: dbPath } });
    for (let i = 0; i < 5; i++) {
      bos.recordLearning({
        type: 'fix',
        source: 'ci',
        content: `f${i}`,
        impact: 'critical',
        advanceProtocol: false,
      });
    }
    expect(bos.applyCodeFixes({ apply: true }).applied).toHaveLength(1);
    // Second call with same events should propose but not re-apply
    // (proposeCodeFixes recalculates from events; apply records results keyed by pattern)
    const second = bos.applyCodeFixes({ apply: true });
    // Same pattern -> already persisted -> not re-applied
    expect(second.applied).toHaveLength(0);
    expect(bos.listCodeFixResults()).toHaveLength(1);
    bos.closeStore();
  });
});
