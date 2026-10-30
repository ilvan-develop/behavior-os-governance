import type { AnomalyScore, BehaviorProfile } from '@behavior-os/schemas';

/**
 * G-009: Behavioral Anomaly Detection Engine.
 *
 * Maintains a sliding-window baseline of agent behavior and scores
 * new observations against it. A high deviation score signals a
 * potential compromise, misconfiguration, or novel threat.
 */
export class AnomalyDetectionEngine {
  /** Per-agent sliding-window baselines. */
  private baselines = new Map<string, BehaviorProfile[]>();
  /** Number of recent windows to average for the baseline. */
  private readonly windowSize = 5;

  /**
   * Record an observed behavior snapshot for an agent.
   * The snapshot is added to the agent's sliding window.
   */
  recordBehavior(agentId: string, snapshot: BehaviorProfile): void {
    const window = this.baselines.get(agentId) ?? [];
    window.push(snapshot);
    if (window.length > this.windowSize) window.shift();
    this.baselines.set(agentId, window);
  }

  /**
   * Score a new observation against the agent's historical baseline.
   *
   * Deviation is a weighted mean absolute difference across all
   * profile dimensions, normalized to 0..1.
   */
  scoreAnomaly(agentId: string, current: BehaviorProfile): AnomalyScore | null {
    const window = this.baselines.get(agentId);
    if (!window || window.length === 0) {
      // No baseline yet — return a zero-deviation score.
      return {
        id: `anomaly-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        agentId,
        baseline: current,
        current,
        deviation: 0,
        explanation: 'No baseline available; using current as reference.',
        timestamp: new Date().toISOString(),
      };
    }

    // Compute the average baseline profile.
    const baseline: BehaviorProfile = {
      actionRate: average(window.map((p) => p.actionRate)),
      denialRate: average(window.map((p) => p.denialRate)),
      escalationRate: average(window.map((p) => p.escalationRate)),
      toolDiversity: average(window.map((p) => p.toolDiversity)),
      offHoursRatio: average(window.map((p) => p.offHoursRatio)),
    };

    // Weighted deviation (each dimension contributes equally).
    const deviation =
      0.3 * Math.abs(current.actionRate - baseline.actionRate) +
      0.25 * Math.abs(current.denialRate - baseline.denialRate) +
      0.15 * Math.abs(current.escalationRate - baseline.escalationRate) +
      (0.15 * Math.abs(current.toolDiversity - baseline.toolDiversity)) /
        Math.max(1, baseline.toolDiversity, current.toolDiversity) +
      0.15 * Math.abs(current.offHoursRatio - baseline.offHoursRatio);

    const clamped = Math.round(Math.min(1, Math.max(0, deviation)) * 100) / 100;

    const parts: string[] = [];
    if (clamped > 0.1) parts.push(`deviation ${clamped} — significant anomaly`);
    else if (clamped > 0.05) parts.push(`moderate deviation ${clamped}`);
    else parts.push(`normal behavior (deviation ${clamped})`);

    return {
      id: `anomaly-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      baseline,
      current,
      deviation: clamped,
      explanation: parts.join('; '),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check whether an agent's current profile is anomalous
   * (deviation above the given threshold, default 0.3).
   */
  isAnomalous(agentId: string, current: BehaviorProfile, threshold = 0.3): boolean {
    const score = this.scoreAnomaly(agentId, current);
    return score !== null && score.deviation >= threshold;
  }

  /** Get the current baseline window for an agent. */
  getBaseline(agentId: string): BehaviorProfile[] {
    return [...(this.baselines.get(agentId) ?? [])];
  }

  /** Clear all baselines. */
  clear(): void {
    this.baselines.clear();
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
