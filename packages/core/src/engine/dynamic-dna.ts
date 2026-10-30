import type { DNA } from '@behavior-os/schemas';

/**
 * Dynamic DNA that can be modified at runtime.
 *
 * Unlike static YAML DNAs, dynamic DNAs can add/remove rules and gates
 * based on learned patterns, consensus decisions, or external policies.
 */
export interface DynamicDNA {
  /** Base DNA this dynamic DNA extends. */
  baseDna: DNA;
  /** Override rules added at runtime. */
  overrides: DynamicOverride[];
  /** Temporary rules that expire. */
  tempRules: TempRule[];
  /** Custom quality gates. */
  customGates: CustomQualityGate[];
  /** Metadata about modifications. */
  metadata: Record<string, unknown>;
}

export interface DynamicOverride {
  /** Rule ID being overridden. */
  ruleId: string;
  /** New action. */
  action: 'block' | 'escalate' | 'warn' | 'log' | 'transform';
  /** New conditions. */
  conditions?: Array<{ type: string; value: unknown }>;
  /** Reason for override. */
  reason: string;
  /** Who authorized the override. */
  authorizedBy: string;
  /** Timestamp of override. */
  appliedAt: string;
  /** Optional expiration. */
  expiresAt?: string;
}

export interface TempRule {
  /** Unique ID. */
  id: string;
  /** Rule definition. */
  rule: {
    id: string;
    level: 'critical' | 'high' | 'medium' | 'low';
    action: 'block' | 'escalate' | 'warn' | 'log' | 'transform';
    conditions: Array<{ type: string; value: unknown }>;
    description: string;
  };
  /** Reason for temporary rule. */
  reason: string;
  /** Who authorized. */
  authorizedBy: string;
  /** Timestamp of creation. */
  createdAt: string;
  /** Expiration timestamp. */
  expiresAt: string;
}

export interface CustomQualityGate {
  /** Gate ID. */
  id: string;
  /** Gate type. */
  type: string;
  /** Threshold. */
  threshold: number;
  /** Operator. */
  operator?: 'gte' | 'lte' | 'eq' | 'neq';
  /** Reason. */
  reason: string;
  /** Authorized by. */
  authorizedBy: string;
  /** Timestamp. */
  createdAt: string;
}

/**
 * Engine for managing dynamic DNA modifications.
 */
export class DynamicDNAManager {
  private dynamicDNAs = new Map<string, DynamicDNA>();

  /** Create a dynamic DNA from a base pattern. */
  createDynamicDNA(dnaName: string, baseDna: DNA): DynamicDNA {
    const dynamic: DynamicDNA = {
      baseDna,
      overrides: [],
      tempRules: [],
      customGates: [],
      metadata: {
        created: new Date().toISOString(),
        createdBy: 'system',
        version: 1,
      },
    };
    this.dynamicDNAs.set(dnaName, dynamic);
    return dynamic;
  }

  /** Get a dynamic DNA. */
  getDynamicDNA(dnaName: string): DynamicDNA | undefined {
    return this.dynamicDNAs.get(dnaName);
  }

  /** List all dynamic DNAs. */
  listDynamicDNAs(): DynamicDNA[] {
    return [...this.dynamicDNAs.values()];
  }

  /** Add a rule override. */
  addOverride(
    dnaName: string,
    ruleId: string,
    action: 'block' | 'escalate' | 'warn' | 'log' | 'transform',
    conditions?: Array<{ type: string; value: unknown }>,
    reason: string = '',
    authorizedBy: string = 'system',
    expiresAt?: string,
  ): { success: boolean; error?: string } {
    const dynamic = this.dynamicDNAs.get(dnaName);
    if (!dynamic) {
      return { success: false, error: 'Dynamic DNA not found' };
    }

    // Check if rule already has an override
    const existing = dynamic.overrides.find((o) => o.ruleId === ruleId);
    if (existing) {
      // Update existing override
      existing.action = action;
      if (conditions) existing.conditions = conditions;
      existing.reason = reason;
      existing.authorizedBy = authorizedBy;
      existing.expiresAt = expiresAt;
    } else {
      dynamic.overrides.push({
        ruleId,
        action,
        conditions,
        reason,
        authorizedBy,
        appliedAt: new Date().toISOString(),
        expiresAt,
      });
    }

    dynamic.metadata.version = ((dynamic.metadata.version as number) ?? 0) + 1;
    dynamic.metadata.lastModified = new Date().toISOString();
    return { success: true };
  }

  /** Add a temporary rule. */
  addTempRule(
    dnaName: string,
    rule: {
      id: string;
      level: 'critical' | 'high' | 'medium' | 'low';
      action: 'block' | 'escalate' | 'warn' | 'log' | 'transform';
      conditions: Array<{ type: string; value: unknown }>;
      description: string;
    },
    reason: string,
    authorizedBy: string,
    expiresAt: string,
  ): { success: boolean; error?: string } {
    const dynamic = this.dynamicDNAs.get(dnaName);
    if (!dynamic) {
      return { success: false, error: 'Dynamic DNA not found' };
    }

    dynamic.tempRules.push({
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rule,
      reason,
      authorizedBy,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    dynamic.metadata.version = ((dynamic.metadata.version as number) ?? 0) + 1;
    return { success: true };
  }

  /** Add a custom quality gate. */
  addCustomGate(
    dnaName: string,
    id: string,
    type: string,
    threshold: number,
    operator?: 'gte' | 'lte' | 'eq' | 'neq',
    reason: string = '',
    authorizedBy: string = 'system',
  ): { success: boolean; error?: string } {
    const dynamic = this.dynamicDNAs.get(dnaName);
    if (!dynamic) {
      return { success: false, error: 'Dynamic DNA not found' };
    }

    dynamic.customGates.push({
      id,
      type,
      threshold,
      operator,
      reason,
      authorizedBy,
      createdAt: new Date().toISOString(),
    });

    dynamic.metadata.version = ((dynamic.metadata.version as number) ?? 0) + 1;
    return { success: true };
  }

  /** Get effective DNA with overrides applied. */
  getEffectiveDNA(dnaName: string): DNA | null {
    const dynamic = this.dynamicDNAs.get(dnaName);
    if (!dynamic) return null;

    // Clean up expired rules
    const now = new Date().toISOString();
    dynamic.tempRules = dynamic.tempRules.filter((r) => r.expiresAt > now);
    dynamic.overrides = dynamic.overrides.filter((o) => !o.expiresAt || o.expiresAt > now);

    // Build effective governance rules
    const effectiveRules = [...dynamic.baseDna.governance];
    for (const override of dynamic.overrides) {
      const idx = effectiveRules.findIndex((r) => r.id === override.ruleId);
      if (idx >= 0) {
        effectiveRules[idx] = {
          ...effectiveRules[idx],
          action: override.action,
          ...(override.conditions ? { conditions: override.conditions } : {}),
        };
      }
    }
    for (const tempRule of dynamic.tempRules) {
      effectiveRules.push({
        id: tempRule.rule.id,
        level: tempRule.rule.level,
        action: tempRule.rule.action,
        conditions: tempRule.rule.conditions,
        description: tempRule.rule.description,
      });
    }

    // Build effective quality gates
    const effectiveGates = [
      ...dynamic.baseDna.quality,
      ...dynamic.customGates.map((g) => ({
        id: g.id,
        type: g.type as import('@behavior-os/schemas').QualityGate['type'],
        threshold: g.threshold,
        operator: g.operator,
      })),
    ];

    return {
      ...dynamic.baseDna,
      governance: effectiveRules,
      quality: effectiveGates,
      metadata: {
        ...dynamic.baseDna.metadata,
        dynamicVersion: dynamic.metadata.version,
        lastModified: dynamic.metadata.lastModified,
      },
    };
  }

  /** Remove a dynamic DNA. */
  removeDynamicDNA(dnaName: string): boolean {
    return this.dynamicDNAs.delete(dnaName);
  }

  /**
   * Suggest cross-DNA pattern transfer based on similarity analysis.
   * Analyzes two DNA patterns and suggests rules from one that could benefit the other.
   *
   * @param dnaAName Name of the source DNA pattern
   * @param dnaBName Name of the target DNA pattern
   * @param similarityThreshold Minimum similarity score (0-1) for rule recommendation
   * @returns Suggestion results with confidence scores and rationale
   */
  suggestCrossDNATransfer(
    dnaAName: string,
    dnaBName: string,
    similarityThreshold: number = 0.5,
  ): {
    sourceDna: DNA;
    targetDna: DNA;
    suggestions: Array<{
      ruleId: string;
      confidence: number;
      rationale: string;
      suggestedAction: 'block' | 'escalate' | 'warn' | 'log' | 'transform';
      suggestedConditions?: Array<{ type: string; value: unknown }>;
    }>;
    overallSimilarity: number;
    recommendation: 'adopt' | 'adapt' | 'reject';
  } {
    // Get both DNAs
    const dnaA = this.dynamicDNAs.get(dnaAName);
    const dnaB = this.dynamicDNAs.get(dnaBName);
    if (!dnaA || !dnaB) {
      return {
        sourceDna: {} as DNA,
        targetDna: {} as DNA,
        suggestions: [],
        overallSimilarity: 0,
        recommendation: 'reject',
      };
    }

    const baseA = dnaA.baseDna;
    const baseB = dnaB.baseDna;

    // Calculate similarity based on governance rules overlap
    const sourceGov = baseA.governance.map((g) => g.id);
    const targetGov = baseB.governance.map((g) => g.id);
    const commonRules = sourceGov.filter((id) => targetGov.includes(id));
    const uniqueToA = sourceGov.filter((id) => !targetGov.includes(id));
    const uniqueToB = targetGov.filter((id) => !sourceGov.includes(id));
    void uniqueToA;
    void uniqueToB;

    const totalRules = sourceGov.length + targetGov.length;
    const similarRules = commonRules.length;
    const overlapRatio = totalRules > 0 ? similarRules / totalRules : 0;

    const overallSimilarity = Math.min(overlapRatio + 0.2, 1);

    const suggestions: Array<{
      ruleId: string;
      confidence: number;
      rationale: string;
      suggestedAction: 'block' | 'escalate' | 'warn' | 'log' | 'transform';
      suggestedConditions?: Array<{ type: string; value: unknown }>;
    }> = [];

    // Generate suggestions from DNA A rules not in DNA B
    for (const rule of baseA.governance) {
      if (!targetGov.includes(rule.id)) {
        const confidence = Math.max(0, overlapRatio + 0.2 * (1 - overlapRatio));
        if (confidence >= similarityThreshold) {
          suggestions.push({
            ruleId: rule.id,
            confidence: Math.round(confidence * 100) / 100,
            rationale: rule.description
              ? `Rule "${rule.id}" from ${dnaAName} could strengthen ${dnaBName} governance. ${rule.description}`
              : `Rule "${rule.id}" from ${dnaAName} could strengthen ${dnaBName} governance.`,
            suggestedAction: rule.action,
            suggestedConditions: rule.conditions,
          });
        }
      }
    }

    // Sort by confidence descending
    suggestions.sort((a, b) => b.confidence - a.confidence);

    // Limit to top 5 suggestions
    const topSuggestions = suggestions.slice(0, 5);

    let recommendation: 'adopt' | 'adapt' | 'reject';
    if (overallSimilarity > 0.7 && topSuggestions.length > 0) {
      recommendation = 'adopt';
    } else if (overallSimilarity > 0.3) {
      recommendation = 'adapt';
    } else {
      recommendation = 'reject';
    }

    return {
      sourceDna: baseA,
      targetDna: baseB,
      suggestions: topSuggestions,
      overallSimilarity: Math.round(overallSimilarity * 100) / 100,
      recommendation,
    };
  }
}
