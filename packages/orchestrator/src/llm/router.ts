/**
 * LLM model router.
 *
 * Deterministically selects a provider + model for a request given capability
 * requirements, provider health, cost and latency policies. Produces a
 * `LlmRoutingDecision` record — it never mutates governance state and never
 * bypasses the pipeline preflight (ADR-004). The router performs at most one
 * fallback hop per request (a second hop would risk a run-around that the
 * orchestrator's own bounded retries already cap).
 *
 * Fallback + loop detection: if a requested provider fails with a retryable
 * classified error, the router picks the next eligible provider by the
 * deterministic cost → latency ranking, records the routing decision, and
 * hands the fallback provider to the caller. Repeated failures across
 * requests surface through the registry's health state (`degraded` /
 * `unavailable`), so a sick provider is progressively excluded rather than
 * retried forever.
 */

import type { LlmOutcome, LlmProvider, LlmRequest } from './provider.js';
import type { LlmProviderRegistry } from './registry.js';

export interface LlmRoutingDecision {
  /** Provider actually used (or attempted, on the fallback path). */
  provider: string;
  model?: string;
  /** Why this provider was chosen: `pinned`, `capability`, `cost`,
   *  `latency`, or `fallback:<original>`. */
  reason: string;
  /** The original provider that was tried and failed, when this is a
   *  fallback decision. */
  fallbackFrom?: string;
  /** The full ordered candidate list considered (for observability). */
  candidates: string[];
  /** Deterministic timestamp. */
  at: string;
}

export interface LlmRouteResult {
  outcome: LlmOutcome;
  decision: LlmRoutingDecision;
}

export interface LlmRouterOptions {
  /** Injectable clock (for deterministic tests). */
  now?: () => string;
}

/**
 * Deterministic, health-aware, bounded-fallback LLM router.
 *
 * Selection order:
 * 1. If the request pins a provider (`request.provider`), use it if it is
 *    registered and routeable; otherwise fall through.
 * 2. Otherwise rank all routeable, capability-matching providers by
 *    (costPerMInputUsd, costPerMOutputUsd, baselineLatencyMs, name) —
 *    cheapest + fastest + alphabetically stable — and take the first.
 *
 * On a classified retryable failure of the primary provider, try exactly one
 * fallback: the next provider in the same ranking (skipping any that the
 * registry has marked unavailable). Non-retryable failures are returned as-is
 * with no fallback (they are request-specific, not provider-health problems).
 */
export class LlmRouter {
  private readonly registry: LlmProviderRegistry;
  private readonly now: () => string;

  constructor(registry: LlmProviderRegistry, options: LlmRouterOptions = {}) {
    this.registry = registry;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Route one request. Returns the classified outcome (success or failure)
   * plus the routing decision that produced it. At most one fallback hop.
   */
  async route(request: LlmRequest): Promise<LlmRouteResult> {
    const ranked = this.rank(request);
    if (ranked.length === 0) {
      return {
        outcome: {
          ok: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            provider: request.provider ?? '(none)',
            message: 'No routeable provider satisfies the required capabilities or health state',
            retryable: false,
          },
        },
        decision: {
          provider: request.provider ?? '(none)',
          reason: 'no-candidates',
          candidates: [],
          at: this.now(),
        },
      };
    }

    const candidates = ranked.map((provider) => provider.name);
    let primary: LlmProvider;
    let decision: LlmRoutingDecision;

    if (request.provider) {
      const pinnedIndex = ranked.findIndex((provider) => provider.name === request.provider);
      if (pinnedIndex >= 0) {
        // Pinned and routeable: try it first.
        primary = ranked[pinnedIndex];
        decision = {
          provider: primary.name,
          reason: 'pinned',
          candidates,
          at: this.now(),
        };
      } else {
        // Pinned provider is unknown or not routeable: use the cheapest
        // eligible provider and record this as a fallback from the pinned name.
        primary = ranked[0];
        decision = {
          provider: primary.name,
          fallbackFrom: request.provider,
          reason: `fallback:${request.provider}`,
          candidates,
          at: this.now(),
        };
      }
    } else {
      primary = ranked[0];
      decision = {
        provider: primary.name,
        reason: 'capability+cost+latency',
        candidates,
        at: this.now(),
      };
    }

    const primaryOutcome = await this.attempt(primary, request, decision.reason);
    if (primaryOutcome.ok) {
      return { outcome: primaryOutcome, decision };
    }

    const error = primaryOutcome.error;
    if (!error.retryable) {
      // Non-retryable: request-specific failure, not provider health — no
      // fallback (the orchestrator's bounded retries already cap attempts).
      return { outcome: primaryOutcome, decision };
    }

    // Bounded fallback: exactly one hop to the cheapest *other* routeable
    // provider (deterministic cost → latency ranking, excluding the primary).
    const fallback = ranked.find((provider) => provider.name !== primary.name);
    if (fallback) {
      const fallbackDecision: LlmRoutingDecision = {
        provider: fallback.name,
        fallbackFrom: primary.name,
        reason: `fallback:${primary.name} (${error.code})`,
        candidates,
        at: this.now(),
      };
      const fallbackOutcome = await this.attempt(fallback, request, fallbackDecision.reason);
      return { outcome: fallbackOutcome, decision: fallbackDecision };
    }

    return { outcome: primaryOutcome, decision };
  }

  private async attempt(
    provider: LlmProvider,
    request: LlmRequest,
    routingReason: string,
  ): Promise<LlmOutcome> {
    let outcome: LlmOutcome;
    try {
      outcome = await provider.complete(request);
    } catch (error) {
      // A provider that throws violates the contract ("never throws an
      // unclassified error"). Contain it here so one misbehaving provider
      // cannot disable the bounded-fallback guarantee.
      outcome = {
        ok: false,
        error: {
          code: 'INVALID_RESPONSE',
          provider: provider.name,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          fingerprint: `INVALID_RESPONSE|${provider.name}|threw`,
        },
      };
    }
    if (outcome.ok) {
      this.registry.recordHealth(provider.name, true);
      this.registry.recordTelemetry({
        requestId: request.requestId,
        provider: provider.name,
        model: outcome.response.model,
        routingReason,
        ok: true,
        inputTokens: outcome.response.usage.inputTokens,
        outputTokens: outcome.response.usage.outputTokens,
        costUsd: outcome.response.costUsd,
        latencyMs: outcome.response.latencyMs,
        at: this.now(),
      });
      return outcome;
    }
    this.registry.recordHealth(provider.name, false, outcome.error.code);
    this.registry.recordTelemetry({
      requestId: request.requestId,
      provider: provider.name,
      model: outcome.error.model ?? provider.name,
      routingReason,
      ok: false,
      errorCode: outcome.error.code,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      at: this.now(),
    });
    return outcome;
  }

  /**
   * Deterministic ranking: filter to routeable + capability-matching providers,
   * then sort by (input cost, output cost, baseline latency, name) so equal
   * profiles resolve alphabetically and the result is reproducible.
   */
  private rank(request: LlmRequest): LlmProvider[] {
    // A declared response schema is a hard requirement for structured output;
    // never route it to a provider that cannot satisfy it.
    const tags = new Set(request.capabilityTags ?? []);
    if (request.responseSchema) tags.add('structuredOutput');
    const providers = this.registry.routeable([...tags]);
    const contextBudget = request.contextBudgetTokens;
    const eligible = providers.filter((provider) => {
      // A provider that reports itself unavailable is not a candidate; health
      // state only accumulates afterwards.
      if (!provider.isAvailable()) return false;
      if (contextBudget !== undefined && provider.capabilities.contextWindow < contextBudget) {
        return false;
      }
      return true;
    });
    return eligible.sort((a, b) => {
      const byInputCost = a.capabilities.costPerMInputUsd - b.capabilities.costPerMInputUsd;
      if (byInputCost !== 0) return byInputCost;
      const byOutputCost = a.capabilities.costPerMOutputUsd - b.capabilities.costPerMOutputUsd;
      if (byOutputCost !== 0) return byOutputCost;
      const byLatency = a.capabilities.baselineLatencyMs - b.capabilities.baselineLatencyMs;
      if (byLatency !== 0) return byLatency;
      return a.name.localeCompare(b.name);
    });
  }

  /** Read-only access for observability. */
  getRegistry(): LlmProviderRegistry {
    return this.registry;
  }
}
