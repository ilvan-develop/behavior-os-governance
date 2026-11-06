import { describe, expect, it } from 'vitest';
import type { AdapterExecutionContext } from '../src/adapters.js';
import { LlmTaskAdapter } from '../src/llm/adapter.js';
import {
  type OpenAICompatibleProvider,
  openAICompatibleProviderFromEnv,
} from '../src/llm/openai-compatible-provider.js';
import type { LlmRequest } from '../src/llm/provider.js';
import type { LlmSchemaParseResult, LlmSchemaParser } from '../src/llm/schema.js';

/**
 * Live vendor integration test.
 *
 * Skipped unless `BEHAVIOROS_LLM_LIVE=1`. Requires a real OpenAI-compatible
 * endpoint plus credentials:
 *   BEHAVIOROS_LLM_BASE_URL, BEHAVIOROS_LLM_API_KEY, BEHAVIOROS_LLM_MODEL
 *
 * This test proves the adapter against a real network provider; it is the
 * evidence that closes the former "vendor LLM BLOCKED" item. It never runs in
 * the offline suite, so CI without credentials stays deterministic.
 */
const live = process.env.BEHAVIOROS_LLM_LIVE === '1';

function requireProvider(): OpenAICompatibleProvider {
  const provider = openAICompatibleProviderFromEnv();
  if (!provider) {
    throw new Error(
      'Live test requires BEHAVIOROS_LLM_BASE_URL, BEHAVIOROS_LLM_API_KEY and BEHAVIOROS_LLM_MODEL',
    );
  }
  return provider;
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    requestId: `live-${Date.now()}`,
    prompt: 'Reply with the single word: PONG',
    ...overrides,
  };
}

const statusParser: LlmSchemaParser = {
  safeParse(value: unknown): LlmSchemaParseResult {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { success: false, error: 'expected a JSON object' };
    }
    const record = value as Record<string, unknown>;
    if (record.status !== 'ok') return { success: false, error: 'expected status=ok' };
    return { success: true, data: record };
  },
};

function context(): AdapterExecutionContext {
  return {
    taskId: 'live-task',
    missionId: 'live-mission',
    correlationId: 'live-mission',
    idempotencyKey: 'live:task:1',
    agentId: 'agent-audit',
    attempt: 1,
    signal: new AbortController().signal,
    timeoutMs: 60_000,
  };
}

describe.skipIf(!live)('OpenAICompatibleProvider (live vendor)', () => {
  it('returns a non-empty completion with real token usage', { timeout: 90_000 }, async () => {
    const provider = requireProvider();
    const outcome = await provider.complete(request({ maxTokens: 16 }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.response.content.trim().length).toBeGreaterThan(0);
    expect(outcome.response.usage.inputTokens).toBeGreaterThan(0);
    expect(outcome.response.usage.outputTokens).toBeGreaterThan(0);
    expect(outcome.response.model.length).toBeGreaterThan(0);
    expect(outcome.response.provider).toBe(provider.name);
    expect(outcome.response.latencyMs).toBeGreaterThan(0);
  });

  it('validates schema-constrained JSON output from the real model', {
    timeout: 90_000,
  }, async () => {
    const provider = requireProvider();
    const outcome = await provider.complete(
      request({
        prompt: 'Return a JSON object with exactly one key "status" whose value is "ok".',
        responseSchema: statusParser,
        maxTokens: 64,
        temperature: 0,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.response.structuredValid).toBe(true);
    expect(outcome.response.structured).toMatchObject({ status: 'ok' });
  });

  it('runs the governed LlmTaskAdapter end to end against the real provider', {
    timeout: 90_000,
  }, async () => {
    const provider = requireProvider();
    const adapter = new LlmTaskAdapter({ providers: [provider] });
    const result = await adapter.execute(
      { prompt: 'Reply with the single word: PONG', maxTokens: 16 },
      context(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().length).toBeGreaterThan(0);
    const metadata = result.metadata as {
      llm?: { provider?: string; inputTokens?: number; latencyMs?: number };
    };
    expect(metadata.llm?.provider).toBe(provider.name);
    expect(metadata.llm?.inputTokens).toBeGreaterThan(0);
    expect(metadata.llm?.latencyMs).toBeGreaterThan(0);
  });
});
