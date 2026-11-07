/**
 * Risk context — turns *observed* system state into the risk factors the
 * DynamicPolicyEngine (G-011) consumes.
 *
 * This is the "context adapted to each task" layer the prompt asks for: the
 * orchestrator consults the live governance metrics and the recent log to
 * compute the five risk factors, then the dynamic-policy engine turns them
 * into adjusted enforcement thresholds. Nothing here invents new state —
 * it reads the metrics the engine already records and the last N decisions
 * from the hash-chained governance log.
 *
 * The five factors (each 0..1) map onto `DynamicPolicyEngine.assessRisk`:
 *   - denialRate        share of recent non-allow verdicts
 *   - anomalyDeviation  how far the agent's current behavior profile deviates
 *                       from its rolling baseline (0 when no baseline yet)
 *   - toolDiversity     normalized count of distinct tools in the window
 *   - offHoursRatio     share of the window that falls outside 09:00–18:00
 *   - recentFailures    share of window entries that are tool failures
 */

import type { BehaviorOSSnapshot } from '@behavior-os/core';
import { getGovernanceLog } from '@behavior-os/core';

export interface RiskFactors {
  denialRate: number;
  anomalyDeviation: number;
  toolDiversity: number;
  offHoursRatio: number;
  recentFailures: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 09:00–18:00 UTC counts as working hours. */
function isOffHours(date: Date): boolean {
  const hour = date.getUTCHours();
  return hour < 9 || hour >= 18;
}

/**
 * Derive the five risk factors from the recent governance log and the agent's
 * behavioral metrics. `windowSize` bounds how many log entries are considered
 * so a long-running host does not drift its policy on ancient history.
 */
export function deriveRiskFactors(
  agentId: string,
  opts: { windowSize?: number; baselineDeviation?: number } = {},
): RiskFactors {
  const windowSize = opts.windowSize ?? 50;
  const log = getGovernanceLog(windowSize);

  // Only entries attributable to this agent (or the global control plane when
  // the agent is the session identity) count toward the per-agent rates.
  const relevant = log.filter((event) => event.action === agentId || agentId === 'control-plane');

  const nonAllow = relevant.filter((event) => event.outcome !== 'allow').length;
  const denialRate = relevant.length > 0 ? clamp01(nonAllow / relevant.length) : 0;

  // Tool diversity: distinct governed tool actions in the window, normalized.
  const distinctTools = new Set(
    log
      .map((event) => event.action)
      .filter((action) => typeof action === 'string' && action.length > 0),
  );
  // 10+ distinct tools saturates the signal; below that it scales linearly.
  const toolDiversity = clamp01(distinctTools.size / 10);

  // Off-hours ratio over the window (falls back to the current hour when the
  // log is empty, so a fresh host still gets a sensible default).
  const timestamps = relevant
    .map((event) => {
      const date = new Date(event.at ?? 0);
      return Number.isNaN(date.getTime()) ? null : date;
    })
    .filter((date): date is Date => date !== null);
  const offHours =
    timestamps.length > 0
      ? timestamps.filter(isOffHours).length / timestamps.length
      : isOffHours(new Date())
        ? 1
        : 0;
  const offHoursRatio = clamp01(offHours);

  // Recent failures: learning/log entries recorded as failures in the window.
  const failures = relevant.filter(
    (event) => event.outcome === 'error' || event.kind === 'learning',
  ).length;
  const recentFailures = relevant.length > 0 ? clamp01(failures / relevant.length) : 0;

  // Anomaly deviation comes from the behavioral baseline the host maintains
  // (passed in by the caller). Without a baseline we contribute 0 — the
  // engine treats "unknown" as "not deviant" rather than inventing a value.
  const anomalyDeviation = clamp01(opts.baselineDeviation ?? 0);

  return { denialRate, anomalyDeviation, toolDiversity, offHoursRatio, recentFailures };
}

/**
 * Run the full risk → policy pipeline against a live BehaviorOS instance:
 * derive factors, assess risk and create the dynamic policy. Returns both the
 * factors and the resulting assessment + policy so the orchestrator can apply
 * the adjusted thresholds to the next governance decision.
 */
export function assessRiskContext(
  agentId: string,
  opts: { windowSize?: number; baselineDeviation?: number },
  behaviorOs: import('@behavior-os/core').BehaviorOS,
): {
  factors: RiskFactors;
  assessment: {
    level: 'low' | 'medium' | 'high' | 'critical';
    score: number;
    adjustedThresholds: Record<string, number>;
  };
  policy: unknown;
} {
  const factors = deriveRiskFactors(agentId, opts);
  const engine = behaviorOs.getDynamicPolicy();
  const assessment = engine.assessRisk(agentId, factors);
  const policy = engine.createDynamicPolicy(agentId, assessment, []);
  return { factors, assessment, policy };
}

// Re-exported so callers can build the factors without importing core directly.
export type { BehaviorOSSnapshot };
