import type { DNA } from '@behavior-os/schemas';

/**
 * Natural Language Rules Engine — parses human-readable governance rules
 * and converts them to structured DNA governance constraints.
 *
 * Supports common patterns like:
 * - "Block action X when condition Y" → { action: 'block', conditions: [{ type: 'Y', value: true }] }
 * - "Warn before Z if context has W" → { action: 'warn', conditions: [...] }
 * - "Require approval for sensitive operations" → { action: 'require', ... }
 */

export interface ParsedRule {
  id: string;
  action: 'block' | 'escalate' | 'warn' | 'log' | 'transform' | 'require';
  level: 'critical' | 'high' | 'medium' | 'low';
  conditions: Array<{ type: string; value: unknown }>;
  description: string;
  confidence: number;
}

export interface ParseResult {
  success: boolean;
  rule?: ParsedRule;
  error?: string;
  alternatives?: string[];
}

export interface NaturalLanguageRule {
  /** Original natural language text. */
  source: string;
  /** Parsed structured rule. */
  rule: ParsedRule;
  /** Timestamp of parsing. */
  parsedAt: string;
  /** Confidence score of the parse (0-1). */
  confidence: number;
}

// Pattern matchers for common rule structures
const PATTERNS: Array<{
  name: string;
  regex: RegExp;
  parse: (match: RegExpMatchArray) => Omit<ParsedRule, 'id'> & { id?: string };
}> = [
  {
    name: 'block-when',
    regex: /^block\s+(.+?)\s+when\s+(.+?)(?:\s+if\s+(.+))?$/i,
    parse: (match) => ({
      action: 'block',
      level: 'high',
      conditions: [{ type: 'context', value: match[2] }],
      description: `Block ${match[1].trim()} when ${match[2].trim()}`,
      confidence: 0.9,
      ...(match[3]
        ? {
            conditions: [
              { type: 'context', value: match[2] },
              { type: 'context', value: match[3] },
            ],
          }
        : {}),
    }),
  },
  {
    name: 'require-approval',
    regex: /^require\s+(?:approval|signoff)\s+for\s+(.+)$/i,
    parse: (match) => ({
      action: 'escalate',
      level: 'medium',
      conditions: [{ type: 'context', value: match[1].trim() }],
      description: `Require approval for ${match[1].trim()}`,
      confidence: 0.85,
    }),
  },
  {
    name: 'warn-before',
    regex: /^warn\s+(?:before|when)\s+(.+?)\s+if\s+(.+)$/i,
    parse: (match) => ({
      action: 'warn',
      level: 'medium',
      conditions: [{ type: 'context', value: match[2].trim() }],
      description: `Warn before ${match[1].trim()} if ${match[2].trim()}`,
      confidence: 0.8,
    }),
  },
  {
    name: 'allow-if',
    regex: /^allow\s+(.+?)\s+if\s+(.+)$/i,
    parse: (match) => ({
      action: 'log',
      level: 'low',
      conditions: [{ type: 'context', value: match[2].trim() }],
      description: `Allow ${match[1].trim()} if ${match[2].trim()}`,
      confidence: 0.75,
    }),
  },
  {
    name: 'never-permit',
    regex: /^(?:never|prohibit|forbid)\s+(.+)$/i,
    parse: (match) => ({
      action: 'block',
      level: 'critical',
      conditions: [{ type: 'context', value: match[1].trim() }],
      description: `Never permit ${match[1].trim()}`,
      confidence: 0.95,
    }),
  },
  {
    name: 'must-have',
    regex: /^must\s+(?:have|ensure)\s+(.+)$/i,
    parse: (match) => ({
      action: 'escalate',
      level: 'high',
      conditions: [{ type: 'context', value: match[1].trim() }],
      description: `Must have/ensure ${match[1].trim()}`,
      confidence: 0.85,
    }),
  },
  {
    name: 'log-all',
    regex: /^log\s+(?:all\s+)?(.+?)$/i,
    parse: (match) => ({
      action: 'log',
      level: 'low',
      conditions: [],
      description: `Log all ${match[1].trim()}`,
      confidence: 0.7,
    }),
  },
];

// Keywords to action mapping
const ACTION_KEYWORDS: Array<{
  keyword: string;
  action: 'block' | 'escalate' | 'warn' | 'log' | 'transform' | 'require';
}> = [
  { keyword: 'block', action: 'block' },
  { keyword: 'prohibit', action: 'block' },
  { keyword: 'forbid', action: 'block' },
  { keyword: 'require', action: 'require' },
  { keyword: 'warn', action: 'warn' },
  { keyword: 'log', action: 'log' },
  { keyword: 'alert', action: 'warn' },
];

// Keywords to level mapping
const LEVEL_KEYWORDS: Array<{ keyword: string; level: 'critical' | 'high' | 'medium' | 'low' }> = [
  { keyword: 'critical', level: 'critical' },
  { keyword: 'high', level: 'high' },
  { keyword: 'medium', level: 'medium' },
  { keyword: 'low', level: 'low' },
  { keyword: 'info', level: 'low' },
];

/**
 * Natural Language Rules Engine — parses human-readable governance rules
 * and converts them to structured DNA governance constraints.
 */
export class NaturalLanguageEngine {
  /**
   * Parse a natural language governance rule into structured form.
   *
   * Examples:
   * - "Block production deploys when tests are failing" → block rule
   * - "Require approval for mainnet transactions" → require rule
   * - "Warn before large transfers if amount > 10000" → warn rule
   * - "Never merge code without code review" → critical block rule
   */
  parseRule(source: string, options: { ruleId?: string } = {}): ParseResult {
    const normalized = source.trim().toLowerCase();

    for (const pattern of PATTERNS) {
      const match = normalized.match(pattern.regex);
      if (match) {
        const parsed = pattern.parse(match);
        return {
          success: true,
          rule: {
            id: options.ruleId ?? `nl-${Date.now()}`,
            action: parsed.action,
            level: parsed.level,
            conditions: parsed.conditions,
            description: parsed.description ?? source.trim(),
            confidence: parsed.confidence,
          },
        };
      }
    }

    // Fallback: keyword-based parsing
    const actionResult = parseByKeyword(source);
    if (actionResult) {
      return {
        success: true,
        rule: {
          id: options.ruleId ?? `nl-${Date.now()}`,
          action: actionResult.action,
          level: actionResult.level,
          conditions: actionResult.conditions,
          description: source.trim(),
          confidence: 0.6,
        },
      };
    }

    return {
      success: false,
      error: `Unable to parse rule: "${source.trim()}"`,
      alternatives: [
        'Try: "Block <action> when <condition>"',
        'Try: "Require approval for <action>"',
        'Try: "Warn before <action> if <condition>"',
        'Try: "Never <action>"',
        'Try: "Must have <condition>"',
      ],
    };
  }

  /**
   * Parse multiple rules from a single text block.
   */
  parseRulesBatch(sources: string[]): Array<NaturalLanguageRule> {
    const results: Array<NaturalLanguageRule> = [];

    for (const source of sources) {
      const result = this.parseRule(source);
      if (result.success && result.rule) {
        results.push({
          source: source.trim(),
          rule: result.rule,
          parsedAt: new Date().toISOString(),
          confidence: result.rule.confidence,
        });
      }
    }

    return results;
  }

  /**
   * Generate a human-readable description from a structured rule.
   */
  ruleToNaturalLanguage(rule: ParsedRule): string {
    const conditionStr = rule.conditions.map((c) => `${c.type}=${c.value}`).join(', ');
    return `${capitalize(rule.action)} rule '${rule.id}' ${conditionStr ? `when ${conditionStr}` : ''}`;
  }

  /**
   * Apply natural language rules to a DNA pattern.
   * Returns a new DNA with the parsed rules added.
   */
  applyRules(
    dna: DNA,
    sources: string[],
  ): { dna: DNA; applied: NaturalLanguageRule[]; errors: string[] } {
    const results = this.parseRulesBatch(sources);
    const errors: string[] = [];

    // Filter by confidence threshold
    const applicable = results.filter((r) => r.confidence > 0.5);

    for (const result of results) {
      if (result.confidence <= 0.5) {
        errors.push(
          `Low confidence rule skipped: "${result.source}" (confidence: ${result.confidence})`,
        );
      }
    }

    // Add rules to DNA governance
    const governance = [...(dna.governance ?? [])];
    for (const result of applicable) {
      // Map 'require' action to 'escalate' for DNA compatibility
      const action = result.rule.action === 'require' ? 'escalate' : result.rule.action;
      governance.push({
        id: result.rule.id,
        level: result.rule.level,
        action,
        conditions: result.rule.conditions,
        description: result.rule.description,
      });
    }

    return {
      dna: { ...dna, governance },
      applied: applicable,
      errors,
    };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fallback keyword-based parser. */
function parseByKeyword(source: string): {
  action: 'block' | 'escalate' | 'warn' | 'log' | 'transform' | 'require';
  level: 'critical' | 'high' | 'medium' | 'low';
  conditions: Array<{ type: string; value: unknown }>;
} | null {
  const normalized = source.toLowerCase();

  // Find action keyword
  const action = ACTION_KEYWORDS.find((kw) => normalized.includes(kw.keyword));
  if (!action) return null;

  // Map 'require' to 'escalate' for compatibility with GovernanceAction
  const mappedAction = action.action === 'require' ? 'escalate' : action.action;

  // Find level keyword
  const level =
    LEVEL_KEYWORDS.find((kw) => normalized.includes(kw.keyword))?.level ??
    (mappedAction === 'block' ? 'high' : 'medium');

  // Extract context conditions
  const contextTypes: string[] = [];
  if (normalized.includes('when')) contextTypes.push('when-condition');
  if (normalized.includes('if')) contextTypes.push('if-condition');
  if (normalized.includes('before')) contextTypes.push('before-condition');
  if (normalized.includes('without')) contextTypes.push('absence-condition');

  return {
    action: mappedAction,
    level,
    conditions:
      contextTypes.length > 0
        ? contextTypes.map((type) => ({ type, value: true }))
        : [{ type: 'any', value: true }],
  };
}
