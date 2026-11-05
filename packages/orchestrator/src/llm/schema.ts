/**
 * Minimal structural type for a structured-output parser, so the orchestrator
 * does not gain a direct dependency on `zod` (ADR-001: keep the orchestrator
 * dependency-light). Any object with a `safeParse(value)` method that returns
 * a Zod-style success/failure result satisfies this — callers pass their own
 * Zod schema (or an equivalent) at the call site.
 *
 * The `LlmTaskAdapter.input.responseSchema` is typed as `LlmSchemaParser` so
 * the adapter stays agnostic of the concrete schema library while still
 * requiring a real, working parser (not a string hint).
 */

export interface LlmSchemaParseResult {
  success: boolean;
  /** Present when `success` is true. */
  data?: unknown;
  /** Present when `success` is false. */
  error?: unknown;
}

/**
 * A runtime parser for structured LLM output. Structurally compatible with
 * `zod`'s `ZodType` (its `safeParse` returns a `ZodSafeParseResult`), and
 * with any custom parser that exposes the same shape.
 */
export interface LlmSchemaParser {
  safeParse(value: unknown): LlmSchemaParseResult;
}
