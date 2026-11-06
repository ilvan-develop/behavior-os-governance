import { describe, expect, it } from 'vitest';
import type { AdapterExecutionContext } from '../src/adapters.js';
import { LlmTaskAdapter } from '../src/llm/adapter.js';
import {
  type FetchLike,
  type HttpResponseLike,
  OpenAICompatibleProvider,
  openAICompatibleProviderFromEnv,
} from '../src/llm/openai-compatible-provider.js';
import { DeterministicLlmProvider, type LlmRequest } from '../src/llm/provider.js';
import { LlmProviderRegistry } from '../src/llm/registry.js';
import { LlmRouter } from '../src/llm/router.js';
import type { LlmSchemaParseResult, LlmSchemaParser } from '../src/llm/schema.js';

const API_KEY = 'test-secret-key-do-not-leak';

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
  return { requestId: 'req-1', prompt: 'hello', ...overrides };
}

function response(status: number, body: unknown): HttpResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

function completion(content: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'cmpl-1',
    model: 'vendor-model-1',
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function capturingFetch(
  responder: (call: CapturedCall) => HttpResponseLike | Promise<HttpResponseLike>,
): { fetchImpl: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: CapturedCall = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

function providerWith(fetchImpl: FetchLike, overrides: Record<string, unknown> = {}) {
  return new OpenAICompatibleProvider({
    name: 'apinex',
    baseUrl: 'https://api.example.test/v1/',
    apiKey: API_KEY,
    model: 'free/deepseek-v4.1-flash',
    fetchImpl,
    ...overrides,
  });
}

function objectParser(): LlmSchemaParser {
  return {
    safeParse(value: unknown): LlmSchemaParseResult {
      if (typeof value !== 'object' || value === null) {
        return { success: false, error: 'expected object' };
      }
      const record = value as Record<string, unknown>;
      if (record.status !== 'ok') return { success: false, error: 'expected status=ok' };
      return { success: true, data: record };
    },
  };
}

describe('OpenAICompatibleProvider', () => {
  it('is unavailable when baseUrl, apiKey or model is missing', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: '',
      apiKey: '',
      model: '',
      fetchImpl: async () => response(200, completion('x')),
    });
    expect(provider.isAvailable()).toBe(false);
    const outcome = await provider.complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('performs a real chat-completions request and normalizes the response', async () => {
    const { fetchImpl, calls } = capturingFetch(() => response(200, completion('PONG')));
    const provider = providerWith(fetchImpl);
    const outcome = await provider.complete(
      makeRequest({ temperature: 0.2, maxTokens: 32, timeoutMs: 5_000 }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.provider).toBe('apinex');
    expect(outcome.response.model).toBe('vendor-model-1');
    expect(outcome.response.content).toBe('PONG');
    expect(outcome.response.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
    expect(outcome.response.costUsd).toBe(0);
    expect(outcome.response.latencyMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe('https://api.example.test/v1/chat/completions');
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(call.headers['content-type']).toBe('application/json');
    const body = JSON.parse(call.body) as Record<string, unknown>;
    expect(body.model).toBe('free/deepseek-v4.1-flash');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(32);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('lets the request override the configured model', async () => {
    const { fetchImpl, calls } = capturingFetch(() => response(200, completion('ok')));
    await providerWith(fetchImpl).complete(makeRequest({ model: 'other-model' }));
    const body = JSON.parse(calls[0].body) as Record<string, unknown>;
    expect(body.model).toBe('other-model');
  });

  it('requests json_object and validates structured output against the schema', async () => {
    const { fetchImpl, calls } = capturingFetch(() =>
      response(200, completion('{"status":"ok","count":2}')),
    );
    const outcome = await providerWith(fetchImpl).complete(
      makeRequest({ responseSchema: objectParser() }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.structuredValid).toBe(true);
    expect(outcome.response.structured).toEqual({ status: 'ok', count: 2 });

    const body = JSON.parse(calls[0].body) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: 'json_object' });
    const messages = body.messages as Array<{ role: string }>;
    expect(messages[0].role).toBe('system');
  });

  it('reports structuredValid=false (not a false pass) when JSON does not match', async () => {
    const { fetchImpl } = capturingFetch(() => response(200, completion('{"status":"nope"}')));
    const outcome = await providerWith(fetchImpl).complete(
      makeRequest({ responseSchema: objectParser() }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response.structuredValid).toBe(false);
    expect(outcome.response.warnings?.length).toBeGreaterThan(0);
  });

  it('reports structuredValid=false when the content is not JSON', async () => {
    const { fetchImpl } = capturingFetch(() => response(200, completion('not json at all')));
    const outcome = await providerWith(fetchImpl).complete(
      makeRequest({ responseSchema: objectParser() }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.response.structuredValid).toBe(false);
  });

  it('classifies 401 as a non-retryable authentication failure without leaking the key', async () => {
    const { fetchImpl } = capturingFetch(() => response(401, { error: 'invalid key' }));
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(outcome.error.retryable).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
  });

  it('classifies 429 as retryable rate limiting', async () => {
    const { fetchImpl } = capturingFetch(() => response(429, { error: 'slow down' }));
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('RATE_LIMITED');
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it('classifies 5xx as retryable provider unavailability', async () => {
    const { fetchImpl } = capturingFetch(() => response(503, { error: 'down' }));
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it('classifies a context-window rejection', async () => {
    const { fetchImpl } = capturingFetch(() =>
      response(400, { error: 'maximum context length exceeded' }),
    );
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('CONTEXT_WINDOW_EXCEEDED');
  });

  it('classifies malformed JSON bodies as INVALID_RESPONSE', async () => {
    const { fetchImpl } = capturingFetch(() => response(200, 'not-json'));
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('INVALID_RESPONSE');
  });

  it('rejects a response with no textual content', async () => {
    const { fetchImpl } = capturingFetch(() =>
      response(200, { choices: [{ message: { content: null } }] }),
    );
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('INVALID_RESPONSE');
  });

  it('enforces the request deadline and classifies TIMEOUT', async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const outcome = await providerWith(hangingFetch, { timeoutMs: 10 }).complete(makeRequest());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('TIMEOUT');
      expect(outcome.error.retryable).toBe(true);
    }
  });

  it('honours an already-aborted caller signal as CANCELLED', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = capturingFetch(() => response(200, completion('never')));
    const outcome = await providerWith(fetchImpl).complete(
      makeRequest({ signal: controller.signal }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('CANCELLED');
  });

  it('warns when the provider truncates the output', async () => {
    const { fetchImpl } = capturingFetch(() =>
      response(200, {
        ...(completion('partial') as Record<string, unknown>),
        choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
      }),
    );
    const outcome = await providerWith(fetchImpl).complete(makeRequest());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.response.warnings?.join(' ')).toContain('truncated');
  });
});

describe('openAICompatibleProviderFromEnv', () => {
  it('returns undefined unless all required variables are present', () => {
    expect(openAICompatibleProviderFromEnv({})).toBeUndefined();
    expect(
      openAICompatibleProviderFromEnv({ BEHAVIOROS_LLM_BASE_URL: 'https://x/v1' }),
    ).toBeUndefined();
    expect(
      openAICompatibleProviderFromEnv({
        BEHAVIOROS_LLM_BASE_URL: 'https://x/v1',
        BEHAVIOROS_LLM_API_KEY: 'k',
        BEHAVIOROS_LLM_MODEL: 'm',
      }),
    ).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('maps the optional name, timeout and json-mode flags', () => {
    const provider = openAICompatibleProviderFromEnv({
      BEHAVIOROS_LLM_BASE_URL: 'https://x/v1',
      BEHAVIOROS_LLM_API_KEY: 'k',
      BEHAVIOROS_LLM_MODEL: 'm',
      BEHAVIOROS_LLM_NAME: 'vendor-x',
      BEHAVIOROS_LLM_TIMEOUT_MS: '1234',
      BEHAVIOROS_LLM_JSON_MODE: '0',
    });
    expect(provider?.name).toBe('vendor-x');
    expect(provider?.isAvailable()).toBe(true);
  });
});

describe('vendor provider inside the gateway', () => {
  it('falls back to a deterministic provider on a retryable vendor failure', async () => {
    const { fetchImpl } = capturingFetch(() => response(503, { error: 'down' }));
    const vendor = providerWith(fetchImpl);
    const registry = new LlmProviderRegistry();
    registry.register(vendor);
    registry.register(new DeterministicLlmProvider());
    const router = new LlmRouter(registry);

    const result = await router.route(makeRequest({ provider: 'apinex' }));
    expect(result.outcome.ok).toBe(true);
    if (!result.outcome.ok) return;
    expect(result.outcome.response.provider).toBe('deterministic');
    expect(result.decision.fallbackFrom).toBe('apinex');
    expect(registry.healthOf('apinex').consecutiveFailures).toBe(1);
  });

  it('drives the LlmTaskAdapter end to end with a vendor response', async () => {
    const { fetchImpl } = capturingFetch(() => response(200, completion('PONG')));
    const adapter = new LlmTaskAdapter({ providers: [providerWith(fetchImpl)] });
    const result = await adapter.execute({ prompt: 'ping' }, makeContext());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('PONG');
    expect(result.stderr).toBe('');
    const metadata = result.metadata as { llm?: { provider?: string; inputTokens?: number } };
    expect(metadata.llm?.provider).toBe('apinex');
    expect(metadata.llm?.inputTokens).toBe(11);
  });
});
