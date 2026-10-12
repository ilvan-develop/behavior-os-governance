import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { PipelineEngine, type PipelineGate } from '../src/engine/pipeline-engine.js';

function passed(id: string, phase: 'pre' | 'post' = 'pre', blocking = true): PipelineGate {
  return { id, name: id, phase, blocking, evaluate: () => ({ status: 'passed' }) };
}

describe('PipelineEngine', () => {
  it('runs every gate in insertion order and reports pass', () => {
    const order: string[] = [];
    const engine = new PipelineEngine([
      {
        id: 'a',
        name: 'A',
        phase: 'pre',
        blocking: true,
        evaluate: () => {
          order.push('a');
          return { status: 'passed' };
        },
      },
      {
        id: 'b',
        name: 'B',
        phase: 'post',
        blocking: true,
        evaluate: () => {
          order.push('b');
          return { status: 'passed' };
        },
      },
    ]);

    const run = engine.run();
    expect(order).toEqual(['a', 'b']);
    expect(run.overall).toBe('pass');
    expect(run.blocked).toBe(false);
    expect(run.gates.map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('halts on the first blocking failure and marks the run blocked', () => {
    const executed: string[] = [];
    const engine = new PipelineEngine([
      {
        id: 'blocker',
        name: 'Blocker',
        phase: 'pre',
        blocking: true,
        evaluate: () => {
          executed.push('blocker');
          return { status: 'failed', details: { reason: 'nope' } };
        },
      },
      {
        id: 'after',
        name: 'After',
        phase: 'pre',
        blocking: true,
        evaluate: () => {
          executed.push('after');
          return { status: 'passed' };
        },
      },
    ]);

    const run = engine.run();
    expect(executed).toEqual(['blocker']);
    expect(run.blocked).toBe(true);
    expect(run.blockedBy).toBe('blocker');
    expect(run.overall).toBe('fail');
    expect(run.gates).toHaveLength(1);
  });

  it('records a non-blocking failure but keeps going', () => {
    const engine = new PipelineEngine([
      {
        id: 'soft',
        name: 'Soft',
        phase: 'post',
        blocking: false,
        evaluate: () => ({ status: 'failed' }),
      },
      passed('after', 'post'),
    ]);

    const run = engine.run();
    expect(run.blocked).toBe(false);
    expect(run.overall).toBe('fail');
    expect(run.gates.map((g) => g.id)).toEqual(['soft', 'after']);
  });

  it('ignores skipped gates for the overall verdict', () => {
    const engine = new PipelineEngine([
      {
        id: 'skipped',
        name: 'Skipped',
        phase: 'pre',
        blocking: true,
        evaluate: () => ({ status: 'skipped' }),
      },
    ]);
    expect(engine.run().overall).toBe('pass');
  });

  it('treats a throwing gate as a failure instead of crashing', () => {
    const engine = new PipelineEngine([
      {
        id: 'boom',
        name: 'Boom',
        phase: 'pre',
        blocking: true,
        evaluate: () => {
          throw new Error('kaboom');
        },
      },
    ]);
    const run = engine.run();
    expect(run.blocked).toBe(true);
    expect(run.gates[0]?.details.error).toBe('kaboom');
  });

  it('preflight runs only pre gates', () => {
    const executed: string[] = [];
    const engine = new PipelineEngine([
      {
        id: 'pre',
        name: 'Pre',
        phase: 'pre',
        blocking: true,
        evaluate: () => {
          executed.push('pre');
          return { status: 'passed' };
        },
      },
      {
        id: 'post',
        name: 'Post',
        phase: 'post',
        blocking: true,
        evaluate: () => {
          executed.push('post');
          return { status: 'passed' };
        },
      },
    ]);

    const result = engine.preflight();
    expect(executed).toEqual(['pre']);
    expect(result.allowed).toBe(true);
    expect(result.run.phases).toEqual(['pre']);
  });

  it('adds, replaces and removes gates by id', () => {
    const engine = new PipelineEngine();
    engine.addGate(passed('x'));
    engine.addGate({
      id: 'x',
      name: 'replaced',
      phase: 'pre',
      blocking: true,
      evaluate: () => ({ status: 'warning' }),
    });
    expect(engine.getGates()).toHaveLength(1);
    expect(engine.run().overall).toBe('warning');
    expect(engine.removeGate('x')).toBe(true);
    expect(engine.removeGate('x')).toBe(false);
    expect(engine.run().gates).toHaveLength(0);
  });
});

describe('BehaviorOS gate pipeline', () => {
  let dir: string;
  let dbPath: string;

  const dna: DNA = {
    name: 'Pipeline DNA',
    version: '1.0.0',
    description: 'DNA with a blocking rule and a quality gate',
    personas: [],
    governance: [
      {
        id: 'no-deploy',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'action', value: 'deploy' }],
        description: 'Deployments are not allowed',
      },
    ],
    quality: [{ id: 'coverage', type: 'test_coverage', threshold: 80 }],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-pipe-'));
    dbPath = join(dir, 'state.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('blocks an action synchronously before execution', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    const blocked = bos.preflightAction('deploy', { agent: 'agent-1' });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedBy).toBe('governance');
    expect(blocked.run.overall).toBe('fail');

    const allowed = bos.preflightAction('read-file', { agent: 'agent-1' });
    expect(allowed.allowed).toBe(true);
    expect(allowed.blockedBy).toBeUndefined();
  });

  it('exposes one post gate per DNA quality gate', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(dna);

    expect(
      bos
        .getPipelineEngine()
        .getGates('post')
        .map((g) => g.id),
    ).toEqual(['quality:coverage']);

    const failing = bos.runPipeline({
      action: 'test',
      agentId: 'agent-1',
      metrics: { test_coverage: 50 },
    });
    expect(failing.blocked).toBe(true);
    expect(failing.blockedBy).toBe('quality:coverage');

    const passing = bos.runPipeline({
      action: 'test',
      agentId: 'agent-1',
      metrics: { test_coverage: 95 },
    });
    expect(passing.overall).toBe('pass');
    expect(passing.blocked).toBe(false);
  });

  it('is a pass-through when no DNA is selected', () => {
    const bos = new BehaviorOS();
    const result = bos.preflightAction('deploy', { agent: 'agent-1' });
    expect(result.allowed).toBe(true);
    expect(result.run.gates.every((g) => g.status === 'skipped')).toBe(true);
  });

  it('lets callers replace the default gates', () => {
    const bos = new BehaviorOS({
      pipeline: {
        gates: [
          {
            id: 'always',
            name: 'Always',
            phase: 'pre',
            blocking: true,
            evaluate: () => ({ status: 'failed' }),
          },
        ],
      },
    });
    const result = bos.preflightAction('anything', { agent: 'agent-1' });
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe('always');
  });

  it('persists blocked pre-flights and pipeline runs to SQLite', async () => {
    const first = new BehaviorOS({ persistence: { path: dbPath } });
    await first.loadDNA(dna);

    first.preflightAction('deploy', { agent: 'agent-1' });
    first.runPipeline({ action: 'test', agentId: 'agent-1', metrics: { test_coverage: 50 } });
    expect(first.listPipelineRuns()).toHaveLength(2);
    expect(first.listPipelineRuns().some((run) => run.blocked)).toBe(true);
    first.closeStore();
    expect(first.listPipelineRuns()).toHaveLength(0);

    const second = new BehaviorOS({ persistence: { path: dbPath } });
    expect(second.listPipelineRuns()).toHaveLength(2);
    second.closeStore();
  });
});
