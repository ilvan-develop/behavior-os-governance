/**
 * G-012: Circuit Breaker Intelligence Engine.
 *
 * Extends circuit breaker patterns with failure pattern learning.
 * Tracks failure signatures and recommends breaker threshold adjustments
 * based on observed failure rates.
 */

interface FailureRecord {
  operationType: string;
  error: string;
  timestamp: number;
  breakerName: string;
}

function normalizeError(error: string): string {
  // Normalize common error patterns (timestamps, IDs, etc.)
  return error
    .replace(/\d+/g, '#')
    .replace(/id[=:]\s*\S+/gi, 'id=X')
    .replace(/\s+/g, ' ')
    .trim();
}

export class CircuitBreakerIntelligence {
  private failures: FailureRecord[] = [];
  private failurePatterns = new Map<
    string,
    {
      operationType: string;
      errorPattern: string;
      count: number;
      failureRate: number;
      breakerName: string;
    }
  >();
  private adjustments: import('@behavior-os/schemas').BreakerAdjustment[] = [];

  /** Record a failure event. */
  recordFailure(
    operationType: string,
    error: string,
    breakerName: string,
    timestamp: number = Date.now(),
  ): void {
    this.failures.push({ operationType, error, breakerName, timestamp });
    this.updatePatterns(operationType, error, breakerName);
  }

  private updatePatterns(operationType: string, error: string, breakerName: string): void {
    const pattern = normalizeError(error);
    const key = `${operationType}:${pattern}`;

    const existing = this.failurePatterns.get(key);
    const breakerFailures = this.failures.filter((f) => f.breakerName === breakerName);
    const patternCount = existing ? existing.count + 1 : 1;
    const rate = breakerFailures.length > 0 ? patternCount / breakerFailures.length : 0;

    if (existing) {
      existing.count++;
      existing.failureRate = rate;
    } else {
      this.failurePatterns.set(key, {
        operationType,
        errorPattern: pattern,
        count: 1,
        failureRate: rate,
        breakerName,
      });
    }
  }

  /** Get all detected failure patterns. */
  getFailurePatterns(): import('@behavior-os/schemas').FailurePattern[] {
    return [...this.failurePatterns.values()].map((p, i) => ({
      id: `fp-${i}`,
      operationType: p.operationType,
      errorPattern: p.errorPattern,
      occurrences: p.count,
      failureRate: Math.round(p.failureRate * 100) / 100,
      recommendedThreshold: this.computeRecommendedThreshold(p),
    }));
  }

  private computeRecommendedThreshold(pattern: { count: number; failureRate: number }): number {
    // Higher failure rate → lower threshold (break more aggressively)
    if (pattern.failureRate > 0.5) return 0.3;
    if (pattern.failureRate > 0.25) return 0.5;
    return 0.7;
  }

  /**
   * Recommend breaker threshold adjustments based on failure patterns.
   */
  recommendAdjustments(): import('@behavior-os/schemas').BreakerAdjustment[] {
    const recommendations: import('@behavior-os/schemas').BreakerAdjustment[] = [];
    const now = new Date().toISOString();

    for (const [key, pattern] of this.failurePatterns.entries()) {
      const failures = this.failures.filter(
        (f) =>
          f.operationType === pattern.operationType &&
          normalizeError(f.error) === pattern.errorPattern,
      );
      const totalAttempts = failures.length;
      if (totalAttempts < 5) continue;

      const failureRate = pattern.count / totalAttempts;
      if (failureRate > 0.4) {
        recommendations.push({
          id: `adj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          failurePatternId: key,
          breakerName: pattern.breakerName,
          previousThreshold: 0.5,
          newThreshold: this.computeRecommendedThreshold(pattern),
          reason: `High failure rate (${Math.round(failureRate * 100)}%) for ${pattern.operationType}`,
          timestamp: now,
        });
      }
    }

    this.adjustments.push(...recommendations);
    return recommendations;
  }

  /** Get all recorded adjustments. */
  getAdjustments(): import('@behavior-os/schemas').BreakerAdjustment[] {
    return [...this.adjustments];
  }

  /** Clear all state. */
  clear(): void {
    this.failures = [];
    this.failurePatterns.clear();
    this.adjustments = [];
  }
}

export type { FailureRecord };
