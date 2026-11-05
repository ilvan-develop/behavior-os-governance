/**
 * Delegation integration tests: `AutonomousOrchestrator` and `ControlLoop` use
 * a real `DelegationEngine` for every dispatched task. These tests exercise the
 * production dispatch path (mission creation, governance, adapter execution,
 * evidence) rather than calling the engine in isolation.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorOS, CognitiveLoadBalancerEngine } from '@behavior-os/core';
import type { AdapterResult, DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AdapterExecutionContext,
  type AgentConfig,
  AutonomousOrchestrator,
  ControlLoop,
  type ControlLoopPlan,
  type ControlTaskDefinition,
  DelegationEngine,
  type MissionPlan,
  type TaskAdapter,
  type TaskDefinitionInput,
} from '../src/index.js';

const TEST_DNA: DNA = {
  name: 'Delegation Integration DNA',
  version: '1.0.0',
  description: 'Minimal DNA for delegation integration tests',
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
  const directory = mkdtempSync(join(tmpdir(), 'bos-delegation-integration-'));
  temporaryDirectories.push(directory);
  return join(directory, 'control-state.json');
}

const AGENTS: AgentConfig[] = [
  {
    id: 'explorer-1',
    dnaPattern: TEST_DNA.name,
    capabilities: ['investigate'],
    authority: 'readonly',
    role: 'explorer',
  },
  {
    id: 'fixer-1',
    dnaPattern: TEST_DNA.name,
    capabilities: ['implement'],
    authority: 'write',
    role: 'fixer',
  },
  {
    id: 'fixer-2',
    dnaPattern: TEST_DNA.name,
    capabilities: ['implement'],
    authority: 'write',
    role: 'fixer',
  },
  {
    id: 'auditor-1',
    dnaPattern: TEST_DNA.name,
    capabilities: ['verify'],
    authority: 'readonly',
    role: 'auditor',
  },
];

interface RecordedCall {
  taskId: string;
  missionId: string;
  agentId: string;
}

function recordingAdapter(
  calls: RecordedCall[],
  result: AdapterResult = { exitCode: 0, stdout: 'ok', stderr: '' },
): TaskAdapter {
  return {
    name: 'record',
    async execute(_input, context: AdapterExecutionContext) {
      calls.push({
        taskId: context.taskId,
        missionId: context.missionId,
        agentId: context.agentId,
      });
      return result;
    },
  };
}

interface Harness {
  orchestrator: AutonomousOrchestrator;
  behaviorOS: BehaviorOS;
  delegation: DelegationEngine;
  calls: RecordedCall[];
}

function harness(
  options: {
    agents?: AgentConfig[];
    dna?: DNA;
    result?: AdapterResult;
    adapter?: TaskAdapter;
    defaultTimeoutMs?: number;
    policy?: Partial<import('../src/delegation.js').DelegationPolicy>;
  } = {},
): Harness {
  const dna = options.dna ?? TEST_DNA;
  const behaviorOS = new BehaviorOS();
  const delegation = new DelegationEngine(new CognitiveLoadBalancerEngine(), {
    ...(options.policy ? { policy: options.policy } : {}),
  });
  const orchestrator = new AutonomousOrchestrator({
    behaviorOS,
    dna,
    delegation,
    ...(options.defaultTimeoutMs !== undefined
      ? { defaultTimeoutMs: options.defaultTimeoutMs }
      : {}),
  });
  for (const agent of options.agents ?? AGENTS) orchestrator.registerAgent(agent);
  const calls: RecordedCall[] = [];
  orchestrator.registerAdapter(options.adapter ?? recordingAdapter(calls, options.result));
  return { orchestrator, behaviorOS, delegation, calls };
}

function missionPlan(
  tasks: TaskDefinitionInput[],
  overrides: Partial<MissionPlan> = {},
): MissionPlan {
  return {
    title: 'Delegation integration mission',
    type: 'feature',
    priority: 'high',
    tasks,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<TaskDefinitionInput> = {}): TaskDefinitionInput {
  return {
    id,
    objective: `run ${id}`,
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
    mutating: true,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Adapter whose executions stay pending until the test releases them. Used to
 * observe real concurrent in-flight agents and load release.
 */
function gateAdapter() {
  const pending: Array<() => void> = [];
  let started = 0;
  const adapter: TaskAdapter = {
    name: 'record',
    async execute() {
      started += 1;
      await new Promise<void>((resolve) => pending.push(resolve));
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  };
  return {
    adapter,
    started: () => started,
    releaseAll: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

/** Adapter that only settles when the orchestrator aborts the attempt. */
function abortAwareAdapter(): TaskAdapter {
  return {
    name: 'record',
    async execute(_input, context) {
      return await new Promise<AdapterResult>((resolve) => {
        if (context.signal.aborted) {
          resolve({ exitCode: null, stdout: '', stderr: 'aborted' });
          return;
        }
        context.signal.addEventListener(
          'abort',
          () => resolve({ exitCode: null, stdout: '', stderr: 'aborted' }),
          { once: true },
        );
      });
    },
  };
}

describe('AutonomousOrchestrator delegation integration', () => {
  it('delegates a mutating task to an eligible fixer and propagates the result', async () => {
    const h = harness();

    const result = await h.orchestrator.executeMission(
      missionPlan([task('impl', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('completed');
    expect(result.tasks).toHaveLength(1);
    const settled = result.tasks[0];
    expect(['fixer-1', 'fixer-2']).toContain(settled.agentId);
    expect(settled.missionId).toBe(result.missionId);
    expect(settled.evidence.every((entry) => entry.taskId === 'impl')).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].agentId).toBe(settled.agentId);
    expect(h.calls[0].missionId).toBe(result.missionId);
  });

  it('selects the least-loaded eligible agent', async () => {
    const h = harness();
    h.delegation.onTaskStarted('fixer-1', 'preload');

    const result = await h.orchestrator.executeMission(
      missionPlan([task('impl', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].agentId).toBe('fixer-2');
  });

  it('never delegates a mutating task to an auditor', async () => {
    const h = harness({
      agents: [
        {
          id: 'auditor-1',
          dnaPattern: TEST_DNA.name,
          capabilities: ['verify'],
          authority: 'readonly',
          role: 'auditor',
        },
      ],
    });

    const result = await h.orchestrator.executeMission(
      missionPlan([task('mutate', { requiredSkills: ['verify'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('blocked');
    expect(result.tasks[0].status).toBe('blocked');
    expect(result.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(h.calls).toEqual([]);
  });

  it('refuses a task when no agent is eligible', async () => {
    const h = harness({
      agents: [
        {
          id: 'explorer-1',
          dnaPattern: TEST_DNA.name,
          capabilities: ['investigate'],
          authority: 'readonly',
          role: 'explorer',
        },
      ],
    });

    const result = await h.orchestrator.executeMission(
      missionPlan([task('write', { requiredSkills: ['investigate'] })]),
      'explorer-1',
    );

    expect(result.outcome).toBe('blocked');
    expect(result.tasks[0].status).toBe('blocked');
    expect(result.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(h.calls).toEqual([]);
  });

  it('enforces the two-agent concurrency budget across concurrent missions', async () => {
    const gate = gateAdapter();
    const h = harness({ adapter: gate.adapter });

    const first = h.orchestrator.executeMission(
      missionPlan([task('first', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    const second = h.orchestrator.executeMission(
      missionPlan([task('second', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    await waitFor(() => gate.started() === 2);

    // Two distinct agents are in flight, so the engine must refuse the third.
    const third = await h.orchestrator.executeMission(
      missionPlan([task('third', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    expect(third.outcome).toBe('blocked');
    expect(third.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(third.tasks[0].error?.message).toContain('Concurrency budget');

    gate.releaseAll();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.outcome).toBe('completed');
    expect(secondResult.outcome).toBe('completed');
    expect(gate.started()).toBe(2);
  });

  it('shares the concurrency budget across orchestrators that use the same engine', async () => {
    const gate = gateAdapter();
    const behaviorOS = new BehaviorOS();
    const sharedEngine = new DelegationEngine(new CognitiveLoadBalancerEngine(), {
      policy: { maxConcurrent: 1 },
    });
    const orchestratorA = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      delegation: sharedEngine,
    });
    const orchestratorB = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      delegation: sharedEngine,
    });
    for (const orchestrator of [orchestratorA, orchestratorB]) {
      for (const agent of AGENTS) orchestrator.registerAgent(agent);
      orchestrator.registerAdapter(gate.adapter);
    }

    const first = orchestratorA.executeMission(
      missionPlan([task('a', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    await waitFor(() => gate.started() === 1);

    // A second orchestrator must not get its own private budget: the shared
    // ledger already holds one distinct agent, so B is refused.
    const second = await orchestratorB.executeMission(
      missionPlan([task('b', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    expect(second.outcome).toBe('blocked');
    expect(second.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(second.tasks[0].error?.message).toContain('Concurrency budget');
    expect(sharedEngine.activeAgentCount()).toBe(1);

    gate.releaseAll();
    const firstResult = await first;
    expect(firstResult.outcome).toBe('completed');
    expect(sharedEngine.activeAgentCount()).toBe(0);
  });

  it('blocks a third concurrent loop when two distinct agents are already in flight', async () => {
    const gate = gateAdapter();
    const behaviorOS = new BehaviorOS();
    const sharedEngine = new DelegationEngine(new CognitiveLoadBalancerEngine());
    const orchestratorA = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      delegation: sharedEngine,
    });
    const orchestratorB = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      delegation: sharedEngine,
    });
    const orchestratorC = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      delegation: sharedEngine,
    });
    for (const orchestrator of [orchestratorA, orchestratorB, orchestratorC]) {
      for (const agent of AGENTS) orchestrator.registerAgent(agent);
      orchestrator.registerAdapter(gate.adapter);
    }

    const first = orchestratorA.executeMission(
      missionPlan([task('a', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    const second = orchestratorB.executeMission(
      missionPlan([task('b', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    await waitFor(() => gate.started() === 2);

    const third = await orchestratorC.executeMission(
      missionPlan([task('c', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    expect(third.outcome).toBe('blocked');
    expect(third.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(third.tasks[0].error?.message).toContain('Concurrency budget');
    expect(sharedEngine.activeAgentCount()).toBe(2);

    gate.releaseAll();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.outcome).toBe('completed');
    expect(secondResult.outcome).toBe('completed');
    expect(sharedEngine.activeAgentCount()).toBe(0);
  });

  it('releases load after success', async () => {
    const gate = gateAdapter();
    const h = harness({ adapter: gate.adapter });
    const run = h.orchestrator.executeMission(
      missionPlan([task('success', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );
    await waitFor(() => gate.started() === 1);

    const loadsInFlight = [
      h.delegation.getAgentLoad('fixer-1'),
      h.delegation.getAgentLoad('fixer-2'),
    ];
    expect(Math.max(...loadsInFlight)).toBeCloseTo(0.1);

    gate.releaseAll();
    const result = await run;

    expect(result.outcome).toBe('completed');
    expect(h.delegation.getAgentLoad('fixer-1')).toBe(0);
    expect(h.delegation.getAgentLoad('fixer-2')).toBe(0);
  });

  it('releases load after failure', async () => {
    const h = harness({ result: { exitCode: 1, stdout: '', stderr: 'boom' } });

    const result = await h.orchestrator.executeMission(
      missionPlan([task('failure', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('failed');
    expect(h.delegation.getAgentLoad('fixer-1')).toBe(0);
    expect(h.delegation.getAgentLoad('fixer-2')).toBe(0);
  });

  it('releases load after timeout', async () => {
    const h = harness({
      adapter: abortAwareAdapter(),
      defaultTimeoutMs: 40,
    });

    const result = await h.orchestrator.executeMission(
      missionPlan([task('timeout', { requiredSkills: ['implement'], timeoutMs: 30 })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].error?.code).toBe('TIMEOUT');
    expect(h.delegation.getAgentLoad('fixer-1')).toBe(0);
    expect(h.delegation.getAgentLoad('fixer-2')).toBe(0);
  });

  it('releases load after cancellation', async () => {
    const h = harness({ adapter: abortAwareAdapter() });
    const controller = new AbortController();
    const run = h.orchestrator.executeMission(
      missionPlan([task('cancel', { requiredSkills: ['implement'], timeoutMs: 5000 })]),
      'auditor-1',
      { signal: controller.signal },
    );
    await waitFor(() => controller.signal.aborted === false && h.calls.length === 0);
    // Wait until at least one agent has actually started (load becomes 0.1).
    await waitFor(
      () => h.delegation.getAgentLoad('fixer-1') > 0 || h.delegation.getAgentLoad('fixer-2') > 0,
    );
    controller.abort();
    const result = await run;

    expect(result.outcome).toBe('cancelled');
    expect(result.tasks[0].status).toBe('cancelled');
    expect(h.delegation.getAgentLoad('fixer-1')).toBe(0);
    expect(h.delegation.getAgentLoad('fixer-2')).toBe(0);
  });

  it('applies governance before a mutating task is dispatched', async () => {
    const blockingDNA: DNA = {
      ...TEST_DNA,
      name: 'Delegation Governance DNA',
      governance: [
        {
          id: 'block-mutations',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'mutating', value: true }],
          description: 'Mutating tasks require a separate approved path',
        },
      ],
    };
    const h = harness({ dna: blockingDNA });

    const result = await h.orchestrator.executeMission(
      missionPlan([task('governed', { requiredSkills: ['implement'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('blocked');
    expect(result.tasks[0].status).toBe('blocked');
    expect(result.tasks[0].error?.code).toBe('GOVERNANCE_DENIED');
    expect(h.calls).toEqual([]);
  });

  it('does not let a caller-declared read-only flag bypass an unknown-mutability adapter', async () => {
    const blockingDNA: DNA = {
      ...TEST_DNA,
      name: 'Delegation Governance DNA',
      governance: [
        {
          id: 'block-mutations',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'mutating', value: true }],
          description: 'Mutating tasks require a separate approved path',
        },
      ],
    };
    const h = harness({ dna: blockingDNA });
    // The recording adapter has no `mutating` metadata, so it must be treated
    // as mutating even when the task declares itself read-only.
    const result = await h.orchestrator.executeMission(
      missionPlan([task('sneaky', { mutating: false, requiredSkills: ['implement'] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('blocked');
    expect(result.tasks[0].status).toBe('blocked');
    expect(result.tasks[0].error?.code).toBe('GOVERNANCE_DENIED');
    expect(h.calls).toEqual([]);
  });

  it('allows a genuinely read-only adapter and task pair to skip task-scoped governance', async () => {
    const blockingDNA: DNA = {
      ...TEST_DNA,
      name: 'Delegation Governance DNA',
      governance: [
        {
          id: 'block-mutations',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'mutating', value: true }],
          description: 'Mutating tasks require a separate approved path',
        },
      ],
    };
    const calls: RecordedCall[] = [];
    const readOnlyAdapter: TaskAdapter = {
      name: 'readonly',
      mutating: false,
      async execute(_input, context: AdapterExecutionContext) {
        calls.push({
          taskId: context.taskId,
          missionId: context.missionId,
          agentId: context.agentId,
        });
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    };
    const h = harness({ dna: blockingDNA, adapter: readOnlyAdapter });

    const result = await h.orchestrator.executeMission(
      missionPlan([
        task('read-only', { mutating: false, adapter: 'readonly', requiredSkills: ['verify'] }),
      ]),
      'auditor-1',
    );

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].status).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(calls[0].agentId).toBe('auditor-1');
  });

  it('assigns a mutating task with no requiredSkills to an eligible write agent', async () => {
    const h = harness();
    const result = await h.orchestrator.executeMission(
      missionPlan([task('no-skills', { requiredSkills: [] })]),
      'auditor-1',
    );

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].agentId).toMatch(/^fixer-/);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].agentId).toBe(result.tasks[0].agentId);
  });

  it('rejects malformed requiredSkills with a governed validation error', async () => {
    const h = harness();
    await expect(
      h.orchestrator.executeMission(
        missionPlan([
          {
            id: 'bad',
            objective: 'bad',
            adapter: 'record',
            input: {},
            acceptance: [
              { gate: 'gate-bad', description: 'bad', type: 'exit-code', expected: '0' },
            ],
            requiredSkills: [123 as unknown as string],
            mutating: true,
          },
        ]),
        'auditor-1',
      ),
    ).rejects.toThrow(/requiredSkills must be an array of skill names/);
  });
});

describe('ControlLoop delegation integration', () => {
  function controlTask(
    id: string,
    overrides: Partial<ControlTaskDefinition> = {},
  ): ControlTaskDefinition {
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
          required: true,
        },
      ],
      requiredSkills: ['implement'],
      mutating: true,
      ...overrides,
    };
  }

  it('delegates through the control loop and records the assigned agent', async () => {
    const h = harness();
    const plan: ControlLoopPlan = {
      title: 'Control loop delegation mission',
      type: 'feature',
      priority: 'high',
      tasks: [controlTask('impl')],
    };
    const loop = new ControlLoop({
      statePath: temporaryStatePath(),
      plan,
      agentId: 'auditor-1',
      orchestrator: h.orchestrator,
      auditor: () => ({ status: 'passed', detail: 'independent audit passed' }),
    });

    const state = await loop.run();

    expect(state.status).toBe('done');
    expect(state.outcome).toBe('PASS');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].agentId).toMatch(/^fixer-/);
    expect(state.tasks[0].agentId).toBe('auditor-1');
    expect(state.tasks[0].assignedAgentId).toBe(h.calls[0].agentId);
    expect(state.tasks[0].evidence.every((entry) => entry.taskId === 'impl')).toBe(true);
  });

  it('does not overwrite a recorded assignment when a resumed task is skipped', async () => {
    const h = harness();
    const plan: ControlLoopPlan = {
      title: 'Control loop resume mission',
      type: 'feature',
      priority: 'high',
      tasks: [controlTask('impl')],
    };
    const loop = new ControlLoop({
      statePath: temporaryStatePath(),
      plan,
      agentId: 'auditor-1',
      orchestrator: h.orchestrator,
      auditor: () => ({ status: 'passed', detail: 'independent audit passed' }),
    });

    const first = await loop.run();
    const assigned = first.tasks[0].assignedAgentId;
    expect(assigned).toMatch(/^fixer-/);
    const second = await loop.run();

    expect(second.tasks[0].assignedAgentId).toBe(assigned);
    expect(second.tasks[0].attempts).toBe(1);
  });
});
