export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. Default 3. */
  failureThreshold?: number;
  /** How long the circuit stays open before a trial call. Default 30s. */
  cooldownMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Per-adapter circuit breaker.
 *
 * `closed` → calls run; consecutive failures open it. `open` → calls are blocked
 * without touching the adapter. After the cooldown one trial call is allowed
 * (`half-open`); success closes the circuit, failure opens it again. The
 * orchestrator turns an open circuit into an explicit `CIRCUIT_OPEN` blocked
 * outcome, never a synthetic success.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private failures = 0;
  private openedAt: number | null = null;
  private halfOpen = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 30_000);
    this.now = options.now ?? Date.now;
  }

  canExecute(): boolean {
    if (this.openedAt === null) return true;
    if (this.halfOpen) return false;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.halfOpen = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpen = false;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.halfOpen || this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.halfOpen = false;
      this.failures = this.failureThreshold;
    }
  }

  getState(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.halfOpen ? 'half-open' : 'open';
  }

  getConsecutiveFailures(): number {
    return this.failures;
  }
}
