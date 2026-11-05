/**
 * LLM task adapter.
 *
 * A `TaskAdapter` named `llm` that routes one task's reasoning through the
 * LLM gateway (registry + router + context builder) and returns an
 * `AdapterResult` shaped exactly like the shell adapter's. The task's
 * existing acceptance criteria (exit-code / stdout-contains /
 * stdout-matches / stderr-not-contains) apply unchanged — the LLM's output is
 * data, not authority (ADR-004, ADR-005).
 *
 * Governance, evidence, retries, timeouts, circuit breakers and idempotency
 * are all inherited from the orchestrator's dispatch loop; this adapter adds
 * no new execution path.
 *
 * Input shape (passed as `task.input`):
 * {
 *   prompt?: string,              // explicit prompt (overrides context build)
 *   capabilityTags?: string[],    // e.g. ["structuredOutput"]
 *   contextSources?: {            // assembled by the context builder when no
 *     mission?: Mission,          // explicit `prompt` is supplied
 *     taskObjective?: string,
 *     acceptanceGates?: string[],
 *     evidence?: MissionEvidence[],
 *     dna?: DNA,
 *     history?: string[],
 *   },
 *   responseSchema?: LlmResponseSchema,
 *   provider?: string,            // pin a provider (bypasses routing)
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   contextBudgetTokens?: number,
 *   costBudgetUsd?: number,
 * }
 */

import type { AdapterResult, DNA, Mission, MissionEvidence } from '@behavior-os/schemas';
import type { AdapterExecutionContext, TaskAdapter } from '../adapters.js';
import { LlmContextBuilder, type LlmContextSources } from './context-builder.js';
import type { LlmResponseSchema } from './provider.js';
import { DeterministicLlmProvider, type LlmProvider } from './provider.js';
import { LlmProviderRegistry } from './registry.js';
import { LlmRouter } from './router.js';

export interface LlmAdapterInput {
  prompt?: string;
  capabilityTags?: string[];
  contextSources?: LlmContextSources;
  responseSchema?: LlmResponseSchema;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  contextBudgetTokens?: number;
  costBudgetUsd?: number;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : undefined;
}

/** Duck-type check for the `LlmSchemaParser` contract. */
function isSchemaParser(value: unknown): value is LlmResponseSchema {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  );
}

/**
 * The `llm` TaskAdapter. Construct with the registry/router/context-builder
 * the orchestrator wants to use; a bare `new LlmTaskAdapter()` wires up a
 * default deterministic provider (handy for tests and as the out-of-the-box
 * capability).
 */
export class LlmTaskAdapter implements TaskAdapter {
  readonly name = 'llm';
  private readonly registry: LlmProviderRegistry;
  private readonly router: LlmRouter;
  private readonly contextBuilder: LlmContextBuilder;

  constructor(
    options: {
      registry?: LlmProviderRegistry;
      router?: LlmRouter;
      contextBuilder?: LlmContextBuilder;
      /** Providers to seed into the registry (in addition to any existing
       *  entries). When omitted, a default `DeterministicLlmProvider` named
       *  `deterministic` is registered so the adapter is usable out of the box. */
      providers?: LlmProvider[];
    } = {},
  ) {
    this.registry = options.registry ?? new LlmProviderRegistry();
    const providers = options.providers ?? [new DeterministicLlmProvider()];
    for (const provider of providers) {
      if (!this.registry.get(provider.name)) {
        this.registry.register(provider);
      }
    }
    this.router = options.router ?? new LlmRouter(this.registry);
    this.contextBuilder = options.contextBuilder ?? new LlmContextBuilder();
  }

  getRegistry(): LlmProviderRegistry {
    return this.registry;
  }

  getRouter(): LlmRouter {
    return this.router;
  }

  async execute(
    rawInput: Record<string, unknown>,
    context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    const input = this.parseInput(rawInput);

    // A declared-but-invalid schema is a caller error, never a silent pass.
    if (rawInput.responseSchema !== undefined && input.responseSchema === undefined) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'llm:SCHEMA_MISMATCH:responseSchema is not a valid schema parser',
        metadata: {
          llm: {
            errorCode: 'SCHEMA_MISMATCH',
            retryable: false,
            executionId: context.idempotencyKey,
          },
        },
      };
    }

    // Build the prompt: explicit `prompt` wins; otherwise assemble from the
    // governed context sources (mission, task, evidence, DNA, history).
    let prompt = input.prompt;
    let contextSources: LlmContextSources | undefined;
    if (prompt === undefined) {
      contextSources = this.extractContextSources(rawInput);
      const built = this.contextBuilder.build(contextSources ?? {});
      prompt = built.prompt;
    }

    const request = {
      requestId: `${context.taskId}:${context.attempt}:${context.idempotencyKey}`,
      prompt,
      capabilityTags: input.capabilityTags,
      responseSchema: input.responseSchema,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      contextBudgetTokens: input.contextBudgetTokens,
      model: input.model,
      provider: input.provider,
      signal: context.signal,
      timeoutMs: context.timeoutMs,
      costBudgetUsd: input.costBudgetUsd,
    };

    const { outcome, decision } = await this.router.route(request);

    if (!outcome.ok) {
      const error = outcome.error;
      // A classified LLM failure is a task failure, not a silent success.
      // exitCode 1 + stderr carrying the code keeps the orchestrator's
      // existing retry / circuit-breaker / evidence semantics intact.
      return {
        exitCode: 1,
        stdout: '',
        stderr: `llm:${error.code}:${error.message}`,
        metadata: {
          llm: {
            provider: error.provider,
            model: error.model,
            routing: decision.reason,
            fallbackFrom: decision.fallbackFrom,
            errorCode: error.code,
            retryable: error.retryable,
            executionId: context.idempotencyKey,
          },
        },
      };
    }

    const response = outcome.response;

    // Structured output: if a schema was declared, it MUST have validated.
    // `structuredValid === undefined` means the selected provider could not
    // enforce the schema (e.g. it does not advertise structuredOutput); that
    // is a mismatch, not a success.
    let stdout = response.content;
    if (input.responseSchema && response.structuredValid !== true) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          'llm:SCHEMA_MISMATCH:structured output did not validate against the declared schema',
        metadata: {
          llm: {
            provider: response.provider,
            model: response.model,
            routing: decision.reason,
            fallbackFrom: decision.fallbackFrom,
            errorCode: 'SCHEMA_MISMATCH',
            executionId: context.idempotencyKey,
          },
        },
      };
    }
    if (input.responseSchema && response.structured !== undefined) {
      stdout = JSON.stringify(response.structured);
    }

    return {
      exitCode: 0,
      stdout,
      stderr: '',
      metadata: {
        llm: {
          provider: response.provider,
          model: response.model,
          routing: decision.reason,
          ...(decision.fallbackFrom ? { fallbackFrom: decision.fallbackFrom } : {}),
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.costUsd,
          latencyMs: response.latencyMs,
          structured: response.structured,
          executionId: context.idempotencyKey,
        },
      },
    };
  }

  private parseInput(raw: Record<string, unknown>): LlmAdapterInput {
    return {
      prompt: readString(raw.prompt),
      capabilityTags: readStringArray(raw.capabilityTags),
      responseSchema: isSchemaParser(raw.responseSchema) ? raw.responseSchema : undefined,
      provider: readString(raw.provider),
      model: readString(raw.model),
      temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
      maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
      contextBudgetTokens:
        typeof raw.contextBudgetTokens === 'number' ? raw.contextBudgetTokens : undefined,
      costBudgetUsd: typeof raw.costBudgetUsd === 'number' ? raw.costBudgetUsd : undefined,
    };
  }

  private extractContextSources(raw: Record<string, unknown>): LlmContextSources | undefined {
    const sources = raw.contextSources;
    if (sources === undefined || sources === null) return undefined;
    if (typeof sources !== 'object' || Array.isArray(sources)) return undefined;
    const record = sources as Record<string, unknown>;
    return {
      mission: record.mission as Mission | undefined,
      taskObjective: readString(record.taskObjective),
      acceptanceGates: readStringArray(record.acceptanceGates),
      evidence: record.evidence as MissionEvidence[] | undefined,
      dna: record.dna as DNA | undefined,
      history: readStringArray(record.history),
    };
  }
}
