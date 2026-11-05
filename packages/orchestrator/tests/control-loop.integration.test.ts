import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { AdapterResult, DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AdapterExecutionContext,
  AutonomousOrchestrator,
  ControlLoop,
  type ControlLoopPlan,
  type ControlTaskDefinition,
} from '../src/index.js';

const TEST_DNA: DNA = {
  name: 'Control Loop Integration DNA',
  version: '1.0.0',
  description: 'Minimal DNA for control-loop integration tests',
  personas: [
    {
      role: 'builder',
      name: 'Builder',
      authority: 'admin',
      skills: ['execute'],
    },
  ],
  governance: [],
  quality: [],
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryStatePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bos-control-loop-integration-'));
  temporaryDirectories.push(directory);
  return join(directory, 'control-state.json');
}

function task(id: string, overrides: Partial<ControlTaskDefinition> = {}): ControlTaskDefinition {
  return {
    id,
    objective: `execute ${id}`,
    adapter: 'record',
    input: {},
    acceptance: [
      {
        gate: `gate-${id}`,
        description: `gate ${id}`,
        type: 'exit-code',
        expected: '0',
      },
    ],
    ...overrides,
  };
}

function plan(
  tasks: ControlTaskDefinition[],
  overrides: Partial<ControlLoopPlan> = {},
): ControlLoopPlan {
  return {
    title: 'Control loop integration mission',
    type: 'feature',
    priority: 'high',
    tasks,
    ...overrides,
  };
}

interface RecordedCall {
  taskId: string;
  missionId: string;
  idempotencyKey: string;
  attempt: number;
}

function recordAdapter(calls: RecordedCall[], name = 'record') {
  return {
    name,
    async execute(_input: Record<string, unknown>, context: AdapterExecutionContext) {
      calls.push({
        taskId: context.taskId,
        missionId: context.missionId,
        idempotencyKey: context.idempotencyKey,
        attempt: context.attempt,
      });
      return { exitCode: 0, stdout: 'ok', stderr: '' } satisfies AdapterResult;
    },
  };
}

function harness(
  tasks: ControlTaskDefinition[],
  options: {
    calls?: RecordedCall[];
    dna?: DNA;
    planOverrides?: Partial<ControlLoopPlan>;
  } = {},
) {
  const statePath = temporaryStatePath();
  const calls = options.calls ?? [];
  const dna = options.dna ?? TEST_DNA;
  const behaviorOS = new BehaviorOS();
  const orchestrator = new AutonomousOrchestrator({ behaviorOS, dna });
  orchestrator.registerAgent({
    id: 'agent-1',
    dnaPattern: dna.name,
    capabilities: ['execute'],
    authority: 'admin',
  });
  orchestrator.registerAdapter(recordAdapter(calls));
  const missionPlan = plan(tasks, options.planOverrides);
  const loop = new ControlLoop({
    statePath,
    plan: missionPlan,
    agentId: 'agent-1',
    orchestrator,
    auditor: () => ({ status: 'passed', detail: 'independent integration audit passed' }),
  });
  return { loop, orchestrator, behaviorOS, statePath, plan: missionPlan, calls };
}

describe('ControlLoop integration through the orchestration entry point', () => {
  it('continues through dependencies and derives a terminal PASS from executed evidence', async () => {
    const h = harness([task('a'), task('b', { dependsOn: ['a'] })]);

    const state = await h.loop.run();

    expect(state.status).toBe('done');
    expect(state.outcome).toBe('PASS');
    expect(state.tasks.map((entry) => entry.status)).toEqual(['completed', 'completed']);
    expect(h.calls.map((entry) => entry.taskId)).toEqual(['a', 'b']);
    expect(new Set(h.calls.map((entry) => entry.idempotencyKey)).size).toBe(2);
    expect(h.behaviorOS.listMissions()).toHaveLength(1);
    expect(state.audit.status).toBe('passed');
    expect(state.nextAction.kind).toBe('done');
    expect(
      state.tasks.every((entry) => entry.evidence.every((item) => item.taskId === entry.id)),
    ).toBe(true);

    const persisted = JSON.parse(readFileSync(h.statePath, 'utf8')) as typeof state;
    expect(persisted.missionId).toBe(state.missionId);
    expect(persisted.phase).toBe('done');
    expect(persisted.terminationReason).toBe('ALL_AUTHORIZED_TASKS_COMPLETE_AND_AUDITED');
  });

  it('resumes against the same mission and does not re-execute completed tasks', async () => {
    const calls: RecordedCall[] = [];
    const h = harness([task('a'), task('b', { dependsOn: ['a'], adapter: 'late-adapter' })], {
      calls,
    });

    const first = await h.loop.run();
    expect(first.status).toBe('blocked');
    expect(first.tasks.find((entry) => entry.id === 'a')?.status).toBe('completed');
    expect(first.tasks.find((entry) => entry.id === 'b')?.status).toBe('blocked');
    expect(h.calls.map((entry) => entry.taskId)).toEqual(['a']);
    const missionId = first.missionId;
    expect(missionId).toBeTruthy();

    h.orchestrator.registerAdapter(recordAdapter(calls, 'late-adapter'));
    h.loop.retryBlocked(['b'], 'adapter registered');
    const resumed = await h.loop.run();

    expect(resumed.status).toBe('done');
    expect(resumed.outcome).toBe('PASS');
    expect(resumed.missionId).toBe(missionId);
    expect(h.calls.map((entry) => entry.taskId)).toEqual(['a', 'b']);
    expect(h.behaviorOS.listMissions()).toHaveLength(1);
    expect(resumed.tasks.find((entry) => entry.id === 'a')?.attempts).toBe(1);
    expect(resumed.tasks.find((entry) => entry.id === 'b')?.attempts).toBe(1);
    // The resumed task `a` was skipped on the second run, so its recorded
    // assignment must survive.
    expect(resumed.tasks.find((entry) => entry.id === 'a')?.assignedAgentId).toBe('agent-1');
  });

  it('enforces mission-level approval before dispatch and keeps the decision durable', async () => {
    const escalationDNA: DNA = {
      ...TEST_DNA,
      name: 'Control Loop Approval Integration DNA',
      governance: [
        {
          id: 'needs-approval',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'needs-approval', value: true }],
          description: 'Explicit approval required',
        },
      ],
    };
    const h = harness([task('approval')], {
      dna: escalationDNA,
      planOverrides: { governanceContext: { 'needs-approval': true } },
    });

    const first = await h.loop.run();
    const second = await h.loop.run();

    expect(first.status).toBe('blocked');
    expect(first.outcome).toBe('BLOCKED');
    expect(first.approval.status).toBe('pending');
    expect(first.approval.scope).toBe('mission');
    expect(first.nextAction.kind).toBe('await_approval');
    expect(second.nextAction.kind).toBe('await_approval');
    expect(h.calls).toEqual([]);
    expect(h.behaviorOS.listMissions()).toHaveLength(1);

    h.loop.recordApproval('denied', 'operator denied the change');
    const denied = await h.loop.run();

    expect(denied.status).toBe('blocked');
    expect(denied.approval.status).toBe('denied');
    expect(denied.terminationReason).toBe('APPROVAL_DENIED');
    expect(h.calls).toEqual([]);
  });
});
