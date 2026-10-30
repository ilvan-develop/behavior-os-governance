import { describe, expect, it } from 'vitest';
import { CircuitBreakerIntelligence } from '../src/engine/circuit-breaker-intelligence.js';

describe('CircuitBreakerIntelligence (G-012)', () => {
  it('records failures and detects patterns', () => {
    const engine = new CircuitBreakerIntelligence();

    for (let i = 0; i < 5; i++) {
      engine.recordFailure('deploy', 'timeout', 'deploy-breaker');
    }
    engine.recordFailure('deploy', 'OOMKilled', 'deploy-breaker');

    const patterns = engine.getFailurePatterns();
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('recommends threshold adjustments for high failure rates', () => {
    const engine = new CircuitBreakerIntelligence();

    for (let i = 0; i < 10; i++) {
      engine.recordFailure('deploy', 'timeout error', 'deploy-breaker');
    }

    const adjustments = engine.recommendAdjustments();
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments[0].breakerName).toBe('deploy-breaker');
    expect(adjustments[0].newThreshold).toBeLessThan(adjustments[0].previousThreshold);
  });

  it('does not recommend adjustments for insufficient data', () => {
    const engine = new CircuitBreakerIntelligence();

    engine.recordFailure('deploy', 'timeout error', 'deploy-breaker');
    engine.recordFailure('deploy', 'timeout error', 'deploy-breaker');

    const adjustments = engine.recommendAdjustments();
    expect(adjustments).toHaveLength(0);
  });

  it('normalizes error patterns', () => {
    const engine = new CircuitBreakerIntelligence();

    // All errors normalize to the same pattern after digit replacement
    engine.recordFailure('op-A', 'Error 12345: connection refused', 'breaker-1');
    engine.recordFailure('op-A', 'Error 67890: connection refused', 'breaker-1');
    engine.recordFailure('op-A', 'Error 11111: connection refused', 'breaker-1');
    engine.recordFailure('op-A', 'Error 22222: connection refused', 'breaker-1');
    engine.recordFailure('op-A', 'Error 33333: connection refused', 'breaker-1');

    const patterns = engine.getFailurePatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].errorPattern).toContain('Error #');
    expect(patterns[0].errorPattern).toContain('connection refused');
  });
});
