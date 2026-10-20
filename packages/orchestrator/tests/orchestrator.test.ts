import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorOS, SqliteStore } from '@behavior-os/core';
import type { AdapterResult, DNA, Mission } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import {
  type AgentConfig,
  AutonomousOrchestrator,
  type MissionPlan,
  type OrchestratorOptions,
  type TaskDefinitionInput,
} from '../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dnasDir = join(repoRoot, 'dnas');

const TEST_DNA: DNA = {
  name: 'Orchestrator Test DNA',
  version: '1.0.0',
  description: 'Minimal DNA for orchestration tests',
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

function makeOrchestrator(
  options: {
    dna?: DNA;
    circuitBreaker?: OrchestratorOptions['circuitBreaker'];
    defaultTimeoutMs?: number;
    store?: SqliteStore;
  } = {},
): { orchestrator: AutonomousOrchestrator; behaviorOS: BehaviorOS; dna: DNA } {
  const dna = options.dna ?? TEST_DNA;
  const behaviorOS = new BehaviorOS(
    options.store ? { persistence: { store: options.store, autoHydrate: false } } : {},
  );
  const orchestrator = new AutonomousOrchestrator({
    behaviorOS,
    dna,
    dnasDir,
    circuitBreaker: options.circuitBreaker,
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
  const agent: AgentConfig = {
    id: 'agent-1',
    dnaPattern: dna.name,
    capabilities: ['execute'],
    authority: 'admin',
  };
  orchestrator.registerAgent(agent);
  return { orchestrator, behaviorOS, dna };
}

function nodeTask(overrides: Partial<TaskDefinitionInput> = {}): TaskDefinitionInput {
  return {
    id: 'run-node',
    objective: 'run a real node process',
    adapter: 'shell',
    input: {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok")'],
    },
    acceptance: [
      {
        gate: 'stdout-ok',
        description: 'stdout contains ok',
        type: 'stdout-contains',
        expected: 'ok',
      },
    ],
    ...overrides,
  };
}

function basePlan(tasks: TaskDefinitionInput[], overrides: Partial<MissionPlan> = {}): MissionPlan {
  return {
    title: 'Orchestrator mission',
    type: 'feature',
    priority: 'high',
    tasks,
    ...overrides,
  };
}

function waitForEvent(orchestrator: AutonomousOrchestrator, type: string): Promise<void> {
  return new Promise((resolve) => {
    const off = orchestrator.onEvent((event) => {
      if (event.type === type) {
        off();
        resolve();
      }
    });
  });
}

describe('AutonomousOrchestrator real execution', () => {
  it('runs a real process, records executed evidence and only then completes', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();

    const result = await orchestrator.executeMission(basePlan([nodeTask()]), 'agent-1');

    expect(result.outcome).toBe('completed');
    expect(result.status).toBe('completed');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].status).toBe('completed');
    expect(result.tasks[0].exitCode).toBe(0);
    expect(result.tasks[0].stdout).toBe('ok');

    const mission = behaviorOS.getMission(result.missionId);
    expect(mission?.status).toBe('completed');
    expect(mission?.verificationMode).toBe('executed');
    const evidence = mission?.evidence?.find((entry) => entry.gate === 'stdout-ok');
    expect(evidence).toMatchObject({
      status: 'passed',
      provenance: 'executed',
      tool: 'shell',
      exitCode: 0,
    });
    expect(evidence?.executionId).toBeTruthy();

    const types = result.events.map((event) => event.type);
    expect(types[0]).toBe('mission.created');
    expect(types.indexOf('task.created')).toBeLessThan(types.indexOf('task.dispatched'));
    expect(types.indexOf('task.dispatched')).toBeLessThan(types.indexOf('task.started'));
    expect(types.indexOf('task.started')).toBeLessThan(types.indexOf('task.completed'));
    expect(types.indexOf('task.completed')).toBeLessThan(types.indexOf('mission.completed'));
    expect(types.at(-1)).toBe('mission.completed');

    let previous = -1;
    for (const event of result.events) {
      expect(event.seq).toBeGreaterThan(previous);
      previous = event.seq;
      expect(event.missionId).toBe(result.missionId);
    }
  });

  it('does not complete when the process exits 0 but acceptance fails', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();
    const task = nodeTask({
      acceptance: [
        {
          gate: 'expects-never',
          description: 'stdout must contain text that is absent',
          type: 'stdout-contains',
          expected: 'never-present',
        },
      ],
    });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].exitCode).toBe(0);
    expect(result.tasks[0].error?.code).toBe('ACCEPTANCE_FAILED');
    expect(result.events.some((event) => event.type === 'mission.completed')).toBe(false);

    const mission = behaviorOS.getMission(result.missionId);
    expect(mission?.status).toBe('failed');
    const evidence = mission?.evidence?.find((entry) => entry.gate === 'expects-never');
    expect(evidence).toMatchObject({
      status: 'failed',
      provenance: 'executed',
    });
    expect(evidence?.executionId).toBeTruthy();
  });

  it('rejects malformed adapter output instead of treating it as success', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();
    orchestrator.registerAdapter({
      name: 'malformed',
      async execute() {
        return { exitCode: '0', stdout: 'ok', stderr: '' } as unknown as AdapterResult;
      },
    });
    const task = nodeTask({ adapter: 'malformed', input: {} });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].error?.code).toBe('INVALID_OUTPUT');
    expect(behaviorOS.getMission(result.missionId)?.status).toBe('failed');
  });

  it('times out a real process and records failed executed evidence', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();
    const task = nodeTask({
      input: {
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
      },
      timeoutMs: 150,
    });

    const startedAt = Date.now();
    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');
    const elapsed = Date.now() - startedAt;

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].error?.code).toBe('TIMEOUT');
    expect(elapsed).toBeLessThan(4000);
    const mission = behaviorOS.getMission(result.missionId);
    expect(mission?.status).toBe('failed');
    expect(mission?.evidence?.[0]).toMatchObject({
      gate: 'stdout-ok',
      status: 'failed',
      provenance: 'executed',
    });
  });

  it('cancels an in-flight task and the mission', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();
    const task = nodeTask({
      input: {
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
      },
    });
    const started = waitForEvent(orchestrator, 'task.started');
    const controller = new AbortController();
    const running = orchestrator.executeMission(basePlan([task]), 'agent-1', {
      signal: controller.signal,
    });

    await started;
    controller.abort();
    const result = await running;

    expect(result.outcome).toBe('cancelled');
    expect(result.tasks[0].status).toBe('cancelled');
    expect(result.tasks[0].error?.code).toBe('CANCELLED');
    expect(behaviorOS.getMission(result.missionId)?.status).toBe('cancelled');
  });

  it('retries a retryable failure and succeeds within the budget', async () => {
    const { orchestrator } = makeOrchestrator();
    let calls = 0;
    orchestrator.registerAdapter({
      name: 'flaky',
      async execute() {
        calls += 1;
        return calls < 3
          ? { exitCode: 1, stdout: '', stderr: 'temporary' }
          : { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const task = nodeTask({ adapter: 'flaky', input: {}, maxAttempts: 3 });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1', {
      loopThreshold: 5,
    });

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].attempts).toBe(3);
    expect(calls).toBe(3);
    expect(result.events.filter((event) => event.type === 'task.retried')).toHaveLength(2);
  });

  it('classifies retry-budget exhaustion explicitly', async () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.registerAdapter({
      name: 'always-fails',
      async execute() {
        return { exitCode: 1, stdout: '', stderr: 'still broken' };
      },
    });
    const task = nodeTask({ adapter: 'always-fails', input: {}, maxAttempts: 3 });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1', {
      loopThreshold: 10,
    });

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].attempts).toBe(3);
    expect(result.tasks[0].error?.code).toBe('RETRY_EXHAUSTED');
  });

  it('detects a repeated identical failure as a loop', async () => {
    const { orchestrator } = makeOrchestrator();
    orchestrator.registerAdapter({
      name: 'looping',
      async execute() {
        return { exitCode: 1, stdout: '', stderr: 'identical' };
      },
    });
    const task = nodeTask({ adapter: 'looping', input: {}, maxAttempts: 5 });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');

    expect(result.outcome).toBe('failed');
    expect(result.tasks[0].attempts).toBe(2);
    expect(result.tasks[0].error?.code).toBe('LOOP_DETECTED');
  });

  it('opens a per-adapter circuit and blocks subsequent dispatch', async () => {
    const { orchestrator } = makeOrchestrator({
      circuitBreaker: { failureThreshold: 1, cooldownMs: 60_000 },
    });
    orchestrator.registerAdapter({
      name: 'dead-adapter',
      async execute() {
        return { exitCode: 1, stdout: '', stderr: 'down' };
      },
    });
    const first = nodeTask({ adapter: 'dead-adapter', input: {}, maxAttempts: 1 });
    const firstResult = await orchestrator.executeMission(basePlan([first]), 'agent-1');
    expect(firstResult.outcome).toBe('failed');

    const second = nodeTask({ id: 'second', adapter: 'dead-adapter', input: {} });
    const secondResult = await orchestrator.executeMission(
      basePlan([second], { title: 'Second mission' }),
      'agent-1',
    );

    expect(secondResult.outcome).toBe('blocked');
    expect(secondResult.tasks[0].status).toBe('blocked');
    expect(secondResult.tasks[0].attempts).toBe(0);
    expect(secondResult.tasks[0].error?.code).toBe('CIRCUIT_OPEN');
    expect(
      orchestrator.getStatus().adapters.find((adapter) => adapter.name === 'dead-adapter')?.circuit,
    ).toBe('open');
  });
});

describe('AutonomousOrchestrator governance', () => {
  it('fails the mission when governance denies execution and dispatches nothing', async () => {
    const denyDNA: DNA = {
      ...TEST_DNA,
      name: 'Deny DNA',
      governance: [
        {
          id: 'deny-execution',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'denied', value: true }],
          description: 'Execution is denied for this test',
        },
      ],
    };
    const { orchestrator, behaviorOS } = makeOrchestrator({ dna: denyDNA });

    const result = await orchestrator.executeMission(
      basePlan([nodeTask()], { governanceContext: { denied: true } }),
      'agent-1',
    );

    expect(result.outcome).toBe('failed');
    expect(result.error?.code).toBe('GOVERNANCE_DENIED');
    expect(result.tasks).toEqual([]);
    expect(result.events.some((event) => event.type === 'task.dispatched')).toBe(false);
    expect(behaviorOS.getMission(result.missionId)?.status).toBe('failed');
  });

  it('pauses on escalation and resumes only on a later allowed run', async () => {
    const approvalDNA: DNA = {
      ...TEST_DNA,
      name: 'Approval DNA',
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
    const { orchestrator, behaviorOS } = makeOrchestrator({ dna: approvalDNA });
    const plan = basePlan([nodeTask()], { governanceContext: { 'needs-approval': true } });

    const blocked = await orchestrator.executeMission(plan, 'agent-1');
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.error?.code).toBe('APPROVAL_REQUIRED');
    expect(behaviorOS.getMission(blocked.missionId)?.status).toBe('paused');
    expect(blocked.tasks).toEqual([]);

    const resumed = await orchestrator.executeMission(
      basePlan([nodeTask()], { governanceContext: {} }),
      'agent-1',
      { resumeMissionId: blocked.missionId },
    );
    expect(resumed.outcome).toBe('completed');
    expect(behaviorOS.getMission(blocked.missionId)?.status).toBe('completed');
  });
});

describe('AutonomousOrchestrator idempotency and resumption', () => {
  it('replays an idempotency key without a second mission or dispatch', async () => {
    const { orchestrator, behaviorOS } = makeOrchestrator();
    let calls = 0;
    orchestrator.registerAdapter({
      name: 'counted',
      async execute() {
        calls += 1;
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const plan = basePlan([nodeTask({ adapter: 'counted', input: {} })], {
      idempotencyKey: 'one-shot',
    });

    const first = await orchestrator.executeMission(plan, 'agent-1');
    const second = await orchestrator.executeMission(plan, 'agent-1');

    expect(second.missionId).toBe(first.missionId);
    expect(second.outcome).toBe('completed');
    expect(calls).toBe(1);
    expect(behaviorOS.listMissions()).toHaveLength(1);
  });

  it('skips tasks whose gates already have executed evidence on resume', async () => {
    const behaviorOS = new BehaviorOS();
    await behaviorOS.loadDNA(TEST_DNA);
    const mission: Mission = behaviorOS.createMission({
      title: 'Interrupted mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: TEST_DNA.name,
      createdBy: 'agent-1',
      requiredChecks: ['gate-a', 'gate-b'],
      verificationMode: 'executed',
    });
    expect(behaviorOS.transitionMission(mission.id, 'active').ok).toBe(true);
    const prior = behaviorOS.addMissionEvidence(mission.id, [
      {
        gate: 'gate-a',
        status: 'passed',
        source: 'prior run',
        provenance: 'executed',
        executionId: 'exec-a',
      },
    ]);
    expect(prior.ok).toBe(true);

    const orchestrator = new AutonomousOrchestrator({
      behaviorOS,
      dna: TEST_DNA,
      dnasDir,
    });
    orchestrator.registerAgent({
      id: 'agent-1',
      dnaPattern: TEST_DNA.name,
      capabilities: ['execute'],
      authority: 'admin',
    });

    const plan = basePlan([
      nodeTask({
        id: 'a',
        adapter: 'never-registered',
        input: {},
        acceptance: [
          {
            gate: 'gate-a',
            description: 'already proven',
            type: 'exit-code',
            expected: '0',
          },
        ],
      }),
      nodeTask({
        id: 'b',
        acceptance: [
          {
            gate: 'gate-b',
            description: 'stdout contains ok',
            type: 'stdout-contains',
            expected: 'ok',
          },
        ],
      }),
    ]);

    const result = await orchestrator.executeMission(plan, 'agent-1', {
      resumeMissionId: mission.id,
    });

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].attempts).toBe(0);
    expect(result.tasks[0].evidence[0].gate).toBe('gate-a');
    expect(result.tasks[1].status).toBe('completed');
    expect(
      result.events.some(
        (event) =>
          event.type === 'task.completed' && event.taskId === 'a' && event.data.skipped === true,
      ),
    ).toBe(true);
  });

  it('loads a shipped DNA pattern from dnas/ and executes against it', async () => {
    const behaviorOS = new BehaviorOS();
    const orchestrator = new AutonomousOrchestrator({ behaviorOS, dnasDir });
    orchestrator.registerAgent({
      id: 'agent-1',
      dnaPattern: 'open-source',
      capabilities: ['execute'],
      authority: 'admin',
    });

    const result = await orchestrator.executeMission(basePlan([nodeTask()]), 'agent-1');

    expect(result.outcome).toBe('completed');
    expect(behaviorOS.getDNA()?.name).toBe('Open Source');
  });
});

describe('AutonomousOrchestrator observability and persistence', () => {
  it('keeps secrets out of lifecycle events while retaining them in the task result', async () => {
    const { orchestrator } = makeOrchestrator();
    const task = nodeTask({
      input: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write("SUPER_SECRET_TOKEN")'],
      },
      acceptance: [
        {
          gate: 'secret-output',
          description: 'stdout contains the marker',
          type: 'stdout-contains',
          expected: 'SUPER_SECRET_TOKEN',
        },
      ],
    });

    const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');

    expect(result.outcome).toBe('completed');
    expect(result.tasks[0].stdout).toContain('SUPER_SECRET_TOKEN');
    expect(JSON.stringify(result.events)).not.toContain('SUPER_SECRET_TOKEN');
  });

  it('isolates event buffers when two missions run concurrently', async () => {
    const { orchestrator } = makeOrchestrator();
    const slow = (id: string): TaskDefinitionInput =>
      nodeTask({
        id,
        input: {
          command: process.execPath,
          args: ['-e', 'setTimeout(() => process.stdout.write("ok"), 100)'],
        },
        acceptance: [
          {
            gate: `gate-${id}`,
            description: 'stdout contains ok',
            type: 'stdout-contains',
            expected: 'ok',
          },
        ],
      });

    const [first, second] = await Promise.all([
      orchestrator.executeMission(basePlan([slow('a')], { title: 'Mission A' }), 'agent-1'),
      orchestrator.executeMission(basePlan([slow('b')], { title: 'Mission B' }), 'agent-1'),
    ]);

    expect(first.missionId).not.toBe(second.missionId);
    for (const result of [first, second]) {
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.every((event) => event.missionId === result.missionId)).toBe(true);
    }
  });

  it('reports a persistence failure instead of completing the mission', async () => {
    class FailingStore extends SqliteStore {
      failSaves = false;

      override saveMission(mission: Mission): void {
        if (this.failSaves) throw new Error('disk full');
        super.saveMission(mission);
      }
    }

    const store = new FailingStore({ path: ':memory:' });
    const { orchestrator, behaviorOS } = makeOrchestrator({ store });
    orchestrator.registerAdapter({
      name: 'persist-fail',
      async execute() {
        store.failSaves = true;
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });
    const task = nodeTask({ adapter: 'persist-fail', input: {} });

    try {
      const result = await orchestrator.executeMission(basePlan([task]), 'agent-1');
      expect(result.outcome).toBe('failed');
      expect(result.error?.code).toBe('PERSISTENCE_FAILED');
      expect(result.events.some((event) => event.type === 'mission.completed')).toBe(false);
      const mission = behaviorOS.getMission(result.missionId);
      expect(mission?.status).not.toBe('completed');
      expect(mission?.evidence).toEqual([]);
    } finally {
      store.failSaves = false;
      store.close();
    }
  });
});
