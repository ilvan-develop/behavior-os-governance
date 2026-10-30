/**
 * G-005: Temporal Pattern Engine.
 *
 * Detects recurring temporal patterns in governance decisions and
 * suggests temporal rules (cron-based) for rules that fire during
 * specific time windows.
 */

interface BehaviorEvent {
  id: string;
  agentId: string;
  ruleId: string;
  verdict: 'allow' | 'deny' | 'escalate' | 'warn';
  timestamp: number;
}

interface PatternMatch {
  hour: number;
  ruleId: string;
  count: number;
  denialCount: number;
}

interface TemporalPatternInternal {
  id: string;
  description: string;
  ruleId?: string;
  cronSchedule: string;
  activeDays?: number[];
  occurrences: number;
  avgDeviation: number;
  isRisk: boolean;
  detectedAt: string;
  lastSeen: string;
  hour?: number;
}

import type { TemporalPattern, TemporalPatternSuggestion } from '@behavior-os/schemas';

function timeToCron(hour: number): string {
  return `0 ${hour} * * *`;
}

function detectPatterns(events: BehaviorEvent[]): PatternMatch[] {
  const matches: Map<string, PatternMatch> = new Map();

  for (const event of events) {
    const hour = new Date(event.timestamp).getHours();
    const key = `${hour}:${event.ruleId}`;
    const existing = matches.get(key) ?? {
      hour,
      ruleId: event.ruleId,
      count: 0,
      denialCount: 0,
    };
    existing.count++;
    if (event.verdict === 'deny' || event.verdict === 'escalate') {
      existing.denialCount++;
    }
    matches.set(key, existing);
  }

  return [...matches.values()];
}

export class TemporalPatternEngine {
  private patterns: TemporalPatternInternal[] = [];
  private events: BehaviorEvent[] = [];

  /** Record a behavior event for pattern analysis. */
  recordEvent(event: BehaviorEvent): void {
    this.events.push(event);
  }

  /**
   * Analyze recorded events to detect temporal patterns.
   */
  analyze(minOccurrences = 5): TemporalPattern[] {
    if (this.events.length < minOccurrences) return [];

    const patternMatches = detectPatterns(this.events);
    const globalDenialRate =
      this.events.filter((e) => e.verdict === 'deny' || e.verdict === 'escalate').length /
      this.events.length;

    for (const match of patternMatches) {
      if (match.count < minOccurrences) continue;

      const localDenialRate = match.denialCount / match.count;
      const deviation = Math.abs(localDenialRate - globalDenialRate);
      const isRisk = localDenialRate > globalDenialRate;

      const exists = this.patterns.find((p) => p.ruleId === match.ruleId && p.hour === match.hour);
      if (exists) {
        exists.occurrences = match.count;
        exists.avgDeviation = Math.round(deviation * 100) / 100;
        exists.isRisk = isRisk;
        exists.lastSeen = new Date().toISOString();
      } else {
        this.patterns.push({
          id: `tp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          description: `Rule '${match.ruleId}' fires at hour ${match.hour} with ${Math.round(localDenialRate * 100)}% denial rate`,
          ruleId: match.ruleId,
          cronSchedule: timeToCron(match.hour),
          occurrences: match.count,
          avgDeviation: Math.round(deviation * 100) / 100,
          isRisk,
          detectedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          hour: match.hour,
        });
      }
    }

    return this.patterns.map((p) => ({
      id: p.id,
      description: p.description,
      ruleId: p.ruleId,
      cronSchedule: p.cronSchedule,
      activeDays: p.activeDays,
      occurrences: p.occurrences,
      avgDeviation: p.avgDeviation,
      isRisk: p.isRisk,
      detectedAt: p.detectedAt,
      lastSeen: p.lastSeen,
    }));
  }

  /** Suggest a temporal rule for a detected pattern. */
  suggestTemporalRule(pattern: TemporalPattern): TemporalPatternSuggestion {
    const cron = pattern.cronSchedule;
    const confidence = Math.min(1, pattern.occurrences / 20 + pattern.avgDeviation);
    return {
      patternId: pattern.id,
      suggestedCron: cron,
      confidence: Math.round(confidence * 100) / 100,
      reason: `Pattern detected with ${pattern.occurrences} occurrences and avg deviation ${pattern.avgDeviation}.`,
    };
  }

  getPatterns(): TemporalPattern[] {
    return this.patterns.map((p) => ({
      id: p.id,
      description: p.description,
      ruleId: p.ruleId,
      cronSchedule: p.cronSchedule,
      activeDays: p.activeDays,
      occurrences: p.occurrences,
      avgDeviation: p.avgDeviation,
      isRisk: p.isRisk,
      detectedAt: p.detectedAt,
      lastSeen: p.lastSeen,
    }));
  }

  clear(): void {
    this.patterns = [];
    this.events = [];
  }
}
