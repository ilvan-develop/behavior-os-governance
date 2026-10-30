import type { ComplianceMap, ComplianceStatus, GovernanceRule } from '@behavior-os/schemas';

/**
 * G-016: Regulatory Compliance Mapper Engine.
 *
 * Maps DNA governance rules to regulatory requirements (GDPR, SOX, HIPAA,
 * etc.) and tracks compliance status with audit evidence.
 */
export class ComplianceMapperEngine {
  /** Known regulations with their rule patterns. */
  private regulationPatterns = new Map<string, { pattern: RegExp; regulation: string }>();
  /** Compliance maps keyed by regulation name. */
  private maps = new Map<string, ComplianceMap>();

  /**
   * Register a known regulation with a regex that identifies
   * governance rules that map to it.
   */
  registerRegulation(regulation: string, rulePattern: RegExp): void {
    this.regulationPatterns.set(regulation, { pattern: rulePattern, regulation });
  }

  /**
   * Map the current DNA's governance rules to known regulations.
   *
   * For each registered regulation, scans the governance rules and
   * matches rule ids / descriptions against the regulation's pattern.
   */
  mapRules(governanceRules: GovernanceRule[], regulationNames: string[] = []): ComplianceMap[] {
    const names =
      regulationNames.length > 0 ? regulationNames : [...this.regulationPatterns.keys()];
    const result: ComplianceMap[] = [];

    for (const name of names) {
      const reg = this.regulationPatterns.get(name);
      if (!reg) continue;

      const matchedRules = governanceRules.filter((rule) => {
        const haystack = `${rule.id} ${rule.description ?? ''}`;
        return reg.pattern.test(haystack);
      });

      const matchedIds = matchedRules.map((r) => r.id);
      const evidence = matchedRules.map((r) => `Rule ${r.id}: ${r.description ?? ''}`);

      // Score: fraction of matched rules that have a block/escalate action.
      const blockingCount = matchedRules.filter(
        (r) => r.action === 'block' || r.action === 'escalate',
      ).length;
      const score = matchedIds.length > 0 ? blockingCount / matchedIds.length : 0;

      let status: ComplianceStatus = 'compliant';
      if (matchedIds.length === 0) status = 'violation';
      else if (score < 0.5) status = 'at-risk';

      result.push({
        id: `compliance-${name.replace(/\s+/g, '-')}-${Date.now()}`,
        regulation: name,
        rules: matchedIds,
        evidence,
        lastAudit: new Date().toISOString(),
        status,
        score: Math.round(score * 100) / 100,
      });
    }

    return result;
  }

  /**
   * Save or update a compliance map.
   */
  setComplianceMap(map: ComplianceMap): void {
    this.maps.set(map.regulation, map);
  }

  /**
   * Get the latest compliance map for a regulation.
   */
  getComplianceMap(regulation: string): ComplianceMap | undefined {
    return this.maps.get(regulation);
  }

  /**
   * Get all saved compliance maps.
   */
  getAllMaps(): ComplianceMap[] {
    return [...this.maps.values()];
  }

  /**
   * Check overall compliance status across all known regulations.
   *
   * Returns `compliant` if all maps are compliant,
   * `at-risk` if any are at-risk,
   * `violation` if any are in violation.
   */
  overallStatus(): ComplianceStatus {
    const maps = this.getAllMaps();
    if (maps.length === 0) return 'compliant';
    const statuses = maps.map((m) => m.status);
    if (statuses.includes('violation')) return 'violation';
    if (statuses.includes('at-risk')) return 'at-risk';
    return 'compliant';
  }
}

export type { ComplianceMap, ComplianceStatus };
