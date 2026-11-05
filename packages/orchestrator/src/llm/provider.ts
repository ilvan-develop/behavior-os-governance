/**
 * Universal LLM provider contract for the Behavior-OS hybrid orchestrator.
 *
 * A provider is the *only* thing that talks to a model (or a deterministic
 * stand-in). The rest of the orchestrator — router, context builder, adapter,
 * control loop — is model-independent: it only sees `LlmRequest` and
 * `LlmResponse`. This is what makes providers interchangeable without touching
 * governance or execution logic (ADR-004: LLM output is data, not authority).
 *
 * Provider implementations must classify their own failures into
 * `LlmErrorCode` values instead of throwing unclassified errors, so the router
 * can make deterministic fallback decisions (ADR-002: deterministic local
 * providers ship first; vendor adapters are BLOCKED until real credentials
 * exist).
 */

import type { LlmSchemaParser } from './schema.js';

/** Structured-output contract: a parser a provider must satisfy. */
export type LlmResponseSchema = LlmSchemaParser;

/** Capability flags a provider advertises. */
export interface LlmProviderCapabilities {
  /** Free-form chat completion. */
  chat: boolean;
  /** Structured (schema-constrained) output. */
  structuredOutput: boolean;
  /** JSON-object output (looser than structuredOutput). */
  json: boolean;
  /** Approximate context window in tokens. */
  contextWindow: number;
  /** Approximate cost per 1M input tokens, USD (0 = free/local). */
  costPerMInputUsd: number;
  /** Approximate cost per 1M output tokens, USD (0 = free/local). */
  costPerMOutputUsd: number;
  /** Approximate p50 latency in ms. */
  baselineLatencyMs: number;
}

/**
 * The normalized, provider-agnostic request the router builds and every
 * provider receives. Keep this shape stable: it is the interchange contract.
 */
export interface LlmRequest {
  /** Stable id for this request attempt (used in telemetry + evidence). */
  requestId: string;
  /** Free-form prompt / messages. */
  prompt: string;
  /** Capability tags the caller needs (e.g. ["chat"], ["structuredOutput"]). */
  capabilityTags?: string[];
  /** Declared structured-output schema, when `structuredOutput` is required. */
  responseSchema?: LlmResponseSchema;
  /** Sampling temperature. */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxTokens?: number;
  /** Caller-supplied context budget (tokens) for the context builder. */
  contextBudgetTokens?: number;
  /** Model pin; omit to let the router choose. */
  model?: string;
  /** Provider pin; omit to let the router choose. */
  provider?: string;
  /** Bounded execution deadline. */
  timeoutMs?: number;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Cost budget for this single request, USD (optional). */
  costBudgetUsd?: number;
}

/** Usage accounting returned by every provider (even deterministic ones). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The normalized, provider-agnostic response. */
export interface LlmResponse {
  requestId: string;
  /** Provider that produced this response. */
  provider: string;
  /** Model name reported by the provider. */
  model: string;
  /** Free-form content (text). */
  content: string;
  /** Parsed structured output, when a schema was declared and it validated. */
  structured?: unknown;
  /** Whether `structured` was produced and validated against the request's
   *  declared schema. Absent when no schema was declared. */
  structuredValid?: boolean;
  usage: LlmUsage;
  /** Total cost for this request, USD. */
  costUsd: number;
  /** Wall-clock latency, ms. */
  latencyMs: number;
  /** Whether the provider classified any non-fatal issue (e.g. truncated). */
  warnings?: string[];
}

/**
 * Classified LLM failure. `retryable` tells the router whether a fallback hop
 * is worth trying; the orchestrator's bounded `maxAttempts` still applies on
 * top of that (the router never amplifies retries on its own).
 */
export interface LlmError {
  code: LlmErrorCode;
  provider: string;
  model?: string;
  message: string;
  retryable: boolean;
  /** Deterministic signature for repeated-failure / loop detection. */
  fingerprint?: string;
}

/** Discriminated result of a provider call: success or classified failure. */
export type LlmOutcome = { ok: true; response: LlmResponse } | { ok: false; error: LlmError };

/**
 * Universal provider contract.
 *
 * - `isAvailable()` is a cheap, synchronous health probe (no I/O required).
 * - `complete()` is the only execution path; it must honor `request.signal`
 *   and classify every failure into an `LlmErrorCode` — never throw an
 *   unclassified error.
 * - Providers must not call governance, must not mutate mission state, and
 *   must not persist anything themselves; the orchestrator records evidence
 *   and telemetry (ADR-004, ADR-005).
 */
export interface LlmProvider {
  /** Stable provider name (registry key). */
  readonly name: string;
  /** Capability + cost/latency profile. */
  readonly capabilities: LlmProviderCapabilities;
  /** Cheap availability probe. */
  isAvailable(): boolean;
  /** Execute one request; returns a classified outcome, never throws. */
  complete(request: LlmRequest): Promise<LlmOutcome>;
}

/**
 * Telemetry record appended by the router/adapter for every request, persisted
 * via the existing `Store.setMeta('llm-telemetry')` channel (ADR-003: no new
 * SQLite table).
 */
export interface LlmTelemetryRecord {
  requestId: string;
  provider: string;
  model: string;
  /** Routing decision that selected this provider. */
  routingReason: string;
  ok: boolean;
  errorCode?: LlmErrorCode;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  /** When this record was created. */
  at: string;
  /** Execution id tying this record back to a task attempt, when available. */
  executionId?: string;
}

/** All provider-side failure classes the router can reason about. */
export const LLM_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
  'INVALID_RESPONSE',
  'SCHEMA_MISMATCH',
  'COST_BUDGET_EXCEEDED',
  'CONTEXT_WINDOW_EXCEEDED',
  'CANCELLED',
] as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

/** Which error codes are safe to retry with a *different* provider (fallback). */
export const RETRYABLE_LLM_ERRORS: ReadonlySet<LlmErrorCode> = new Set([
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'RATE_LIMITED',
]);

/**
 * Deterministic, I/O-free provider used to prove the universal contract
 * WITHOUT credentials (ADR-002). A configurable `respond` function decides
 * what to return; token counting is a simple, stable approximation so
 * `usage`/`costUsd` are meaningful and testable.
 */
export class DeterministicLlmProvider implements LlmProvider {
  readonly name: string;
  readonly capabilities: LlmProviderCapabilities;
  private readonly respond: (request: LlmRequest) => LlmResponse | LlmError;
  private available = true;

  constructor(
    options: {
      name?: string;
      model?: string;
      capabilities?: Partial<LlmProviderCapabilities>;
      /**
       * Pure response function. Return an `LlmResponse` on success, or an
       * `LlmError` to simulate a classified failure (used by scenario B).
       */
      respond?: (request: LlmRequest) => LlmResponse | LlmError;
      available?: boolean;
    } = {},
  ) {
    this.name = options.name ?? 'deterministic';
    this.capabilities = {
      chat: true,
      structuredOutput: true,
      json: true,
      contextWindow: 32_000,
      costPerMInputUsd: 0,
      costPerMOutputUsd: 0,
      baselineLatencyMs: 1,
      ...options.capabilities,
    };
    this.available = options.available ?? true;
    const defaultModel = options.model ?? `${this.name}-v1`;
    const userRespond = options.respond;
    this.respond = userRespond
      ? userRespond
      : (request: LlmRequest): LlmResponse | LlmError => {
          const content = `[${this.name}] ${request.prompt}`;
          return this.successResponse(request, defaultModel, content);
        };
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** Test seam: flip availability without rebuilding the provider. */
  setAvailable(value: boolean): void {
    this.available = value;
  }

  async complete(request: LlmRequest): Promise<LlmOutcome> {
    if (!this.isAvailable()) {
      return {
        ok: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          provider: this.name,
          message: `Provider "${this.name}" is unavailable`,
          retryable: true,
          fingerprint: `PROVIDER_UNAVAILABLE|${this.name}`,
        },
      };
    }
    if (request.signal?.aborted) {
      return {
        ok: false,
        error: {
          code: 'CANCELLED',
          provider: this.name,
          message: 'Request cancelled before execution',
          retryable: false,
        },
      };
    }
    const startedAt = Date.now();
    const result = this.respond(request);
    if ('code' in result) {
      return { ok: false, error: { ...result, provider: this.name } };
    }
    result.latencyMs = Math.max(0, Date.now() - startedAt);

    // If a structured-output schema was declared but the response did not
    // already carry validated structured output, parse it now. This keeps the
    // contract uniform regardless of which `respond` implementation produced
    // the response.
    if (
      request.responseSchema &&
      this.capabilities.structuredOutput &&
      result.structuredValid === undefined
    ) {
      const parsed = request.responseSchema.safeParse(result.content);
      result.structured = parsed.success ? parsed.data : result.content;
      result.structuredValid = parsed.success;
      if (!parsed.success) {
        result.warnings = [
          ...(result.warnings ?? []),
          'structured output did not validate against the declared schema',
        ];
      }
    }

    return { ok: true, response: result };
  }

  /** Build a well-formed success response with consistent usage/cost. */
  private successResponse(request: LlmRequest, model: string, content: string): LlmResponse {
    const inputTokens = this.estimateTokens(request.prompt);
    const outputTokens = this.estimateTokens(content);
    const costUsd =
      (inputTokens / 1_000_000) * this.capabilities.costPerMInputUsd +
      (outputTokens / 1_000_000) * this.capabilities.costPerMOutputUsd;

    let structured: unknown;
    let structuredValid: boolean | undefined;
    if (request.responseSchema && this.capabilities.structuredOutput) {
      const parsed = request.responseSchema.safeParse(content);
      structured = parsed.success ? parsed.data : content;
      structuredValid = parsed.success;
      if (!parsed.success) {
        return {
          requestId: request.requestId,
          provider: this.name,
          model,
          content,
          structured,
          structuredValid: false,
          usage: { inputTokens, outputTokens },
          costUsd,
          latencyMs: 0,
          warnings: ['structured output did not validate against the declared schema'],
        };
      }
    }

    return {
      requestId: request.requestId,
      provider: this.name,
      model,
      content,
      ...(structured !== undefined ? { structured } : {}),
      ...(structuredValid !== undefined ? { structuredValid } : {}),
      usage: { inputTokens, outputTokens },
      costUsd,
      latencyMs: 0,
    };
  }

  /** Stable, cheap token estimate (~4 chars/token) used for budgeting/cost. */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
