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
): Promise<BehaviorOS> {
  const bos = new BehaviorOS(config);
  await bos.loadDNA(makeDNA());
  for (let i = 0; i < 5; i++) {
    bos.recordLearning({ type: 'failure', source: 'ci', content: `fail ${i}`, impact: 'high' });
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
      engine.record({ type: 'failure', source: 'a', content: `f${i}`, impact: 'medium' });
    }
    expect(engine.proposeEvolution('dna')).toEqual([]);
  });

  it('proposes a warn rule for repeated high-impact failures', () => {
    const engine = new LearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.record({ type: 'failure', source: 'a', content: `f${i}`, impact: 'high' });
    }
    const proposals = engine.proposeEvolution('my-dna');
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.pattern).toBe('failure');
    expect(proposal.kind).toBe('governance-warn');
    expect(proposal.ruleId).toBe('evo-warn-failure');
    expect(proposal.confidence).toBe(0.9);
    expect(proposal.occurrences).toBe(5);
    expect(proposal.dnaName).toBe('my-dna');
    expect(proposal.evidence).toHaveLength(5);
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
      engine.record({ type: 'fix', source: 'a', content: `x${i}`, impact: 'critical' });
    }
    // 3 occurrences, critical impact -> 0.6 * 0.6 + 1 * 0.4 = 0.76
    expect(engine.proposeEvolution('dna', 0.8)).toHaveLength(0);
    expect(engine.proposeEvolution('dna', 0.7)).toHaveLength(1);
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
      id: 'evo-warn-failure',
      level: 'medium',
      action: 'warn',
      conditions: [{ type: 'pattern', value: 'failure' }],
      description: expect.stringContaining('failure'),
    });
  });

  it('warns on a matching pattern but never denies', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    bos.applyEvolution({ apply: true });

    const decision = bos.evaluateGovernance('deploy', {
      agent: 'a',
      context: { pattern: 'failure' },
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.warnings).toEqual(['Warning from rule: evo-warn-failure']);

    const unrelated = bos.evaluateGovernance('deploy', { agent: 'a', context: {} });
    expect(unrelated.verdict).toBe('allow');
    expect(unrelated.warnings).toBeUndefined();
  });

  it('records an auditable learning event per applied proposal', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });
    bos.applyEvolution({ apply: true });
    const learnings = bos.exportState().learnings;
    expect(learnings.some((l) => l.source === 'dna-evolution')).toBe(true);
  });

  it('requires approval when votes are supplied', async () => {
    const bos = await bosWithFailures({ evolution: { enabled: true } });

    const rejected = bos.applyEvolution({
      apply: true,
      votes: [{ voterId: 'a', choice: 'reject' }],
    });
    expect(rejected.decision?.outcome).toBe('rejected');
    expect(rejected.applied).toEqual([]);
    expect(bos.getDNA()?.governance).toHaveLength(0);

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
    expect(bos.listCodeFixResults()).toHaveLength(0);

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
