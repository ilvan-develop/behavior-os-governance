/**
 * LLM provider registry.
 *
 * Holds the registered providers, their capabilities, their health state,
 * and the in-memory telemetry ring that gets persisted via the existing
 * `Store.setMeta('llm-telemetry')` channel (ADR-003: no new SQLite table).
 *
 * The registry is deliberately deterministic and side-effect free: it
 * records, it does not call providers. Selection policy lives in the router.
 */

import {
  LLM_ERROR_CODES,
  type LlmProvider,
  type LlmTelemetryRecord,
  RETRYABLE_LLM_ERRORS,
} from './provider.js';

export interface ProviderHealth {
  state: 'healthy' | 'degraded' | 'unavailable';
  /** Number of consecutive classified failures. */
  consecutiveFailures: number;
  /** Timestamp of the last state change. */
  lastChangedAt: string;
  /** Last classified error, when degraded/unavailable. */
  lastErrorCode?: string;
}

export interface RegistrySnapshot {
  providers: Array<{
    name: string;
    model?: string;
    capabilities: LlmProvider['capabilities'];
  }>;
  health: Record<string, ProviderHealth>;
  /** Most recent telemetry records, newest last. */
  telemetry: LlmTelemetryRecord[];
}

/**
 * In-memory provider registry + health + telemetry.
 *
 * - `register` adds or replaces a provider by name.
 * - `recordHealth` is called by the router/adapter after each request and
 *   transitions `healthy → degraded → unavailable` based on the classified
 *   error. Unavailable providers are excluded from routing but remain
 *   registered so a later `setAvailable`/re-register can restore them.
 * - `recordTelemetry` appends to a bounded ring (default 200) so long
 *   sessions stay bounded; `telemetrySnapshot()` returns a copy for
 *   persistence via `Store.setMeta`.
 */
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  private readonly health = new Map<string, ProviderHealth>();
  private readonly telemetry: LlmTelemetryRecord[] = [];
  private readonly telemetryLimit: number;

  constructor(options: { telemetryLimit?: number } = {}) {
    this.telemetryLimit = Math.max(1, options.telemetryLimit ?? 200);
  }

  register(provider: LlmProvider): void {
    if (!provider.name || provider.name.trim().length === 0) {
      throw new Error('LlmProviderRegistry.register: provider requires a non-empty name');
    }
    this.providers.set(provider.name, provider);
    this.health.set(provider.name, {
      state: 'healthy',
      consecutiveFailures: 0,
      lastChangedAt: new Date().toISOString(),
    });
  }

  get(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  /** All providers, in registration order (stable). */
  list(): LlmProvider[] {
    return [...this.providers.values()];
  }

  /** Providers eligible for routing given a set of required capability tags. */
  capable(requiredTags: string[] = []): LlmProvider[] {
    const tags = new Set(requiredTags);
    if (tags.size === 0) return this.list();
    // Capability tags are *requirements*: a provider must advertise every
    // requested capability, not merely one of them.
    return this.list().filter((provider) => {
      const advertised = new Set(this.providerTags(provider));
      return [...tags].every((tag) => advertised.has(tag));
    });
  }

  /** Capability tags derived from a provider's advertised profile. */
  providerTags(provider: LlmProvider): string[] {
    const tags: string[] = [];
    if (provider.capabilities.chat) tags.push('chat');
    if (provider.capabilities.structuredOutput) tags.push('structuredOutput');
    if (provider.capabilities.json) tags.push('json');
    return tags;
  }

  healthOf(name: string): ProviderHealth {
    return (
      this.health.get(name) ?? {
        state: 'healthy',
        consecutiveFailures: 0,
        lastChangedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Update health after a request. Retriable classified errors increment the
   * consecutive-failure counter; after 2 consecutive failures the provider is
   * `degraded`, after 4 it is `unavailable` (excluded from routing until a
   * success resets the counter). A success always resets to `healthy`.
   */
  recordHealth(name: string, ok: boolean, errorCode?: string): void {
    const current = this.healthOf(name);
    let state: ProviderHealth['state'];
    let consecutiveFailures: number;

    if (ok) {
      state = 'healthy';
      consecutiveFailures = 0;
    } else {
      const codeIsKnown =
        errorCode !== undefined && (LLM_ERROR_CODES as readonly string[]).includes(errorCode);
      const isRetryable =
        codeIsKnown && RETRYABLE_LLM_ERRORS.has(errorCode as (typeof LLM_ERROR_CODES)[number]);
      if (codeIsKnown && !isRetryable) {
        // Non-retryable failures (schema mismatch, cost, context window,
        // cancelled) are request-specific, not provider-health problems. They
        // must not accumulate into the provider's consecutive-failure counter,
        // otherwise repeated bad requests would eventually mark a healthy
        // provider unavailable.
        state = current.state;
        consecutiveFailures = current.consecutiveFailures;
      } else {
        consecutiveFailures = current.consecutiveFailures + 1;
        if (consecutiveFailures >= 4) {
          state = 'unavailable';
        } else if (consecutiveFailures >= 2) {
          state = 'degraded';
        } else {
          state = 'healthy';
        }
      }
    }

    if (state !== current.state || consecutiveFailures !== current.consecutiveFailures) {
      this.health.set(name, {
        state,
        consecutiveFailures,
        lastChangedAt: new Date().toISOString(),
        ...(state !== 'healthy' && errorCode ? { lastErrorCode: errorCode } : {}),
      });
    }
  }

  /** Providers that can currently be routed to (healthy or degraded). */
  routeable(requiredTags: string[] = []): LlmProvider[] {
    const eligible = this.capable(requiredTags);
    return eligible.filter((provider) => {
      const health = this.healthOf(provider.name);
      return health.state !== 'unavailable';
    });
  }

  recordTelemetry(record: LlmTelemetryRecord): void {
    this.telemetry.push(record);
    if (this.telemetry.length > this.telemetryLimit) {
      this.telemetry.splice(0, this.telemetry.length - this.telemetryLimit);
    }
  }

  /** A copy of the current telemetry ring, for persistence via `setMeta`. */
  telemetrySnapshot(): LlmTelemetryRecord[] {
    return [...this.telemetry];
  }

  /** Restore a previously persisted telemetry ring (e.g. after a restart). */
  restoreTelemetry(records: LlmTelemetryRecord[]): void {
    this.telemetry.splice(0, this.telemetry.length, ...records.slice(-this.telemetryLimit));
  }

  snapshot(): RegistrySnapshot {
    return {
      providers: this.list().map((provider) => ({
        name: provider.name,
        capabilities: provider.capabilities,
      })),
      health: Object.fromEntries(
        [...this.health.entries()].map(([name, value]) => [name, { ...value }]),
      ),
      telemetry: this.telemetrySnapshot(),
    };
  }
}
