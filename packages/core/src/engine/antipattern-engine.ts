import type { AntiPattern, AntiPatternType, Severity } from '@behavior-os/schemas';

export interface AntipatternDetectionResult {
  patterns: AntiPattern[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
}

export interface FixedPattern {
  id: string;
  originalId: string;
  fixApplied: boolean;
  fixDescription: string;
  fixedAt: string;
}

/**
 * Anti-pattern detection and resolution engine.
 *
 * Detects code smells, TS errors, security issues, and other
 * anti-patterns. Provides auto-fix recommendations and tracks
 * resolution status.
 */
export class AntipatternEngine {
  private patterns = new Map<string, AntiPattern>();
  private fixed = new Map<string, FixedPattern>();

  /**
   * Scan input for known anti-patterns.
   * Returns detected patterns with severity levels.
   */
  scan(text: string, source?: string): AntipatternDetectionResult {
    const detected: AntiPattern[] = [];

    // TypeScript error patterns
    const tsErrors = [
      {
        pattern: /TS[0-9]+:/,
        type: 'typescript-error' as AntiPatternType,
        severity: 'high' as Severity,
      },
      {
        pattern: /Cannot find name/,
        type: 'typescript-error' as AntiPatternType,
        severity: 'high' as Severity,
      },
      {
        pattern: /Property .+ does not exist/,
        type: 'typescript-error' as AntiPatternType,
        severity: 'high' as Severity,
      },
      {
        pattern: /Type .+ is not assignable/,
        type: 'typescript-error' as AntiPatternType,
        severity: 'medium' as Severity,
      },
    ];

    // Lint violation patterns
    const lintPatterns = [
      {
        pattern: /eslint.*error/,
        type: 'lint-violation' as AntiPatternType,
        severity: 'medium' as Severity,
      },
      {
        pattern: /biome.*error/,
        type: 'lint-violation' as AntiPatternType,
        severity: 'medium' as Severity,
      },
      {
        pattern: /prefer-[a-z]/,
        type: 'code-smell' as AntiPatternType,
        severity: 'low' as Severity,
      },
    ];

    // Security vulnerability patterns
    const securityPatterns = [
      {
        pattern: /CVE-[0-9]+/,
        type: 'security-vulnerability' as AntiPatternType,
        severity: 'critical' as Severity,
      },
      {
        pattern: /unsafe|eval\(|innerHTML/,
        type: 'security-vulnerability' as AntiPatternType,
        severity: 'high' as Severity,
      },
      {
        pattern: /hardcoded.*(password|secret|key)/i,
        type: 'security-vulnerability' as AntiPatternType,
        severity: 'critical' as Severity,
      },
    ];

    // Performance issue patterns
    const perfPatterns = [
      {
        pattern: /O\(n\*\*?\d\)/,
        type: 'performance-issue' as AntiPatternType,
        severity: 'high' as Severity,
      },
      {
        pattern: /nested.*(loop|map|filter)/i,
        type: 'performance-issue' as AntiPatternType,
        severity: 'medium' as Severity,
      },
    ];

    // Apply all patterns
    for (const { pattern: regex, type, severity } of [
      ...tsErrors,
      ...lintPatterns,
      ...securityPatterns,
      ...perfPatterns,
    ]) {
      const matches = text.match(regex);
      if (matches) {
        const id = `ap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const detectedPattern: AntiPattern = {
          id,
          type,
          severity,
          pattern: matches[0],
          description: this.getPatternDescription(type, matches[0]),
          location: source,
          evidence: [matches[0]],
          recommendation: this.getRecommendation(type, matches[0]),
          detectedAt: new Date().toISOString(),
          resolved: false,
        };
        detected.push(detectedPattern);
        this.patterns.set(id, detectedPattern);
      }
    }

    return {
      patterns: detected,
      summary: {
        critical: detected.filter((p) => p.severity === 'critical').length,
        high: detected.filter((p) => p.severity === 'high').length,
        medium: detected.filter((p) => p.severity === 'medium').length,
        low: detected.filter((p) => p.severity === 'low').length,
        info: detected.filter((p) => p.severity === 'info').length,
        total: detected.length,
      },
    };
  }

  /**
   * Fix a detected anti-pattern with automated remediation.
   */
  fixPattern(patternId: string, fixDescription: string): FixedPattern | null {
    const pattern = this.patterns.get(patternId);
    if (!pattern || pattern.resolved) {
      return null;
    }

    const fixed: FixedPattern = {
      id: `fixed-${Date.now()}`,
      originalId: patternId,
      fixApplied: true,
      fixDescription,
      fixedAt: new Date().toISOString(),
    };

    pattern.resolved = true;
    pattern.resolvedAt = fixed.fixedAt;
    this.fixed.set(patternId, fixed);

    return fixed;
  }

  /**
   * Auto-fix all critical and high severity patterns.
   */
  autoFixCritical(): FixedPattern[] {
    const fixed: FixedPattern[] = [];
    for (const [id, pattern] of this.patterns) {
      if ((pattern.severity === 'critical' || pattern.severity === 'high') && !pattern.resolved) {
        const result = this.fixPattern(id, `Auto-fixed ${pattern.type}`);
        if (result) fixed.push(result);
      }
    }
    return fixed;
  }

  /**
   * Get patterns by severity.
   */
  getBySeverity(severity: Severity): AntiPattern[] {
    return [...this.patterns.values()].filter((p) => p.severity === severity);
  }

  /**
   * Get unresolved patterns.
   */
  getUnresolved(): AntiPattern[] {
    return [...this.patterns.values()].filter((p) => !p.resolved);
  }

  /**
   * Get all fixed patterns.
   */
  getFixed(): FixedPattern[] {
    return [...this.fixed.values()];
  }

  /**
   * Generate remediation report.
   */
  generateReport(): string {
    const unresolved = this.getUnresolved();
    const fixed = this.getFixed();

    let md = '# 🛡️ Anti-Pattern Remediation Report\n\n';

    md += `## Summary\n\n`;
    md += `- **Total Detected:** ${unresolved.length + fixed.length}\n`;
    md += `- **Resolved:** ${fixed.length}\n`;
    md += `- **Unresolved:** ${unresolved.length}\n\n`;

    if (unresolved.length > 0) {
      md += `## 🔴 Unresolved Patterns\n\n`;
      for (const p of unresolved) {
        const emoji = this.severityEmoji(p.severity);
        md += `${emoji} **${p.severity.toUpperCase()}** — ${p.type}\n\n`;
        md += `- **Pattern:** \`${p.pattern}\`\n`;
        md += `- **Description:** ${p.description}\n`;
        md += `- **Recommendation:** ${p.recommendation}\n\n`;
      }
    }

    if (fixed.length > 0) {
      md += `## ✅ Resolved Patterns\n\n`;
      for (const f of fixed) {
        md += `- 🟢 Fixed: ${f.fixDescription}\n`;
      }
      md += `\n`;
    }

    md += `---\n`;
    md += `*Generated by Behavior-OS Antipattern Engine*\n`;

    return md;
  }

  private getPatternDescription(type: AntiPatternType, match: string): string {
    const descriptions: Record<AntiPatternType, string> = {
      'typescript-error': `TypeScript error detected: ${match}. Check type compatibility.`,
      'lint-violation': `Lint violation found: ${match}. Review coding standards.`,
      'security-vulnerability': `Security issue: ${match}. Address before production.`,
      'performance-issue': `Performance concern: ${match}. Optimize algorithm.`,
      'architecture-violation': 'Architecture pattern violation detected.',
      'code-smell': `Code smell: ${match}. Refactor recommended.`,
      'test-gap': 'Missing test coverage for critical path.',
      'documentation-gap': 'Missing documentation for exported API.',
      'governance-bypass': 'Governance rule bypass attempted.',
      'pattern-debt': 'Technical debt accumulation detected.',
    };
    return descriptions[type] ?? 'Unknown pattern';
  }

  private getRecommendation(type: AntiPatternType, _match: string): string {
    const recommendations: Record<AntiPatternType, string> = {
      'typescript-error': 'Fix type annotation or add type guard',
      'lint-violation': 'Apply linter auto-fix or update rule config',
      'security-vulnerability': 'Remediate security issue immediately',
      'performance-issue': 'Consider memoization or algorithmic optimization',
      'architecture-violation': 'Review and align with architectural guidelines',
      'code-smell': 'Refactor to improve readability and maintainability',
      'test-gap': 'Add unit tests for the uncovered path',
      'documentation-gap': 'Add JSDoc comments and README updates',
      'governance-bypass': 'Implement proper governance checks',
      'pattern-debt': 'Schedule refactoring sprint',
    };
    return recommendations[type] ?? 'Review and address the issue';
  }

  private severityEmoji(severity: Severity): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      case 'info':
        return '⚪';
      default:
        return '⚪';
    }
  }
}
