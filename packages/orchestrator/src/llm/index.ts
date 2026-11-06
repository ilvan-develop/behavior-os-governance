/**
 * LLM gateway for the Behavior-OS hybrid orchestrator.
 *
 * Re-exports the universal provider contract, the registry, the router, the
 * context builder and the governed `llm` TaskAdapter. Import everything from
 * this single module so the orchestrator's public surface stays one file.
 *
 * This module is model-independent (ADR-001): it lives in the orchestrator
 * package, not in core, so the governance kernel never gains a dependency on
 * provider SDKs.
 */

export type { LlmAdapterInput } from './adapter.js';
export { LlmTaskAdapter } from './adapter.js';
export type {
  LlmContextBuilderOptions,
  LlmContextBuildResult,
  LlmContextSources,
} from './context-builder.js';
export { LlmContextBuilder } from './context-builder.js';
export type {
  FetchLike,
  HttpRequestInitLike,
  HttpResponseLike,
  OpenAICompatibleProviderConfig,
} from './openai-compatible-provider.js';
export {
  OpenAICompatibleProvider,
  openAICompatibleProviderFromEnv,
} from './openai-compatible-provider.js';
export type {
  LlmError,
  LlmErrorCode,
  LlmOutcome,
  LlmProvider,
  LlmProviderCapabilities,
  LlmRequest,
  LlmResponse,
  LlmResponseSchema,
  LlmTelemetryRecord,
  LlmUsage,
} from './provider.js';
export {
  DeterministicLlmProvider,
  LLM_ERROR_CODES,
  RETRYABLE_LLM_ERRORS,
} from './provider.js';
export type { ProviderHealth, RegistrySnapshot } from './registry.js';
export { LlmProviderRegistry } from './registry.js';
export type { LlmRouteResult, LlmRoutingDecision } from './router.js';
export { LlmRouter } from './router.js';
export type { LlmTelemetrySink, LlmTelemetrySource } from './telemetry.js';
export {
  LLM_TELEMETRY_META_KEY,
  persistLlmTelemetry,
  restoreLlmTelemetry,
} from './telemetry.js';
