/**
 * OpenAI-compatible vendor provider.
 *
 * Implements the universal {@link LlmProvider} contract against any endpoint
 * that speaks the OpenAI `POST /chat/completions` protocol (OpenAI, APInex,
 * TokenHarbor, Groq, OpenRouter, vLLM, LM Studio, ...). This is the vendor
 * adapter that ADR-002 deferred until real credentials existed; it stays
 * dependency-free (global `fetch`) so the orchestrator keeps a light
 * dependency graph (ADR-001).
 *
 * Design rules carried over from the contract:
 *  - `complete()` never throws; every failure is classified into an
 *    `LlmErrorCode` so the router can make a deterministic fallback decision.
 *  - The provider never calls governance, never mutates mission state and
 *    never persists anything (ADR-004/ADR-005).
 *  - The API key is never included in errors, warnings or telemetry.
 */

import type {
  LlmError,
  LlmErrorCode,
  LlmOutcome,
  LlmProvider,
  LlmProviderCapabilities,
  LlmRequest,
  LlmResponse,
} from './provider.js';

/** Minimal response surface used by the provider (keeps DOM types out). */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Minimal request surface used by the provider. */
export interface HttpRequestInitLike {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

/** Injectable `fetch` seam (tests never touch the network). */
export type FetchLike = (url: string, init: HttpRequestInitLike) => Promise<HttpResponseLike>;

export interface OpenAICompatibleProviderConfig {
  /** Registry key. Defaults to `openai-compatible`. */
  name?: string;
  /** API root *including* the version segment, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Bearer token. Never logged. */
  apiKey: string;
  /** Default model id used when the request does not pin one. */
  model: string;
  /** Capability/cost/latency overrides. */
  capabilities?: Partial<LlmProviderCapabilities>;
  /** Test seam; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /**
   * Send `response_format: { type: "json_object" }` for structured requests.
   * Enabled by default; disable for vendors that reject the field.
   */
  jsonMode?: boolean;
  /** Additional headers (vendor-specific routing, e.g. org ids). */
  headers?: Record<string, string>;
  /** Default per-request timeout in ms. Defaults to 60_000. */
  timeoutMs?: number;
  /** Injectable clock used for latency measurement. */
  now?: () => number;
}

const DEFAULT_CAPABILITIES: LlmProviderCapabilities = {
  chat: true,
  structuredOutput: true,
  json: true,
  contextWindow: 128_000,
  costPerMInputUsd: 0,
  costPerMOutputUsd: 0,
  baselineLatencyMs: 800,
};

const DEFAULT_TIMEOUT_MS = 60_000;

/** OpenAI-shaped chat completion payload (only the fields we read). */
interface ChatCompletionPayload {
  model?: unknown;
  choices?: unknown;
  usage?: unknown;
}

interface ChatCompletionChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Vendor adapter for the OpenAI chat-completions protocol.
 *
 * @example
 * const provider = new OpenAICompatibleProvider({
 *   baseUrl: 'https://api.apinex.bond/v1',
 *   apiKey: process.env.BEHAVIOROS_LLM_API_KEY ?? '',
 *   model: 'free/deepseek-v4.1-flash',
 *   name: 'apinex',
 * });
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly capabilities: LlmProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly jsonMode: boolean;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.name = config.name?.trim() || 'openai-compatible';
    this.baseUrl = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    this.apiKey = (config.apiKey ?? '').trim();
    this.model = (config.model ?? '').trim();
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
    this.fetchImpl = config.fetchImpl ?? globalFetch();
    this.jsonMode = config.jsonMode ?? true;
    this.extraHeaders = { ...(config.headers ?? {}) };
    this.timeoutMs =
      typeof config.timeoutMs === 'number' && config.timeoutMs > 0
        ? config.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this.now = config.now ?? (() => Date.now());
  }

  /** Cheap, synchronous configuration probe (no network I/O). */
  isAvailable(): boolean {
    return this.baseUrl.length > 0 && this.apiKey.length > 0 && this.model.length > 0;
  }

  async complete(request: LlmRequest): Promise<LlmOutcome> {
    if (!this.isAvailable()) {
      return this.failure(
        'PROVIDER_UNAVAILABLE',
        'provider is not configured (baseUrl, apiKey and model are required)',
        false,
        request.model,
      );
    }
    if (request.signal?.aborted) {
      return this.failure('CANCELLED', 'Request cancelled before execution', false, request.model);
    }

    const model = (request.model ?? this.model).trim();
    const wantsStructured =
      request.responseSchema !== undefined && this.capabilities.structuredOutput;
    const body = this.buildBody(request, model, wantsStructured);
    const timeoutMs = this.effectiveTimeout(request.timeoutMs);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    const onCallerAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const startedAt = this.now();
    try {
      const response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      if (!response.ok) {
        return { ok: false, error: this.classifyHttp(response.status, rawText, model) };
      }
      return this.parseSuccess(rawText, request, model, wantsStructured, startedAt);
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) {
          return this.failure(
            'TIMEOUT',
            `request exceeded the ${timeoutMs}ms deadline`,
            true,
            model,
          );
        }
        return this.failure('CANCELLED', 'Request cancelled by the caller', false, model);
      }
      return this.failure(
        'INVALID_RESPONSE',
        `transport error: ${error instanceof Error ? error.message : String(error)}`,
        false,
        model,
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private endpoint(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  private effectiveTimeout(requestTimeoutMs?: number): number {
    return typeof requestTimeoutMs === 'number' && requestTimeoutMs > 0
      ? requestTimeoutMs
      : this.timeoutMs;
  }

  private buildBody(
    request: LlmRequest,
    model: string,
    wantsStructured: boolean,
  ): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [];
    if (wantsStructured) {
      messages.push({
        role: 'system',
        content: 'Respond with a single valid JSON object and nothing else. No markdown fences.',
      });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body: Record<string, unknown> = { model, messages };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (wantsStructured && this.jsonMode) {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private parseSuccess(
    rawText: string,
    request: LlmRequest,
    model: string,
    wantsStructured: boolean,
    startedAt: number,
  ): LlmOutcome {
    let payload: ChatCompletionPayload;
    try {
      payload = JSON.parse(rawText) as ChatCompletionPayload;
    } catch {
      return this.failure(
        'INVALID_RESPONSE',
        'provider returned a body that is not valid JSON',
        false,
        model,
      );
    }
    if (!isRecord(payload)) {
      return this.failure('INVALID_RESPONSE', 'provider returned an empty payload', false, model);
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? (choices[0] as ChatCompletionChoice) : undefined;
    const contentValue = isRecord(first?.message) ? first.message.content : undefined;
    if (typeof contentValue !== 'string' || contentValue.trim().length === 0) {
      return this.failure(
        'INVALID_RESPONSE',
        'provider response contained no textual content',
        false,
        model,
      );
    }
    const content = contentValue.trim();

    const reportedModel =
      typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : model;

    const usage = isRecord(payload.usage) ? payload.usage : {};
    const inputTokens = readNumber(usage.prompt_tokens) ?? estimateTokens(request.prompt);
    const outputTokens = readNumber(usage.completion_tokens) ?? estimateTokens(content);
    const costUsd = this.costOf(inputTokens, outputTokens);

    const warnings: string[] = [];
    if (first?.finish_reason === 'length') {
      warnings.push('provider truncated the output (finish_reason=length)');
    }

    let structured: unknown;
    let structuredValid: boolean | undefined;
    if (wantsStructured && request.responseSchema) {
      const parsedJson = tryParseJson(content);
      if (parsedJson.ok) {
        try {
          const parsed = request.responseSchema.safeParse(parsedJson.value);
          structured = parsed.success ? parsed.data : content;
          structuredValid = parsed.success;
          if (!parsed.success) {
            warnings.push('structured output did not validate against the declared schema');
          }
        } catch (error) {
          structured = content;
          structuredValid = false;
          warnings.push(
            `schema parser threw: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else {
        structured = content;
        structuredValid = false;
        warnings.push('structured output was not valid JSON');
      }
    }

    const response: LlmResponse = {
      requestId: request.requestId,
      provider: this.name,
      model: reportedModel,
      content,
      usage: { inputTokens, outputTokens },
      costUsd,
      latencyMs: Math.max(0, this.now() - startedAt),
      ...(structured !== undefined ? { structured } : {}),
      ...(structuredValid !== undefined ? { structuredValid } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    return { ok: true, response };
  }

  private classifyHttp(status: number, rawText: string, model: string): LlmError {
    const snippet = rawText.replace(/\s+/g, ' ').slice(0, 300);
    const suffix = snippet.length > 0 ? `: ${snippet}` : '';
    const base = { provider: this.name, model, fingerprint: `${this.name}|${model}|${status}` };

    if (status === 401 || status === 403) {
      return {
        ...base,
        code: 'PROVIDER_UNAVAILABLE',
        message: `authentication/authorization failed (HTTP ${status})${suffix}`,
        retryable: false,
      };
    }
    if (status === 408) {
      return {
        ...base,
        code: 'TIMEOUT',
        message: `provider reported a timeout (HTTP 408)${suffix}`,
        retryable: true,
      };
    }
    if (status === 429) {
      return {
        ...base,
        code: 'RATE_LIMITED',
        message: `provider rate limited the request (HTTP 429)${suffix}`,
        retryable: true,
      };
    }
    if (status >= 500) {
      return {
        ...base,
        code: 'PROVIDER_UNAVAILABLE',
        message: `provider is unavailable (HTTP ${status})${suffix}`,
        retryable: true,
      };
    }
    if (status === 400 && /context|too many tokens|maximum.*token/i.test(snippet)) {
      return {
        ...base,
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: `request exceeds the model context window${suffix}`,
        retryable: false,
      };
    }
    return {
      ...base,
      code: 'INVALID_RESPONSE',
      message: `provider rejected the request (HTTP ${status})${suffix}`,
      retryable: false,
    };
  }

  private failure(
    code: LlmErrorCode,
    message: string,
    retryable: boolean,
    model?: string,
  ): LlmOutcome {
    return {
      ok: false,
      error: {
        code,
        provider: this.name,
        ...(model ? { model } : {}),
        message,
        retryable,
        fingerprint: `${code}|${this.name}|${model ?? 'default'}`,
      },
    };
  }

  private costOf(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * this.capabilities.costPerMInputUsd +
      (outputTokens / 1_000_000) * this.capabilities.costPerMOutputUsd
    );
  }
}

/**
 * Build a provider from environment variables. Returns `undefined` unless all
 * three required variables are present, so callers can opt in without
 * throwing during local/offline runs.
 *
 * - `BEHAVIOROS_LLM_BASE_URL` (e.g. `https://api.apinex.bond/v1`)
 * - `BEHAVIOROS_LLM_API_KEY`
 * - `BEHAVIOROS_LLM_MODEL` (e.g. `free/deepseek-v4.1-flash`)
 * - `BEHAVIOROS_LLM_NAME` (optional registry key)
 * - `BEHAVIOROS_LLM_TIMEOUT_MS` (optional)
 * - `BEHAVIOROS_LLM_JSON_MODE=0` (optional; disables `response_format`)
 */
export function openAICompatibleProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): OpenAICompatibleProvider | undefined {
  const baseUrl = env.BEHAVIOROS_LLM_BASE_URL?.trim();
  const apiKey = env.BEHAVIOROS_LLM_API_KEY?.trim();
  const model = env.BEHAVIOROS_LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;

  const rawTimeout = env.BEHAVIOROS_LLM_TIMEOUT_MS
    ? Number(env.BEHAVIOROS_LLM_TIMEOUT_MS)
    : undefined;
  const timeoutMs =
    typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout > 0
      ? rawTimeout
      : undefined;

  return new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    model,
    name: env.BEHAVIOROS_LLM_NAME?.trim() || 'openai-compatible',
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    jsonMode: env.BEHAVIOROS_LLM_JSON_MODE !== '0',
  });
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Resolve the global `fetch` without leaking DOM types into the module. */
function globalFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== 'function') {
    throw new Error(
      'OpenAICompatibleProvider requires a global fetch implementation or an explicit `fetchImpl`',
    );
  }
  const bound = (candidate as (url: string, init?: unknown) => Promise<unknown>).bind(globalThis);
  return async (url, init) => (await bound(url, init)) as HttpResponseLike;
}
