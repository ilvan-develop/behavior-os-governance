/** Default ceiling: 300 calls per tool per minute (5/s average). */ export const DEFAULT_RATE_LIMIT_MAX_CALLS = 300;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimitConfig {
  /** Bucket capacity and number of calls allowed per `windowMs`. */
  maxCalls: number;
  /** Refill window in milliseconds. */
  windowMs: number;
  /** When true, `check()` always allows the call. */
  disabled: boolean;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Configured bucket capacity. */
  limit: number;
  /** Whole calls left in the bucket after this decision. */
  remaining: number;
  /** Milliseconds until one token is available; 0 when allowed. */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-tool token bucket.
 *
 * MCP runs over stdio in a single process, so the bucket is intentionally
 * in-process: it throttles a runaway or looping agent, it is not a distributed
 * quota and does not replace authentication or authorization. Each tool has its
 * own bucket, so one noisy read-only tool cannot starve a governance call.
 */
export class ToolRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly disabled: boolean;

  constructor(config: RateLimitConfig) {
    if (!Number.isFinite(config.maxCalls) || config.maxCalls < 1) {
      throw new RangeError('rate limit maxCalls must be >= 1');
    }
    if (!Number.isFinite(config.windowMs) || config.windowMs < 1) {
      throw new RangeError('rate limit windowMs must be >= 1');
    }
    this.maxCalls = Math.floor(config.maxCalls);
    this.windowMs = Math.floor(config.windowMs);
    this.disabled = config.disabled;
  }

  get limit(): number {
    return this.maxCalls;
  }

  get window(): number {
    return this.windowMs;
  }

  /**
   * Consume one token for `toolName`. `now` is injectable so tests can prove
   * refill behavior without sleeping.
   */
  check(toolName: string, now: number = Date.now()): RateLimitDecision {
    if (this.disabled) {
      return { allowed: true, limit: this.maxCalls, remaining: this.maxCalls, retryAfterMs: 0 };
    }

    let bucket = this.buckets.get(toolName);
    if (!bucket) {
      bucket = { tokens: this.maxCalls, updatedAt: now };
      this.buckets.set(toolName, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.updatedAt);
      bucket.tokens = Math.min(this.maxCalls, bucket.tokens + elapsed * this.refillPerMs());
      bucket.updatedAt = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        allowed: true,
        limit: this.maxCalls,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    return {
      allowed: false,
      limit: this.maxCalls,
      remaining: 0,
      retryAfterMs: Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerMs())),
    };
  }

  /** Forget one tool's history, or every tool when called with no argument. */
  reset(toolName?: string): void {
    if (toolName === undefined) {
      this.buckets.clear();
    } else {
      this.buckets.delete(toolName);
    }
  }

  private refillPerMs(): number {
    return this.maxCalls / this.windowMs;
  }
}

export interface ParsedRateLimitConfig {
  config: RateLimitConfig;
  warnings: string[];
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  warnings: string[],
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    warnings.push(`${name}="${raw}" is invalid; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Read the optional environment overrides. Missing variables keep the secure
 * defaults; malformed values are reported and replaced by the default instead
 * of silently disabling the limiter.
 */
export function rateLimitConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ParsedRateLimitConfig {
  const warnings: string[] = [];
  const maxCalls = positiveInteger(
    env.BEHAVIOROS_MCP_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX_CALLS,
    'BEHAVIOROS_MCP_RATE_LIMIT_MAX',
    warnings,
  );
  const windowMs = positiveInteger(
    env.BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
    'BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS',
    warnings,
  );
  const disabled = env.BEHAVIOROS_MCP_RATE_LIMIT_DISABLED === 'true';

  return { config: { maxCalls, windowMs, disabled }, warnings };
}

/**
 * Wrap a registered tool callback with the shared limiter. The check runs
 * before the handler, so a throttled call does no engine work and returns a
 * normal MCP error result (the client sees `isError: true`, not a crash).
 *
 * The wrapper is generic over the callback's function type, so the MCP SDK's
 * per-tool argument inference is preserved.
 */
export function withRateLimit<F extends (...args: never[]) => unknown>(
  toolName: string,
  callback: F,
  limiter: ToolRateLimiter,
): F {
  return (async (...args: Parameters<F>) => {
    const decision = limiter.check(toolName);
    if (!decision.allowed) {
      return {
        content: [
          {
            type: 'text',
            text: `Rate limit exceeded for ${toolName}: retry after ${decision.retryAfterMs} ms (limit ${decision.limit} calls per ${limiter.window} ms).`,
          },
        ],
        isError: true,
      };
    }
    return callback(...args);
  }) as F;
}
