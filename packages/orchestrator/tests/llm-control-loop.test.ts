/**
 * E2E: the governed LLM adapter inside the durable ControlLoop.
 *
 * Proves the mission's autonomous-lifecycle scenarios using deterministic
 * providers (ADR-002) — no external LLM calls:
 *
 *  - Scenario J (full autonomous lifecycle): a ControlLoop with an `llm`
 *    task completes to terminal `PASS` with an independent auditor, records
 *    executed evidence, and persists provider telemetry.
 *  - Scenario B (provider failure → fallback): the pinned primary fails with a
 *    retryable classified error; the router's single bounded fallback hop uses
 *    the healthy provider, recorded in telemetry.
 *  - Scenario G (validation failure): an `llm` task whose output fails the
 *    acceptance criteria cannot complete the mission; the loop reports
 *    `FAIL` / `UNVERIFIED` and records failed executed evidence.
 *  - Scenario D (process restart → resume): a completed `llm` task is skipped
 *    on resume from persisted state (evidence seeding), not re-executed.
 *  - Scenario I (evidence integrity): invalid structured output becomes a
 *    SCHEMA_MISMATCH task failure; a missing independent auditor yields
 *    UNVERIFIED. Neither can produce a fake PASS.
 *
 * The `llm` adapter plugs into the *existing* `TaskAdapter` seam (ADR-005), so
 * all of the ControlLoop's durable semantics (plan signature, orphan-mission
 * adoption, phase re-authorization, independent auditor for terminal `done`)
 * apply unchanged.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ControlLoop,
  type ControlLoopPlan,
  type ControlTaskDefinition,
} from '../src/control-loop.js';
import { LlmTaskAdapter } from '../src/llm/adapter.js';
import { DeterministicLlmProvider } from '../src/llm/provider.js';
import { LlmProviderRegistry } from '../src/llm/registry.js';
import { AutonomousOrchestrator } from '../src/orchestrator.js';

const TEST_DNA: DNA = {
  name: 'LLM Control Loop DNA',
  version: '1.0.0',
  description: 'Minimal DNA for LLM control-loop E2E tests',
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
  const directory = mkdtempSync(join(tmpdir(), 'bos-llm-control-loop-'));
  temporaryDirectories.push(directory);
  return join(directory, 'llm-control-state.json');
}

function llmTask(
  id: string,
  overrides: Partial<ControlTaskDefinition> = {},
): ControlTaskDefinition {
  return {
    id,
    objective: `llm ${id}`,
    adapter: 'llm',
    agentId: 'agent-1',
    input: { prompt: `reason about ${id}` },
    acceptance: [
      {
        gate: `llm-gate-${id}`,
        description: `llm acceptance for ${id}`,
        type: 'exit-code',
        expected: '0',
      },
    ],
    ...overrides,
  };
}

interface Harness {
  loop: ControlLoop;
  orchestrator: AutonomousOrchestrator;
  behaviorOS: BehaviorOS;
  statePath: string;
  registry: LlmProviderRegistry;
  provider: DeterministicLlmProvider;
}

function harness(
  tasks: ControlTaskDefinition[],
  options: {
    planOverrides?: Partial<ControlLoopPlan>;
    providers?: DeterministicLlmProvider[];
    unavailableProviderNames?: string[];
  } = {},
): Harness {
  const behaviorOS = new BehaviorOS();
  const registry = new LlmProviderRegistry();
  const providers = options.providers ?? [new DeterministicLlmProvider({ name: 'det' })];
  for (const provider of providers) {
    registry.register(provider);
  }
  const adapter = new LlmTaskAdapter({ registry, providers });
  const orchestrator = new AutonomousOrchestrator({ behaviorOS, dna: TEST_DNA });
  orchestrator.registerAgent({
    id: 'agent-1',
    dnaPattern: TEST_DNA.name,
    capabilities: ['execute'],
    authority: 'admin',
  });
  orchestrator.registerAdapter(adapter);
  const plan: ControlLoopPlan = {
    title: 'LLM control loop E2E',
    type: 'feature',
    priority: 'high',
    tasks,
    ...options.planOverrides,
  };
  const statePath = temporaryStatePath();
  const loop = new ControlLoop({
    statePath,
    plan,
    agentId: 'agent-1',
    orchestrator,
    auditor: () => ({ status: 'passed', detail: 'independent LLM-loop audit passed' }),
  });
  return {
    loop,
    orchestrator,
    behaviorOS,
    statePath,
    registry,
    provider: providers[0] as DeterministicLlmProvider,
  };
}

describe('ControlLoop + LLM adapter (autonomous lifecycle, deterministic providers)', () => {
  it('scenario J: completes a full autonomous lifecycle to terminal PASS', async () => {
    const h = harness([llmTask('one'), llmTask('two', { dependsOn: ['one'] })]);

    const state = await h.loop.run();

    expect(state.status).toBe('done');
    expect(state.outcome).toBe('PASS');
    expect(state.tasks.map((entry) => entry.status)).toEqual(['completed', 'completed']);
    expect(state.audit.status).toBe('passed');
    expect(state.nextAction.kind).toBe('done');
    // Executed evidence was recorded for the llm gates.
    for (const task of state.tasks) {
      expect(task.evidence.some((entry) => entry.provenance === 'executed')).toBe(true);
    }
    // Telemetry was recorded by the router/adapter.
    expect(h.registry.telemetrySnapshot().length).toBeGreaterThanOrEqual(2);
    // The mission completed with executed verification mode.
    const mission = state.missionId ? h.orchestrator.getMission(state.missionId) : null;
    expect(mission?.status).toBe('completed');
    expect(mission?.verificationMode).toBe('executed');
  });

  it('scenario B: falls back when the pinned primary fails with a retryable error', async () => {
    // The primary is available and cheapest (so it must be the first attempt),
    // but every call fails with a retryable classified error. The only way the
    // task can pass is the router's single bounded fallback hop to `fallback`.
    const primary = new DeterministicLlmProvider({
      name: 'primary',
      capabilities: {
        chat: true,
        structuredOutput: true,
        json: true,
        contextWindow: 32_000,
        costPerMInputUsd: 0,
        costPerMOutputUsd: 0,
        baselineLatencyMs: 1,
      },
      respond: (request) => ({
        code: 'TIMEOUT',
        provider: 'primary',
        message: 'simulated timeout',
        retryable: true,
        fingerprint: `TIMEOUT|primary|${request.requestId}`,
      }),
    });
    const fallback = new DeterministicLlmProvider({
      name: 'fallback',
      capabilities: {
        chat: true,
        structuredOutput: true,
        json: true,
        contextWindow: 32_000,
        costPerMInputUsd: 0,
        costPerMOutputUsd: 0,
        baselineLatencyMs: 2,
      },
    });
    const h = harness([llmTask('b', { input: { prompt: 'b', provider: 'primary' } })], {
      providers: [primary, fallback],
    });

    const state = await h.loop.run();

    expect(state.status).toBe('done');
    expect(state.outcome).toBe('PASS');
    const telemetry = h.registry.telemetrySnapshot();
    // The primary was actually attempted and failed...
    expect(telemetry.some((entry) => entry.provider === 'primary' && entry.ok === false)).toBe(
      true,
    );
    // ...and the success is attributed to the fallback provider, with the
    // routing reason recording the fallback hop.
    const successful = telemetry.filter((entry) => entry.ok);
    expect(successful.some((entry) => entry.provider === 'fallback')).toBe(true);
    expect(successful.some((entry) => entry.routingReason === 'fallback:primary (TIMEOUT)')).toBe(
      true,
    );
  });

  it('scenario G: an llm task that fails acceptance cannot complete the mission', async () => {
    // The LLM call itself succeeds (exit 0), but the task's declared
    // acceptance (stdout-contains "OK-MARKER") is not met. The loop must not
    // declare done: it records failed executed evidence and reports FAIL.
    const task = llmTask('g', {
      input: { prompt: 'produce ok' },
      acceptance: [
        {
          gate: 'llm-gate-g',
          description: 'stdout must contain ok',
          type: 'stdout-contains',
          expected: 'OK-MARKER',
        },
      ],
    });
    const h = harness([task]);

    const state = await h.loop.run();

    expect(state.status).toBe('failed');
    expect(state.outcome).toBe('FAIL');
    expect(state.tasks[0].status).toBe('failed');
    expect(state.nextAction.kind).toBe('failed');
    // Failed executed evidence was recorded (the task ran, acceptance failed).
    expect(state.tasks[0].evidence.some((entry) => entry.status === 'failed')).toBe(true);
  });

  it('scenario D: resumes from persisted state and skips an already-completed llm task', async () => {
    const provider = new DeterministicLlmProvider({ name: 'det' });
    const registry = new LlmProviderRegistry();
    registry.register(provider);
    const adapter = new LlmTaskAdapter({ registry, providers: [provider] });
    const behaviorOS = new BehaviorOS();
    const orchestrator = new AutonomousOrchestrator({ behaviorOS, dna: TEST_DNA });
    orchestrator.registerAgent({
      id: 'agent-1',
      dnaPattern: TEST_DNA.name,
      capabilities: ['execute'],
      authority: 'admin',
    });
    orchestrator.registerAdapter(adapter);

    const plan: ControlLoopPlan = {
      title: 'LLM resume',
      type: 'feature',
      priority: 'high',
      tasks: [llmTask('a'), llmTask('b', { dependsOn: ['a'] })],
    };
    const statePath = temporaryStatePath();

    // First loop instance: complete the full run (both tasks execute once).
    const firstLoop = new ControlLoop({
      statePath,
      plan,
      agentId: 'agent-1',
      orchestrator,
      auditor: () => ({ status: 'passed', detail: 'audit' }),
    });
    const first = await firstLoop.run();
    expect(first.status).toBe('done');
    const llmCallsAfterFirst = registry.telemetrySnapshot().filter((entry) => entry.ok).length;
    expect(llmCallsAfterFirst).toBeGreaterThan(0);

    // Simulate the process restart: a fresh loop instance shares the same
    // behaviorOS (mission + evidence hydrate) and the same persisted state
    // file. The resume must re-derive done from existing executed evidence and
    // make zero new LLM dispatches (both tasks already proven).
    const secondLoop = new ControlLoop({
      statePath,
      plan,
      agentId: 'agent-1',
      orchestrator,
      auditor: () => ({ status: 'passed', detail: 'audit' }),
    });
    const second = await secondLoop.run();
    expect(second.status).toBe('done');
    expect(second.outcome).toBe('PASS');
    const llmCallsAfterSecond = registry.telemetrySnapshot().filter((entry) => entry.ok).length;
    // No new llm dispatch happened on the resume (tasks skipped via evidence).
    expect(llmCallsAfterSecond).toBe(llmCallsAfterFirst);
    // 'a' shows attempts recorded from the first run, not re-executed.
    expect(second.tasks.find((entry) => entry.id === 'a')?.attempts).toBeGreaterThan(0);
  });

  it('scenario I (audit): missing independent auditor keeps the run UNVERIFIED', async () => {
    // No independent auditor supplied: even with a passing llm task the loop
    // must stop as UNVERIFIED (terminal `done` requires an independent audit).
    const provider = new DeterministicLlmProvider({ name: 'det' });
    const registry = new LlmProviderRegistry();
    registry.register(provider);
    const adapter = new LlmTaskAdapter({ registry, providers: [provider] });
    const behaviorOS = new BehaviorOS();
    const orchestrator = new AutonomousOrchestrator({ behaviorOS, dna: TEST_DNA });
    orchestrator.registerAgent({
      id: 'agent-1',
      dnaPattern: TEST_DNA.name,
      capabilities: ['execute'],
      authority: 'admin',
    });
    orchestrator.registerAdapter(adapter);
    const plan: ControlLoopPlan = {
      title: 'LLM no-auditor',
      type: 'feature',
      priority: 'high',
      tasks: [llmTask('i')],
    };
    const loop = new ControlLoop({
      statePath: temporaryStatePath(),
      plan,
      agentId: 'agent-1',
      orchestrator,
      // No auditor → terminal `done` is unachievable.
    });

    const state = await loop.run();

    expect(state.status).toBe('blocked');
    expect(state.outcome).toBe('UNVERIFIED');
    expect(state.terminationReason).toBe('INDEPENDENT_AUDIT_REQUIRED');
    // The llm task itself completed with executed evidence — the block is
    // purely the missing independent audit, not a fake PASS.
    expect(state.tasks[0].status).toBe('completed');
    expect(state.tasks[0].evidence.some((entry) => entry.provenance === 'executed')).toBe(true);
  });

  it('scenario I (evidence integrity): invalid structured output cannot complete the mission', async () => {
    // A schema is declared, but the provider's content does not validate.
    // The adapter must turn that into a SCHEMA_MISMATCH failure (exit 1), so
    // the gate has no passing executed evidence and the mission cannot be
    // completed — never a fake PASS from model-authored text.
    const strictParser = {
      safeParse: (value: unknown) =>
        value === 'VALID'
          ? { success: true as const, data: value }
          : { success: false as const, error: 'expected VALID' },
    };
    const task = llmTask('i-schema', {
      input: { prompt: 'produce invalid output', responseSchema: strictParser },
    });
    const h = harness([task]);

    const state = await h.loop.run();

    expect(state.status).toBe('failed');
    expect(state.outcome).toBe('FAIL');
    expect(state.tasks[0].status).toBe('failed');
    expect(state.tasks[0].evidence.some((entry) => entry.status === 'failed')).toBe(true);
    const mission = state.missionId ? h.orchestrator.getMission(state.missionId) : null;
    expect(mission?.status).not.toBe('completed');
  });
});
