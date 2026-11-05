import { describe, expect, it } from 'vitest';
import type { AdapterExecutionContext } from '../src/adapters.js';
import { LlmTaskAdapter } from '../src/llm/adapter.js';
import { LlmContextBuilder } from '../src/llm/context-builder.js';
import {
  DeterministicLlmProvider,
  LLM_ERROR_CODES,
  type LlmProvider,
  type LlmProviderCapabilities,
  type LlmRequest,
  type LlmResponse,
  type LlmTelemetryRecord,
} from '../src/llm/provider.js';
import { LlmProviderRegistry } from '../src/llm/registry.js';
import { LlmRouter } from '../src/llm/router.js';
import type { LlmSchemaParseResult, LlmSchemaParser } from '../src/llm/schema.js';
import {
  LLM_TELEMETRY_META_KEY,
  persistLlmTelemetry,
  restoreLlmTelemetry,
} from '../src/llm/telemetry.js';

/**
 * Minimal structural parser standing in for a Zod schema (the orchestrator
 * package does not depend on `zod` directly; callers pass their own schema
 * library at the seam). Satisfies `LlmSchemaParser`.
 */
function enumParser(allowed: string[]): LlmSchemaParser {
  return {
    safeParse(value: unknown): LlmSchemaParseResult {
      if (typeof value !== 'string' || !allowed.includes(value)) {
        return { success: false, error: `expected one of ${allowed.join(', ')}` };
      }
      return { success: true, data: value };
    },
  };
}

function makeContext(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    taskId: 'task-1',
    missionId: 'mission-1',
    correlationId: 'mission-1',
    idempotencyKey: 'mission-1:task-1',
    agentId: 'agent-1',
    attempt: 1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    requestId: 'req-1',
    prompt: 'hello',
    ...overrides,
  };
}

describe('DeterministicLlmProvider', () => {
  it('returns a well-formed success response by default', async () => {
    const provider = new DeterministicLlmProvider({ name: 'det' });
    const outcome = await provider.complete(makeRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const response = outcome.response as LlmResponse;
    expect(response.provider).toBe('det');
    expect(response.content).toContain('det');
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.costUsd).toBe(0);
  });

  it('reports classified PROVIDER_UNAVAILABLE when disabled', async () => {
    const provider = new DeterministicLlmProvider({ name: 'det', available: false });
    const outcome = await provider.complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(outcome.error.retryable).toBe(true);
  });

  it('honors cancellation', async () => {
    const provider = new DeterministicLlmProvider({ name: 'det' });
    const controller = new AbortController();
    controller.abort();
    const outcome = await provider.complete(makeRequest({ signal: controller.signal }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('CANCELLED');
    expect(outcome.error.retryable).toBe(false);
  });

  it('validates structured output against the declared schema', async () => {
    const provider = new DeterministicLlmProvider({
      name: 'structured',
      respond: (request) => ({
        requestId: request.requestId,
        provider: 'structured',
        model: 'structured-v1',
        content: 'approve',
        usage: { inputTokens: 10, outputTokens: 20 },
        costUsd: 0,
        latencyMs: 1,
      }),
    });
    const schema = enumParser(['approve', 'reject']);
    const outcome = await provider.complete(
      makeRequest({ prompt: 'approve', responseSchema: schema }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.structuredValid).toBe(true);
    expect(outcome.response.structured).toBe('approve');
  });

  it('flags structured output that fails schema validation', async () => {
    const provider = new DeterministicLlmProvider({
      name: 'structured',
      respond: (request) => ({
        requestId: request.requestId,
        provider: 'structured',
        model: 'structured-v1',
        content: 'maybe',
        usage: { inputTokens: 10, outputTokens: 20 },
        costUsd: 0,
        latencyMs: 1,
      }),
    });
    const schema = enumParser(['approve', 'reject']);
    const outcome = await provider.complete(
      makeRequest({ prompt: 'maybe', responseSchema: schema }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.structuredValid).toBe(false);
    expect(outcome.response.warnings?.some((warning) => warning.includes('schema'))).toBe(true);
  });

  it('exposes all known error codes', () => {
    expect(LLM_ERROR_CODES).toContain('SCHEMA_MISMATCH');
    expect(LLM_ERROR_CODES).toContain('PROVIDER_UNAVAILABLE');
  });
});

describe('LlmProviderRegistry', () => {
  it('registers, lists and health-tracks providers', () => {
    const registry = new LlmProviderRegistry();
    const provider = new DeterministicLlmProvider({ name: 'a' });
    registry.register(provider);
    expect(registry.list()).toHaveLength(1);
    expect(registry.healthOf('a').state).toBe('healthy');

    registry.recordHealth('a', false, 'TIMEOUT');
    expect(registry.healthOf('a').consecutiveFailures).toBe(1);
    registry.recordHealth('a', false, 'TIMEOUT');
    expect(registry.healthOf('a').state).toBe('degraded');
    registry.recordHealth('a', false, 'TIMEOUT');
    registry.recordHealth('a', false, 'TIMEOUT');
    expect(registry.healthOf('a').state).toBe('unavailable');
    expect(registry.routeable().some((entry) => entry.name === 'a')).toBe(false);

    registry.recordHealth('a', true);
    expect(registry.healthOf('a').state).toBe('healthy');
    expect(registry.routeable().some((entry) => entry.name === 'a')).toBe(true);
  });

  it('does not degrade or count non-retryable failures', () => {
    const registry = new LlmProviderRegistry();
    registry.register(new DeterministicLlmProvider({ name: 'a' }));
    registry.recordHealth('a', false, 'SCHEMA_MISMATCH');
    // Non-retryable codes are request-specific, not provider-health problems:
    // they neither degrade the state nor accumulate consecutive failures.
    expect(registry.healthOf('a').state).toBe('healthy');
    expect(registry.healthOf('a').consecutiveFailures).toBe(0);
    // A retryable failure still counts and can degrade.
    registry.recordHealth('a', false, 'TIMEOUT');
    registry.recordHealth('a', false, 'TIMEOUT');
    expect(registry.healthOf('a').state).toBe('degraded');
  });

  it('requires every requested capability (AND, not OR)', () => {
    const registry = new LlmProviderRegistry();
    registry.register(
      new DeterministicLlmProvider({
        name: 'chat-only',
        capabilities: { structuredOutput: false, json: false },
      }),
    );
    registry.register(new DeterministicLlmProvider({ name: 'full' }));
    const capable = registry.capable(['chat', 'structuredOutput']);
    expect(capable.map((provider) => provider.name)).toEqual(['full']);
  });

  it('records and snapshots telemetry within the bounded ring', () => {
    const registry = new LlmProviderRegistry({ telemetryLimit: 3 });
    const record: LlmTelemetryRecord = {
      requestId: 'r1',
      provider: 'a',
      model: 'a-v1',
      routingReason: 'selected',
      ok: true,
      inputTokens: 1,
      outputTokens: 2,
      costUsd: 0,
      latencyMs: 1,
      at: '2026-01-01T00:00:00.000Z',
    };
    for (let i = 0; i < 5; i += 1) {
      registry.recordTelemetry({ ...record, requestId: `r${i + 1}` });
    }
    const snapshot = registry.telemetrySnapshot();
    expect(snapshot).toHaveLength(3);
    expect(snapshot.map((entry) => entry.requestId)).toEqual(['r3', 'r4', 'r5']);

    const restored = new LlmProviderRegistry({ telemetryLimit: 3 });
    restored.restoreTelemetry(snapshot);
    expect(restored.telemetrySnapshot()).toHaveLength(3);
  });
});

describe('LlmRouter', () => {
  it('routes to the cheapest eligible provider by default', async () => {
    const registry = new LlmProviderRegistry();
    registry.register(
      new DeterministicLlmProvider({
        name: 'expensive',
        capabilities: {
          chat: true,
          structuredOutput: true,
          json: true,
          contextWindow: 32_000,
          costPerMInputUsd: 3,
          costPerMOutputUsd: 6,
          baselineLatencyMs: 500,
        },
      }),
    );
    registry.register(
      new DeterministicLlmProvider({
        name: 'cheap',
        capabilities: {
          chat: true,
          structuredOutput: false,
          json: false,
          contextWindow: 4_096,
          costPerMInputUsd: 0,
          costPerMOutputUsd: 0,
          baselineLatencyMs: 1,
        },
      }),
    );
    const router = new LlmRouter(registry);
    const { outcome, decision } = await router.route(makeRequest());
    expect(outcome.ok).toBe(true);
    expect(decision.provider).toBe('cheap');
    expect(decision.reason).toBe('capability+cost+latency');
  });

  it('falls back to the next provider when the pinned one is unavailable', async () => {
    const registry = new LlmProviderRegistry();
    const primary = new DeterministicLlmProvider({ name: 'primary', available: false });
    registry.register(primary);
    registry.register(
      new DeterministicLlmProvider({
        name: 'fallback',
        capabilities: {
          chat: true,
          structuredOutput: true,
          json: true,
          contextWindow: 32_000,
          costPerMInputUsd: 0,
          costPerMOutputUsd: 0,
          baselineLatencyMs: 1,
        },
      }),
    );
    // Rank: both have zero cost; the alphabetical order puts 'fallback' before
    // 'primary', so pinning 'primary' starts at index 1 and the fallback hop
    // has no candidate after it — instead pin the *higher-cost* one so the
    // cheaper fallback is ranked below it.
    const registry2 = new LlmProviderRegistry();
    const expensivePrimary = new DeterministicLlmProvider({
      name: 'expensive-primary',
      available: false,
      capabilities: {
        chat: true,
        structuredOutput: true,
        json: true,
        contextWindow: 32_000,
        costPerMInputUsd: 5,
        costPerMOutputUsd: 5,
        baselineLatencyMs: 900,
      },
    });
    registry2.register(expensivePrimary);
    registry2.register(
      new DeterministicLlmProvider({
        name: 'cheap-fallback',
        capabilities: {
          chat: true,
          structuredOutput: true,
          json: true,
          contextWindow: 32_000,
          costPerMInputUsd: 0,
          costPerMOutputUsd: 0,
          baselineLatencyMs: 1,
        },
      }),
    );
    const router = new LlmRouter(registry2);
    const { outcome, decision } = await router.route(
      makeRequest({ provider: 'expensive-primary' }),
    );
    expect(outcome.ok).toBe(true);
    expect(decision.provider).toBe('cheap-fallback');
    expect(decision.fallbackFrom).toBe('expensive-primary');
    expect(decision.reason).toContain('fallback:expensive-primary');
  });

  it('never routes a declared schema to a provider without structured output', async () => {
    const registry = new LlmProviderRegistry();
    // The cheap provider cannot enforce the schema. It must be excluded even
    // though its cost profile would otherwise rank it first.
    registry.register(
      new DeterministicLlmProvider({
        name: 'cheap-chat',
        capabilities: { structuredOutput: false, json: false },
      }),
    );
    registry.register(
      new DeterministicLlmProvider({
        name: 'structured',
        capabilities: { costPerMInputUsd: 1, costPerMOutputUsd: 1, baselineLatencyMs: 9 },
      }),
    );
    const router = new LlmRouter(registry, { now: () => '2026-01-01T00:00:00.000Z' });
    const { outcome, decision } = await router.route({
      requestId: 'r-schema',
      prompt: 'x',
      responseSchema: enumParser(['approve', 'reject']),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.response.provider).toBe('structured');
    expect(decision.provider).toBe('structured');
  });

  it('contains a provider that throws and falls back instead of propagating', async () => {
    const throwing = new DeterministicLlmProvider({ name: 'throwing' });
    throwing.complete = async () => {
      throw new Error('boom');
    };
    const registry = new LlmProviderRegistry();
    registry.register(throwing);
    registry.register(new DeterministicLlmProvider({ name: 'healthy' }));
    const router = new LlmRouter(registry);
    const { outcome } = await router.route({ requestId: 'r-throw', prompt: 'x' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.response.provider).toBe('healthy');
  });

  it('records the precise routing reason in telemetry', async () => {
    const registry = new LlmProviderRegistry();
    registry.register(new DeterministicLlmProvider({ name: 'a' }));
    const router = new LlmRouter(registry);
    await router.route({ requestId: 'r-reason', prompt: 'x' });
    expect(registry.telemetrySnapshot()[0]?.routingReason).toBe('capability+cost+latency');
  });

  it('reports PROVIDER_UNAVAILABLE when no provider is eligible', async () => {
    const registry = new LlmProviderRegistry();
    registry.register(new DeterministicLlmProvider({ name: 'only', available: false }));
    for (let i = 0; i < 4; i += 1) registry.recordHealth('only', false, 'TIMEOUT');
    const router = new LlmRouter(registry);
    const { outcome } = await router.route(makeRequest());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('does not fall back on non-retryable errors', async () => {
    const registry = new LlmProviderRegistry();
    const failing = new DeterministicLlmProvider({
      name: 'failing',
      respond: () => ({
        code: 'SCHEMA_MISMATCH',
        provider: 'failing',
        message: 'structured output did not validate',
        retryable: false,
      }),
    });
    registry.register(failing);
    registry.register(new DeterministicLlmProvider({ name: 'fallback' }));
    const router = new LlmRouter(registry);
    const schema = enumParser(['x']);
    const { outcome, decision } = await router.route(
      makeRequest({
        provider: 'failing',
        responseSchema: schema,
      }),
    );
    // The pinned provider failed with a non-retryable error → no fallback.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('SCHEMA_MISMATCH');
    expect(decision.provider).toBe('failing');
    expect(decision.fallbackFrom).toBeUndefined();
  });
});

describe('LlmContextBuilder', () => {
  const builder = new LlmContextBuilder({ maxContextTokens: 200 });

  it('assembles a bounded prompt from governed state', () => {
    const result = builder.build({
      taskObjective: 'classify the incident',
      acceptanceGates: ['verdict'],
      evidence: [
        {
          gate: 'lint',
          status: 'passed',
          source: 'shell',
          provenance: 'executed',
          executionId: 'exec-1',
          recordedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      history: ['first attempt failed'],
    });
    expect(result.prompt).toContain('classify the incident');
    expect(result.prompt).toContain('verdict');
    expect(result.estimatedTokens).toBeLessThanOrEqual(200);
    expect(result.includedSections).toContain('task');
    expect(result.includedSections).toContain('evidence');
  });

  it('drops less important sections when the budget is tight', () => {
    const tight = new LlmContextBuilder({ maxContextTokens: 40 });
    const result = tight.build({
      taskObjective: 'x'.repeat(200),
      history: ['a'.repeat(500)],
      dna: {
        name: 'test',
        version: '1.0.0',
        description: 'test',
        personas: [],
        governance: [
          {
            id: 'r1',
            level: 'critical',
            action: 'block',
            conditions: [{ type: 'production', value: true }],
          },
        ],
        quality: [],
      },
    });
    // Task is always included; history and dna get dropped for budget.
    expect(result.includedSections).toContain('task');
    expect(result.droppedSections).toContain('history');
    expect(result.droppedSections).toContain('dna');
  });

  it('is deterministic: same sources → same prompt', () => {
    const sources = {
      taskObjective: 'objective',
      acceptanceGates: ['g1'],
    };
    const a = builder.build(sources);
    const b = builder.build(sources);
    expect(a.prompt).toBe(b.prompt);
    expect(a.includedSections).toEqual(b.includedSections);
  });
});

describe('LlmTaskAdapter (TaskAdapter seam)', () => {
  it('executes a task through the governed seam and returns an AdapterResult', async () => {
    const adapter = new LlmTaskAdapter();
    const result = await adapter.execute({ prompt: 'hello' }, makeContext());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    const llmMeta = result.metadata?.llm as { provider?: string; executionId?: string } | undefined;
    expect(llmMeta?.provider).toBeDefined();
    expect(llmMeta?.executionId).toBe('mission-1:task-1');
  });

  it('records a task failure (exit 1) when the LLM call fails', async () => {
    const adapter = new LlmTaskAdapter({
      providers: [new DeterministicLlmProvider({ name: 'det', available: false })],
    });
    const result = await adapter.execute({ prompt: 'hello' }, makeContext());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('PROVIDER_UNAVAILABLE');
  });

  it('fails acceptance when structured output does not validate', async () => {
    const adapter = new LlmTaskAdapter({
      providers: [
        new DeterministicLlmProvider({
          name: 'det',
          respond: () => ({
            requestId: 'r',
            provider: 'det',
            model: 'det-v1',
            content: 'maybe',
            usage: { inputTokens: 1, outputTokens: 1 },
            costUsd: 0,
            latencyMs: 1,
          }),
        }),
      ],
    });
    const schema = enumParser(['approve', 'reject']);
    const result = await adapter.execute(
      {
        prompt: 'x',
        responseSchema: schema,
      },
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SCHEMA_MISMATCH');
  });

  it('fails when a provider advertises schema support but does not validate', async () => {
    // The router is allowed to select this provider (it advertises
    // structuredOutput), but its response never carries `structuredValid`.
    // The adapter must treat that as SCHEMA_MISMATCH, never a silent pass.
    const capabilities: LlmProviderCapabilities = {
      chat: true,
      structuredOutput: true,
      json: true,
      contextWindow: 32_000,
      costPerMInputUsd: 0,
      costPerMOutputUsd: 0,
      baselineLatencyMs: 1,
    };
    const unvalidatedProvider: LlmProvider = {
      name: 'unvalidated',
      capabilities,
      isAvailable: () => true,
      complete: async (request: LlmRequest) => ({
        ok: true as const,
        response: {
          requestId: request.requestId,
          provider: 'unvalidated',
          model: 'unvalidated-v1',
          content: 'approve',
          usage: { inputTokens: 1, outputTokens: 1 },
          costUsd: 0,
          latencyMs: 1,
        },
      }),
    };
    const adapter = new LlmTaskAdapter({ providers: [unvalidatedProvider] });
    const result = await adapter.execute(
      { prompt: 'x', responseSchema: enumParser(['approve', 'reject']) },
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SCHEMA_MISMATCH');
  });

  it('rejects a responseSchema that is not a parser', async () => {
    const adapter = new LlmTaskAdapter();
    const result = await adapter.execute(
      { prompt: 'x', responseSchema: 'not-a-parser' },
      makeContext(),
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SCHEMA_MISMATCH');
  });

  it('serializes validated structured output as the stdout payload', async () => {
    const adapter = new LlmTaskAdapter({
      providers: [
        new DeterministicLlmProvider({
          name: 'det',
          respond: () => ({
            requestId: 'r',
            provider: 'det',
            model: 'det-v1',
            content: 'approve',
            usage: { inputTokens: 1, outputTokens: 1 },
            costUsd: 0,
            latencyMs: 1,
          }),
        }),
      ],
    });
    const schema = enumParser(['approve', 'reject']);
    const result = await adapter.execute(
      {
        prompt: 'x',
        responseSchema: schema,
      },
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toBe('approve');
  });

  it('builds the prompt from contextSources when no explicit prompt is given', async () => {
    const adapter = new LlmTaskAdapter();
    const result = await adapter.execute(
      {
        contextSources: {
          taskObjective: 'classify this',
          acceptanceGates: ['verdict'],
        },
      },
      makeContext(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('classify this');
  });
});

describe('LLM telemetry persistence (ADR-003: Store.setMeta channel)', () => {
  it('round-trips the telemetry ring through a real SqliteStore', async () => {
    const { SqliteStore } = await import('@behavior-os/core');
    const store = new SqliteStore({ path: ':memory:' });
    try {
      const registry = new LlmProviderRegistry();
      registry.register(new DeterministicLlmProvider({ name: 'a' }));
      const record: LlmTelemetryRecord = {
        requestId: 'r1',
        provider: 'a',
        model: 'a-v1',
        routingReason: 'selected',
        ok: true,
        inputTokens: 5,
        outputTokens: 10,
        costUsd: 0,
        latencyMs: 2,
        at: '2026-01-01T00:00:00.000Z',
        executionId: 'mission-1:task-1',
      };
      registry.recordTelemetry(record);

      const persisted = persistLlmTelemetry(store, registry.telemetrySnapshot());
      expect(persisted).toBe(1);

      // A fresh registry in a "new process" restores the ring from the same
      // durable key — proving telemetry survives a restart.
      const restored = new LlmProviderRegistry();
      const count = restoreLlmTelemetry(store, restored);
      expect(count).toBe(1);
      expect(restored.telemetrySnapshot()).toEqual([record]);
      expect(LLM_TELEMETRY_META_KEY).toBe('llm-telemetry');
    } finally {
      store.close();
    }
  });

  it('treats malformed persisted telemetry as a no-op', () => {
    const source = {
      getMeta(key: string): string | null {
        return key === LLM_TELEMETRY_META_KEY ? '{not json' : null;
      },
    };
    const registry = new LlmProviderRegistry();
    expect(restoreLlmTelemetry(source, registry)).toBe(0);
    expect(registry.telemetrySnapshot()).toEqual([]);
  });

  it('returns 0 when no telemetry has been persisted yet', () => {
    const source = { getMeta: (): string | null => null };
    const registry = new LlmProviderRegistry();
    expect(restoreLlmTelemetry(source, registry)).toBe(0);
  });
});
