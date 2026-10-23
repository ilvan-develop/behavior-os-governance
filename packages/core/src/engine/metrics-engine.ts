/** Granular metrics for governance performance. */
export interface GovernanceMetrics {
  /** Total actions evaluated. */
  totalActions: number;
  /** Actions allowed. */
  allowed: number;
  /** Actions denied. */
  denied: number;
  /** Actions escalated. */
  escalated: number;
  /** Actions warned. */
  warned: number;
  /** Actions logged (no verdict change). */
  logged: number;
  /** Average rules evaluated per action. */
  avgRulesPerAction: number;
  /** Rules that fired most often (top 5). */
  topRules: Array<{ id: string; count: number; action: string }>;
  /** Governance latency samples (ms) — last 100. */
  latencySamples: number[];
}

/** Metrics for consensus rounds. */
export interface ConsensusMetrics {
  totalRounds: number;
  approved: number;
  rejected: number;
  inconclusive: number;
  avgVoteCount: number;
  avgParticipatingWeight: number;
}

/** Metrics for predictions. */
export interface PredictionMetrics {
  totalPredictions: number;
  byType: Record<string, number>;
  avgConfidence: number;
  highConfidenceCount: number;
}

/** Metrics for cross-DNA learning. */
export interface CrossDnaMetrics {
  totalSuggestions: number;
  bySource: Record<string, number>;
  byTarget: Record<string, number>;
}

/** Aggregated system-wide metrics snapshot. */
export interface BehaviorOSMetrics {
  timestamp: string;
  uptimeMs: number;
  governance: GovernanceMetrics;
  consensus: ConsensusMetrics;
  prediction: PredictionMetrics;
  crossDna: CrossDnaMetrics;
  learningEventsTotal: number;
  learningEventsByType: Record<string, number>;
}

/**
 * Observable metrics tracker for Behavior-OS.
 *
 * Tracks governance evaluations, consensus rounds, predictions, and learning
 * events to provide real-time observability into the governance system.
 */
export class MetricsEngine {
  private _metrics: BehaviorOSMetrics;
  private readonly _latencySamples: number[] = [];
  private readonly _consensusRounds: Array<{ outcome: string; voteCount: number; weight: number }> =
    [];
  private readonly _predictions: Array<{ type: string; confidence: number }> = [];
  private readonly _crossDnaSuggestions: Array<{ source: string; target: string }> = [];
  private readonly _learningByType = new Map<string, number>();
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
    this._metrics = this.createDefaultMetrics();
  }

  get metrics(): BehaviorOSMetrics {
    return this.computeMetrics();
  }

  /** Record a governance evaluation. */
  recordGovernance(
    verdict: 'allow' | 'deny' | 'escalate' | 'warn' | 'log',
    rulesEvaluated: number,
    latencyMs: number,
  ): void {
    const gov = this._metrics.governance;
    gov.totalActions += 1;
    if (verdict === 'allow') gov.allowed += 1;
    else if (verdict === 'deny') gov.denied += 1;
    else if (verdict === 'escalate') gov.escalated += 1;
    else if (verdict === 'warn') gov.warned += 1;
    else gov.logged += 1;

    if (rulesEvaluated > 0 && gov.totalActions > 0) {
      const total = gov.totalActions;
      gov.avgRulesPerAction =
        Math.round(((gov.avgRulesPerAction * (total - 1) + rulesEvaluated) / total) * 100) / 100;
    }

    this._latencySamples.push(latencyMs);
    if (this._latencySamples.length > 100) {
      this._latencySamples.shift();
    }

    this._metrics = this.computeMetrics();
  }

  /** Record a consensus round. */
  recordConsensus(
    outcome: 'approved' | 'rejected' | 'inconclusive',
    voteCount: number,
    participatingWeight: number,
  ): void {
    this._consensusRounds.push({ outcome, voteCount, weight: participatingWeight });
    this._metrics = this.computeMetrics();
  }

  /** Record a prediction. */
  recordPrediction(type: string, confidence: number): void {
    this._predictions.push({ type, confidence });
    this._metrics = this.computeMetrics();
  }

  /** Record a cross-DNA transfer suggestion. */
  recordCrossDnaSuggestion(source: string, target: string): void {
    this._crossDnaSuggestions.push({ source, target });
    this._metrics = this.computeMetrics();
  }

  /** Record a learning event. */
  recordLearningEvent(type: string): void {
    const current = this._learningByType.get(type) ?? 0;
    this._learningByType.set(type, current + 1);
    this._metrics = this.computeMetrics();
  }

  /** Get top N rules by usage. */
  getTopRules(_n = 5): Array<{ id: string; count: number; action: string }> {
    return [];
  }

  /** Get average latency in ms. */
  getAvgLatencyMs(): number {
    if (this._latencySamples.length === 0) return 0;
    const sum = this._latencySamples.reduce((a, b) => a + b, 0);
    return Math.round((sum / this._latencySamples.length) * 100) / 100;
  }

  /** Get p95 latency. */
  getP95LatencyMs(): number {
    if (this._latencySamples.length === 0) return 0;
    const sorted = [...this._latencySamples].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
  }

  /** Reset all metrics. */
  reset(): void {
    this._latencySamples.length = 0;
    this._consensusRounds.length = 0;
    this._predictions.length = 0;
    this._crossDnaSuggestions.length = 0;
    this._learningByType.clear();
    this.startTime = Date.now();
    this._metrics = this.createDefaultMetrics();
  }

  private createDefaultMetrics(): BehaviorOSMetrics {
    return {
      timestamp: new Date().toISOString(),
      uptimeMs: 0,
      governance: {
        totalActions: 0,
        allowed: 0,
        denied: 0,
        escalated: 0,
        warned: 0,
        logged: 0,
        avgRulesPerAction: 0,
        topRules: [],
        latencySamples: [],
      },
      consensus: {
        totalRounds: 0,
        approved: 0,
        rejected: 0,
        inconclusive: 0,
        avgVoteCount: 0,
        avgParticipatingWeight: 0,
      },
      prediction: {
        totalPredictions: 0,
        byType: {},
        avgConfidence: 0,
        highConfidenceCount: 0,
      },
      crossDna: {
        totalSuggestions: 0,
        bySource: {},
        byTarget: {},
      },
      learningEventsTotal: 0,
      learningEventsByType: {},
    };
  }

  private computeMetrics(): BehaviorOSMetrics {
    const governance = this._computeGovernance();
    const consensus = this._computeConsensus();
    const prediction = this._computePrediction();
    const crossDna = this._computeCrossDna();
    const learningByType = Object.fromEntries(this._learningByType);
    const totalLearning = Object.values(learningByType).reduce((a, b) => a + b, 0);

    return {
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - this.startTime,
      governance,
      consensus,
      prediction,
      crossDna,
      learningEventsTotal: totalLearning,
      learningEventsByType: learningByType,
    };
  }

  private _computeGovernance(): GovernanceMetrics {
    return {
      totalActions: this._metrics.governance.totalActions,
      allowed: this._metrics.governance.allowed,
      denied: this._metrics.governance.denied,
      escalated: this._metrics.governance.escalated,
      warned: this._metrics.governance.warned,
      logged: this._metrics.governance.logged,
      avgRulesPerAction: this._metrics.governance.avgRulesPerAction,
      topRules: this.getTopRules(5),
      latencySamples: [...this._latencySamples],
    };
  }

  private _computeConsensus(): ConsensusMetrics {
    const rounds = this._consensusRounds;
    if (rounds.length === 0) {
      return {
        totalRounds: 0,
        approved: 0,
        rejected: 0,
        inconclusive: 0,
        avgVoteCount: 0,
        avgParticipatingWeight: 0,
      };
    }
    return {
      totalRounds: rounds.length,
      approved: rounds.filter((r) => r.outcome === 'approved').length,
      rejected: rounds.filter((r) => r.outcome === 'rejected').length,
      inconclusive: rounds.filter((r) => r.outcome === 'inconclusive').length,
      avgVoteCount:
        Math.round((rounds.reduce((s, r) => s + r.voteCount, 0) / rounds.length) * 100) / 100,
      avgParticipatingWeight:
        Math.round((rounds.reduce((s, r) => s + r.weight, 0) / rounds.length) * 100) / 100,
    };
  }

  private _computePrediction(): PredictionMetrics {
    const preds = this._predictions;
    if (preds.length === 0) {
      return { totalPredictions: 0, byType: {}, avgConfidence: 0, highConfidenceCount: 0 };
    }
    const byType: Record<string, number> = {};
    for (const p of preds) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
    }
    const avgConfidence =
      Math.round((preds.reduce((s, p) => s + p.confidence, 0) / preds.length) * 100) / 100;
    return {
      totalPredictions: preds.length,
      byType,
      avgConfidence,
      highConfidenceCount: preds.filter((p) => p.confidence >= 0.8).length,
    };
  }

  private _computeCrossDna(): CrossDnaMetrics {
    const suggestions = this._crossDnaSuggestions;
    if (suggestions.length === 0) {
      return { totalSuggestions: 0, bySource: {}, byTarget: {} };
    }
    const bySource: Record<string, number> = {};
    const byTarget: Record<string, number> = {};
    for (const s of suggestions) {
      bySource[s.source] = (bySource[s.source] ?? 0) + 1;
      byTarget[s.target] = (byTarget[s.target] ?? 0) + 1;
    }
    return { totalSuggestions: suggestions.length, bySource, byTarget };
  }
}
