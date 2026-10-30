import type { DNA, GovernanceRule } from '@behavior-os/schemas';

/**
 * A temporal rule is a governance rule that is only active during specific
 * time windows. This allows for:
 * - Business-hours enforcement ("require approval outside 9-5")
 * - Scheduled maintenance windows ("block deploys 2-4 AM UTC")
 * - Recurring schedule restrictions ("block on holidays")
 */
export interface TemporalRule {
  /** Unique identifier, typically the base governance rule id suffixed with `-temporal-<n>`. */
  id: string;
  /** The base governance rule this temporal rule wraps. */
  baseRuleId: string;
  /** The governance rule to evaluate when the temporal window is active. */
  rule: GovernanceRule;
  /** Type of temporal condition. */
  scheduleType: 'absolute' | 'recurring' | 'cron';
  /**
   * For `absolute`: ISO start/end timestamps (end optional = open-ended).
   * For `recurring`: cron-like strings for `schedule` field.
   * For `cron`: a cron expression (minute hour day month weekday).
   */
  startTime?: string;
  endTime?: string;
  /** Recurring schedule as cron-style fields: "0 9 * * 1-5" = 9 AM Mon-Fri. */
  schedule?: string;
  /** Human-readable reason for the temporal rule. */
  reason: string;
  /** Who authorized the temporal rule. */
  authorizedBy: string;
  /** When the rule was created. */
  createdAt: string;
}

export interface TemporalEvaluationContext {
  action: string;
  agentId: string;
  context: Record<string, unknown>;
  missionId?: string;
  /** Evaluation time; defaults to now. */
  evalTime?: Date;
}

export interface TemporalEvaluationResult {
  /** Whether the temporal rule is currently active. */
  isActive: boolean;
  /** The rule if active, undefined if not. */
  rule?: GovernanceRule;
  /** Why the rule is inactive (e.g., "outside schedule window"). */
  inactiveReason?: string;
  /** Next time the rule will become active. */
  nextActiveAt?: string;
}

export interface TemporalCheckResult {
  activeRules: TemporalEvaluationResult[];
  inactiveRules: TemporalEvaluationResult[];
  recommendations: {
    action: 'allow' | 'warn' | 'block';
    ruleId: string;
    reason: string;
  }[];
}

/**
 * Cron-style field parser supporting 5-field syntax:
 * minute hour day-of-month month day-of-week
 * Values: 0-59 / 0-23 / 1-31 / 1-12 / 0-6 (0=Sunday)
 * Supports: wildcard, numbers, ranges (e.g. 1-5), lists (e.g. 1,3,5), steps (e.g. every-2, 1-5/2)
 */
function parseCronField(field: string, min: number, _max: number, value: number): boolean {
  // Handle wildcards
  if (field === '*') return true;

  // Handle step values like */2 or 1-5/2
  let step = 1;
  let rangePart = field;
  const stepMatch = field.match(/^(.+)\/(\d+)$/);
  if (stepMatch) {
    rangePart = stepMatch[1];
    step = Number.parseInt(stepMatch[2], 10);
  }

  // Handle lists: 1,3,5
  const parts = rangePart.split(',');
  for (const part of parts) {
    // Handle ranges: 1-5
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (value >= start && value <= end) {
        const offset = value - start;
        if (offset % step === 0) return true;
      }
      continue;
    }

    // Handle wildcards in range parts: */2
    if (part === '*') {
      if ((value - min) % step === 0) return true;
      continue;
    }

    // Handle single numbers
    const num = Number.parseInt(part, 10);
    if (!Number.isNaN(num)) {
      if (num === value && (value - min) % step === 0) return true;
    }
  }

  return false;
}

/**
 * Check if a date matches a 5-field cron expression.
 */
function matchesCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dayMonth, month, dayWeek] = fields;

  return (
    parseCronField(minute, 0, 59, date.getMinutes()) &&
    parseCronField(hour, 0, 23, date.getHours()) &&
    parseCronField(dayMonth, 1, 31, date.getDate()) &&
    parseCronField(month, 1, 12, date.getMonth() + 1) &&
    parseCronField(dayWeek, 0, 6, date.getDay())
  );
}

/**
 * Temporal Governance Engine — governs behavior based on time-based rules.
 *
 * Unlike the simple `effectiveUntil` expiry on PolicyRule or the `expiresAt`
 * on DynamicOverride, this engine provides full temporal rule evaluation:
 *
 * - **Absolute time windows**: rules that are active between specific timestamps.
 * - **Recurring schedules**: rules that are active on a cron-style schedule
 *   (e.g., "require approval on weekend deploys").
 * - **Open-ended windows**: rules with a start time but no end (active from
 *   a given time onward).
 *
 * The engine is a pure evaluation layer — it wraps existing `GovernanceRule`s
 * and evaluates them only when their temporal window is active.
 */
export class TemporalGovernanceEngine {
  private temporalRules: TemporalRule[] = [];
  private readonly now: () => Date;

  constructor(now?: () => Date) {
    this.now = now ?? (() => new Date());
  }

  /**
   * Register a temporal rule that wraps an existing governance rule.
   */
  addTemporalRule(rule: Omit<TemporalRule, 'id' | 'createdAt'>): { id: string; ok: boolean } {
    if (
      !rule.baseRuleId ||
      !rule.rule ||
      !rule.scheduleType ||
      !rule.reason ||
      !rule.authorizedBy
    ) {
      return { ok: false, id: '' };
    }

    // Validate the temporal condition has at least one trigger
    if (rule.scheduleType === 'absolute' && !rule.startTime && !rule.endTime) {
      return { ok: false, id: '' };
    }
    if (rule.scheduleType === 'recurring' && !rule.schedule) {
      return { ok: false, id: '' };
    }
    if (rule.scheduleType === 'cron' && !rule.schedule) {
      return { ok: false, id: '' };
    }

    // Validate ISO timestamps if provided
    if (rule.startTime && Number.isNaN(new Date(rule.startTime).getTime())) {
      return { ok: false, id: '' };
    }
    if (rule.endTime && Number.isNaN(new Date(rule.endTime).getTime())) {
      return { ok: false, id: '' };
    }

    const temporalRule: TemporalRule = {
      ...rule,
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
    };

    // Check for duplicate by baseRuleId
    const existing = this.temporalRules.find((r) => r.baseRuleId === rule.baseRuleId);
    if (existing) {
      Object.assign(existing, temporalRule);
    } else {
      this.temporalRules.push(temporalRule);
    }

    return { id: temporalRule.id, ok: true };
  }

  /**
   * Remove a temporal rule by id.
   */
  removeTemporalRule(id: string): boolean {
    const before = this.temporalRules.length;
    this.temporalRules = this.temporalRules.filter((r) => r.id !== id);
    return this.temporalRules.length < before;
  }

  /**
   * Clear all temporal rules.
   */
  clear(): void {
    this.temporalRules = [];
  }

  /**
   * Check whether a temporal rule is active at the given time (defaults to now).
   */
  isRuleActive(rule: TemporalRule, atTime?: Date): TemporalEvaluationResult {
    const now = atTime ?? this.now();

    if (rule.scheduleType === 'absolute') {
      const start = rule.startTime ? new Date(rule.startTime) : new Date(0);
      const end = rule.endTime ? new Date(rule.endTime) : null;

      if (now < start) {
        return {
          isActive: false,
          inactiveReason: `Before start time ${rule.startTime}`,
          nextActiveAt: rule.startTime,
        };
      }
      if (end && now > end) {
        return {
          isActive: false,
          inactiveReason: `Past end time ${rule.endTime}`,
        };
      }
      return { isActive: true, rule: rule.rule };
    }

    if (rule.scheduleType === 'recurring' || rule.scheduleType === 'cron') {
      if (!rule.schedule) {
        return {
          isActive: false,
          inactiveReason: 'No cron schedule defined',
        };
      }

      const active = matchesCron(rule.schedule, now);
      if (active) {
        return { isActive: true, rule: rule.rule };
      }
      return {
        isActive: false,
        inactiveReason: `Does not match cron schedule "${rule.schedule}"`,
        nextActiveAt: this.nextActiveTime(rule.schedule, now),
      };
    }

    return {
      isActive: false,
      inactiveReason: `Unknown schedule type: ${rule.scheduleType}`,
    };
  }

  /**
   * Evaluate all temporal rules against a context and return active rules.
   */
  evaluate(context: TemporalEvaluationContext): TemporalCheckResult {
    const results = this.temporalRules.map((rule) => this.isRuleActive(rule, context.evalTime));

    const active = results.filter((r) => r.isActive);
    const inactive = results.filter((r) => !r.isActive);

    // Generate recommendations based on active rules
    const recommendations = active
      .map((r) => {
        if (!r.rule) return null;
        return {
          action: (r.rule.action === 'block' ? 'block' : 'warn') as 'block' | 'warn' | 'allow',
          ruleId: r.rule.id,
          reason: r.rule.description || `Temporal rule ${r.rule.id} is active`,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return {
      activeRules: active,
      inactiveRules: inactive,
      recommendations,
    };
  }

  /**
   * Evaluate a DNA's governance rules against temporal overrides and return
   * the effective set of rules that should be enforced.
   *
   * This method intersects the DNA's static rules with temporal rules:
   * - Static rules always active
   * - Temporal rules active only during their window (additional or overriding)
   */
  evaluateDNA(
    dna: DNA,
    context: TemporalEvaluationContext,
  ): { effectiveRules: GovernanceRule[]; temporalOverrides: TemporalRule[] } {
    const evalTime = context.evalTime ?? this.now();
    const effectiveRules = [...(dna.governance ?? [])];
    const activeTemporal: TemporalRule[] = [];

    for (const temporalRule of this.temporalRules) {
      const result = this.isRuleActive(temporalRule, evalTime);
      if (result.isActive) {
        // If the base rule exists in the DNA, override its properties while
        // preserving the original id so existing governance references stay valid.
        const existingIndex = effectiveRules.findIndex((r) => r.id === temporalRule.baseRuleId);
        if (existingIndex >= 0) {
          effectiveRules[existingIndex] = {
            ...effectiveRules[existingIndex],
            ...temporalRule.rule,
            id: effectiveRules[existingIndex].id, // keep original id
          };
        } else {
          effectiveRules.push(temporalRule.rule);
        }
        activeTemporal.push(temporalRule);
      }
    }

    return { effectiveRules, temporalOverrides: activeTemporal };
  }

  /**
   * Get all temporal rules (including inactive ones).
   */
  getTemporalRules(): TemporalRule[] {
    return [...this.temporalRules];
  }

  /**
   * Get only active temporal rules at the current time (or specified time).
   */
  getActiveRules(atTime?: Date): TemporalRule[] {
    const now = atTime ?? this.now();
    return this.temporalRules.filter((rule) => {
      const result = this.isRuleActive(rule, now);
      return result.isActive;
    });
  }

  /**
   * Compute the next time a cron schedule will match, starting from `from`.
   * Returns an ISO timestamp string.
   */
  private nextActiveTime(cron: string, from: Date): string {
    // For simplicity, check every minute up to 7 days ahead
    const maxMinutes = 7 * 24 * 60;
    for (let i = 1; i <= maxMinutes; i++) {
      const candidate = new Date(from.getTime() + i * 60000);
      if (matchesCron(cron, candidate)) {
        return candidate.toISOString();
      }
    }
    return new Date(from.getTime() + maxMinutes * 60000).toISOString();
  }
}
