/**
 * Provider-telemetry persistence.
 *
 * Bridges the in-memory `LlmProviderRegistry` telemetry ring to the durable
 * key/value store that a `BehaviorOS` host already owns (`Store.setMeta` /
 * `Store.getMeta`) — the same channel `learning-records` uses (ADR-003: no
 * new SQLite table, no destructive migration).
 *
 * The orchestrator package stays persistence-agnostic: it does not import
 * `@behavior-os/core`'s `Store` type. Instead it exposes two pure helpers
 * (`persistLlmTelemetry`, `restoreLlmTelemetry`) that accept minimal
 * `SetMeta` / `GetMeta` interfaces, so any host (SQLite, Postgres, in-memory
 * plugin storage) can persist and restore the telemetry ring without the
 * orchestrator gaining a concrete-database dependency.
 */

import type { LlmTelemetryRecord } from './provider.js';

/** Minimal durable key/value writer. */
export interface LlmTelemetrySink {
  setMeta(key: string, value: string): void;
}

/** Minimal durable key/value reader. */
export interface LlmTelemetrySource {
  getMeta(key: string): string | null;
}

/** The `Store.meta` key under which the LLM telemetry ring is persisted. */
export const LLM_TELEMETRY_META_KEY = 'llm-telemetry';

/**
 * Persist the current telemetry ring to the durable store. The records are
 * JSON-serialized; a later process restores them with {@link restoreLlmTelemetry}.
 * Returns the number of records persisted.
 */
export function persistLlmTelemetry(
  sink: LlmTelemetrySink,
  records: LlmTelemetryRecord[],
  key: string = LLM_TELEMETRY_META_KEY,
): number {
  sink.setMeta(key, JSON.stringify(records));
  return records.length;
}

/**
 * Restore a previously persisted telemetry ring into a `LlmProviderRegistry`
 * (or any object with `restoreTelemetry`). Malformed / missing data is a
 * no-op (the registry stays empty) — persistence is best-effort and must
 * never crash the host on startup.
 */
export function restoreLlmTelemetry(
  source: LlmTelemetrySource,
  target: { restoreTelemetry(records: LlmTelemetryRecord[]): void },
  key: string = LLM_TELEMETRY_META_KEY,
): number {
  const raw = source.getMeta(key);
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const records = parsed.filter((entry): entry is LlmTelemetryRecord => {
    if (entry === null || typeof entry !== 'object') return false;
    const record = entry as Partial<LlmTelemetryRecord>;
    return (
      typeof record.requestId === 'string' &&
      typeof record.provider === 'string' &&
      typeof record.model === 'string' &&
      typeof record.routingReason === 'string' &&
      typeof record.at === 'string' &&
      typeof record.ok === 'boolean' &&
      isFiniteNumber(record.inputTokens) &&
      isFiniteNumber(record.outputTokens) &&
      isFiniteNumber(record.costUsd) &&
      isFiniteNumber(record.latencyMs)
    );
  });
  target.restoreTelemetry(records);
  return records.length;
}
