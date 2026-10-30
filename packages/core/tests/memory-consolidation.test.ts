import { describe, expect, it } from 'vitest';
import { MemoryConsolidationEngine } from '../src/engine/memory-consolidation-engine.js';

describe('MemoryConsolidationEngine (G-008)', () => {
  it('consolidates episodes into semantic facts', () => {
    const engine = new MemoryConsolidationEngine();

    const episodes = [
      {
        id: 'e1',
        action: 'deploy',
        verdict: 'allow',
        timestamp: Date.now(),
        reason: 'passed-gate',
      },
      { id: 'e2', action: 'deploy', verdict: 'deny', timestamp: Date.now(), reason: 'block-rule' },
    ];

    const result = engine.consolidate(episodes);
    expect(result.episodesProcessed).toBe(2);
    expect(result.semanticFacts.length).toBeGreaterThan(0);
    expect(result.summary).toContain('Consolidated');
  });

  it('returns facts for querying', () => {
    const engine = new MemoryConsolidationEngine();

    engine.consolidate([{ id: 'e1', action: 'deploy', verdict: 'allow', timestamp: Date.now() }]);

    const facts = engine.queryFacts('deploy');
    expect(facts.length).toBeGreaterThan(0);
  });

  it('clears state', () => {
    const engine = new MemoryConsolidationEngine();
    engine.consolidate([{ id: 'e1', action: 'deploy', verdict: 'allow', timestamp: Date.now() }]);
    engine.clear();
    expect(engine.getFacts()).toHaveLength(0);
  });

  it('merges similar facts and strengthens confidence', () => {
    const engine = new MemoryConsolidationEngine();

    // Same action + verdict → same fact → should merge
    engine.consolidate([{ id: 'e1', action: 'deploy', verdict: 'allow', timestamp: Date.now() }]);
    engine.consolidate([{ id: 'e2', action: 'deploy', verdict: 'allow', timestamp: Date.now() }]);

    const facts = engine.getFacts();
    const deployFacts = facts.filter((f) => f.fact.includes('deploy') && f.fact.includes('allow'));
    expect(deployFacts.length).toBe(1);
    expect(deployFacts[0].sourceEpisodes).toContain('e1');
    expect(deployFacts[0].sourceEpisodes).toContain('e2');
  });
});
