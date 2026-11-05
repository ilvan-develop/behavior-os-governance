import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { LoopManager } from '../src/loop-manager.js';

const LOOP_TEST_DNA: DNA = {
  name: 'Delegation Budget DNA',
  version: '1.0.0',
  description: 'DNA for loop-manager shared budget tests',
  personas: [
    { role: 'fixer', name: 'fixer-one', authority: 'write', skills: ['implement'] },
    { role: 'fixer', name: 'fixer-two', authority: 'write', skills: ['implement'] },
  ],
  governance: [],
  quality: [],
};

function fastTask(agentName: string) {
  return {
    id: `task-${agentName}`,
    objective: 'quick command',
    adapter: 'shell',
    agentId: `persona:${agentName}`,
    input: { command: 'node', args: ['-e', 'console.log("ok")'] },
    acceptance: [
      {
        gate: 'stdout',
        description: 'ok',
        type: 'stdout-contains' as const,
        expected: 'ok',
        required: true,
      },
    ],
  };
}

describe('LoopManager shared concurrency budget', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes a shared DelegationEngine that is injected into every loop', async () => {
    const rootDir = join(
      tmpdir(),
      `loop-budget-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(rootDir, { recursive: true });
    createdDirs.push(rootDir);

    const behaviorOS = new BehaviorOS();
    const manager = new LoopManager(behaviorOS, rootDir);
    const engine = manager.getDelegationEngine();
    expect(engine).toBeDefined();

    // Prove that the manager's engine is the one used by a loop.
    const result = await manager.start({
      title: 'A',
      tasks: [fastTask('fixer-one')],
      dna: LOOP_TEST_DNA,
    });
    expect(result.state.tasks[0].status).toBe('completed');
    expect(result.state.tasks[0].assignedAgentId).toBe('persona:fixer-one');
    expect(engine.activeAgentCount()).toBe(0);
  });
});
