import { describe, expect, it } from 'vitest';
import { ExperientialLearningEngine } from '../src/engine/experiential-learning-engine.js';

describe('ExperientialLearningEngine (G-013)', () => {
  it('completes the full experience loop: execute → observe → reflect → abstract → apply', () => {
    const engine = new ExperientialLearningEngine();
    const record = engine.start('agent-1', 'deploy-production');
    expect(record.phase).toBe('execute');

    const observed = engine.observe(record.id, 'failure', 'Deployment failed: OOMKilled');
    expect(observed?.phase).toBe('observe');
    expect(observed?.outcome).toBe('failure');

    const reflected = engine.reflect(
      record.id,
      'The container memory limit was too low for the new workload.',
    );
    expect(reflected?.phase).toBe('reflect');

    const abstracted = engine.abstract(
      record.id,
      'Always check memory limits before deploying to production',
      0.9,
    );
    expect(abstracted?.phase).toBe('abstract');
    expect(abstracted?.confidence).toBe(0.9);

    const applied = engine.apply(record.id, 'Added memory check to pre-deploy gate');
    expect(applied?.phase).toBe('apply');
    expect(engine.getRecords()).toHaveLength(1);
    expect(engine.getActive()).toHaveLength(0);
  });

  it('rejects out-of-order phase transitions', () => {
    const engine = new ExperientialLearningEngine();
    const record = engine.start('agent-1', 'run-tests');

    // Skip straight to reflect without observe
    const skipped = engine.reflect(record.id, 'skipped observe');
    expect(skipped).toBeNull();

    // Now do it in order
    engine.observe(record.id, 'success', 'All tests passed');
    const ok = engine.reflect(record.id, 'Tests are fast and reliable');
    expect(ok).not.toBeNull();
  });

  it('summarizes agent experience history', () => {
    const engine = new ExperientialLearningEngine();

    // Complete one cycle
    const r1 = engine.start('agent-1', 'action-1');
    engine.observe(r1.id, 'success', 'worked');
    engine.reflect(r1.id, 'good');
    engine.abstract(r1.id, 'principle-1', 0.8);
    engine.apply(r1.id, 'applied');

    // Start but don't complete a second cycle
    engine.start('agent-1', 'action-2');

    const summary = engine.summarize('agent-1');
    expect(summary.completed).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.avgConfidence).toBe(0.8);
    expect(summary.outcomeBreakdown.success).toBe(1);
  });

  it('caps confidence to 0..1', () => {
    const engine = new ExperientialLearningEngine();
    const record = engine.start('agent-1', 'test');
    engine.observe(record.id, 'success', 'ok');
    engine.reflect(record.id, 'reflection');
    const result = engine.abstract(record.id, 'abstraction', 1.5);
    expect(result?.confidence).toBe(1);
  });

  it('returns null for unknown record ids', () => {
    const engine = new ExperientialLearningEngine();
    expect(engine.observe('nonexistent', 'success', 'x')).toBeNull();
    expect(engine.reflect('nonexistent', 'x')).toBeNull();
    expect(engine.abstract('nonexistent', 'x', 0.5)).toBeNull();
    expect(engine.apply('nonexistent', 'x')).toBeNull();
  });
});
