import type {
  DNA,
  GovernanceDecision,
  GovernanceRule,
  GovernanceVerdict,
} from '@behavior-os/schemas';

export interface EvaluateContext {
  action: string;
  agentId: string;
  context: Record<string, unknown>;
  missionId?: string;
}

/**
 * A DNA-independent floor for irreversible actions.
 *
 * Governance rules live in the active DNA, and the host may re-select that DNA
 * from the prompt's intent. A permissive pattern must not be able to turn an
 * irreversible operation into an `allow`, so these classifications escalate
 * *after* the DNA rules ran: a DNA may add a `deny` (which always wins) but it
 * can never remove this floor.
 */
export type SafetyFloorKind =
  | 'deployment'
  | 'production-change'
  | 'destructive'
  | 'secret-exposure';

const SAFETY_FLOOR_RULE_ID = 'safety-floor';

const DEPLOY_VERBS = new Set([
  'deploy',
  'deployment',
  'release',
  'rollout',
  'promote',
  'publish',
  'ship',
]);
const DESTRUCTIVE_VERBS = new Set([
  'delete',
  'del',
  'destroy',
  'drop',
  'truncate',
  'purge',
  'wipe',
  'erase',
  'uninstall',
  'rm',
  'rmdir',
  'rd',
  'format',
  'remove-item',
]);
const SECRET_VERBS = new Set(['secrets', 'secret', 'credentials', 'credential', 'keychain']);

/** Action/tool names whose arguments are a command line rather than data. */
const EXECUTION_TOOLS = new Set([
  'bash',
  'shell',
  'sh',
  'zsh',
  'powershell',
  'pwsh',
  'cmd',
  'terminal',
  'exec',
  'execute',
  'run',
  'spawn',
  'command',
  'process',
]);

/** Read the host's command text from the common context keys. */
function executionCommand(action: string, context: Record<string, unknown>): string | null {
  const head = action.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const tool = typeof context.tool === 'string' ? context.tool.toLowerCase() : '';
  // Only execution tools expose a command. A read-only tool's arguments are
  // data and are never scanned (C24).
  if (!EXECUTION_TOOLS.has(head) && !EXECUTION_TOOLS.has(tool)) return null;

  const raw = context.command ?? context.commandLine ?? context.script ?? context.args;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = raw.filter((part): part is string => typeof part === 'string');
    return parts.length > 0 ? parts.join(' ') : null;
  }
  return null;
}

/**
 * Classify an irreversible operation hidden inside a shell command.
 *
 * Only the command position of each segment counts, so `grep deploy README.md`
 * stays read-only while `git push` or `sudo kubectl delete` does not.
 */
export function classifyIrreversibleCommand(command: string, depth = 0): SafetyFloorKind | null {
  for (const rawSegment of command.split(/&&|\|\||[;|\n]/)) {
    let segment = rawSegment.trim().toLowerCase();
    if (segment.length === 0) continue;
    // Strip wrappers that keep the real command in the next position.
    segment = segment.replace(/^(?:sudo|env|nohup|time|command|exec|builtin)\s+/, '');

    // Nested interpreter payloads: `bash -c "git push"`, `cmd /c "del ..."`,
    // `eval "terraform apply"`. Bounded recursion so a crafted chain cannot
    // spin the classifier.
    const nested = /^(?:bash|sh|zsh|pwsh|powershell|cmd)\s+(?:-c|\/c|-command)\s+(.+)$/.exec(
      segment,
    );
    const evaluated = /^eval\s+(.+)$/.exec(segment);
    const payload = nested?.[1] ?? evaluated?.[1];
    if (payload !== undefined && depth < 3) {
      const inner = payload.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
      const innerKind = classifyIrreversibleCommand(inner, depth + 1);
      if (innerKind) return innerKind;
    }

    const head = segment.split(/\s+/)[0] ?? '';

    if (DEPLOY_VERBS.has(head)) return 'deployment';
    if (DESTRUCTIVE_VERBS.has(head)) return 'destructive';

    if (/^git\s+push\b/.test(segment)) return 'deployment';
    if (/^git\s+tag\s+-d\b/.test(segment)) return 'destructive';
    if (/^(?:npm|pnpm|yarn|bun)\s+publish\b/.test(segment)) return 'deployment';
    if (/^kubectl\s+delete\b/.test(segment)) return 'destructive';
    if (/^kubectl\s+(?:apply|create|replace|rollout|scale)\b/.test(segment)) {
      return 'deployment';
    }
    if (/^terraform\s+destroy\b/.test(segment)) return 'destructive';
    if (/^terraform\s+apply\b/.test(segment)) return 'deployment';
    if (/^docker\s+(?:rm|rmi|system\s+prune)\b/.test(segment)) return 'destructive';
    if (/^docker\s+push\b/.test(segment)) return 'deployment';
    if (/^helm\s+(?:upgrade|install)\b/.test(segment)) return 'deployment';
    if (/^helm\s+(?:uninstall|delete)\b/.test(segment)) return 'destructive';
    if (/^reg\s+delete\b/.test(segment)) return 'destructive';
  }
  return null;
}

/**
 * Classify an action as irreversible from its *verb*, from explicit context
 * flags, or from the command line of an execution tool. Arguments of read-only
 * tools are deliberately not scanned: a search that mentions "deploy" is not a
 * deployment (C24).
 */
export function classifyIrreversibleAction(
  action: string,
  context: Record<string, unknown>,
): SafetyFloorKind | null {
  const flags = context ?? {};
  if (flags.deployment === true) return 'deployment';
  if (flags['production-change'] === true || flags.production === true) {
    return 'production-change';
  }
  if (flags.destructive === true) return 'destructive';
  if (flags['secret-access'] === true || flags['secret-exposure'] === true) {
    return 'secret-exposure';
  }

  const normalized = action.trim().toLowerCase();
  if (normalized.length === 0) return null;
  const head = normalized.split(/\s+/)[0] ?? '';

  if (DEPLOY_VERBS.has(head)) return 'deployment';
  if (DESTRUCTIVE_VERBS.has(head)) return 'destructive';
  if (SECRET_VERBS.has(head)) return 'secret-exposure';

  // Compound commands that deploy even though the head is not a deploy verb.
  if (/^git\s+push\b/.test(normalized)) return 'deployment';
  if (/^kubectl\s+(apply|delete|rollout)\b/.test(normalized)) return 'deployment';
  if (/^terraform\s+(apply|destroy)\b/.test(normalized)) return 'deployment';
  if (/^docker\s+push\b/.test(normalized)) return 'deployment';

  // Defense in depth when the host did not derive a flag: inspect the command
  // of an execution tool, never the arguments of a read-only tool.
  const command = executionCommand(action, flags);
  if (command) {
    const commandKind = classifyIrreversibleCommand(command);
    if (commandKind) return commandKind;
  }

  return null;
}

export class GovernanceEngine {
  private rules: GovernanceRule[];
  private decisionCache: Map<string, GovernanceDecision & { _createdAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(dna: DNA) {
    this.rules = dna.governance;
  }

  evaluate(context: EvaluateContext): GovernanceDecision {
    const cacheKey = `${context.action}|${context.agentId}|${JSON.stringify(context.context)}`;

    // Check cache with TTL
    const cached = this.decisionCache.get(cacheKey);
    if (cached) {
      if (Date.now() - cached._createdAt < this.CACHE_TTL_MS) {
        return this.stripInternalFields(cached);
      }
      this.decisionCache.delete(cacheKey);
    }

    const evaluatedRules: string[] = [];
    const firedRules: string[] = [];
    let verdict: GovernanceVerdict = 'allow';
    let reason = 'No rules violated';
    let transformed = false;
    const warnings: string[] = [];

    // Sort rules by level for priority processing
    const sortedRules = [...this.rules].sort((a, b) => {
      const levelOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (levelOrder[b.level] ?? 0) - (levelOrder[a.level] ?? 0);
    });

    for (const rule of sortedRules) {
      evaluatedRules.push(rule.id);
      const matches = this.evaluateConditions(rule.conditions, context.context);

      if (matches) {
        firedRules.push(rule.id);
        switch (rule.action) {
          case 'block':
            verdict = 'deny';
            reason = `Blocked by rule: ${rule.id} (${rule.description || rule.level})`;
            break;
          case 'escalate':
            if (verdict !== 'deny') {
              verdict = 'escalate';
              reason = `Escalated by rule: ${rule.id}`;
            }
            break;
          case 'warn':
            warnings.push(`Warning from rule: ${rule.id}`);
            if (verdict === 'allow') {
              reason = warnings.join('; ');
            }
            break;
          case 'log':
            // Log only - no verdict change
            break;
          case 'transform':
            transformed = true;
            break;
        }
      }
    }

    // Safety floor: irreversible actions can never be an unconditional allow,
    // regardless of which DNA pattern is active. A DNA `deny`/`escalate` stays
    // authoritative; the floor only raises an `allow` to `escalate`.
    const safetyFloor = classifyIrreversibleAction(context.action, context.context);
    if (safetyFloor && verdict === 'allow') {
      verdict = 'escalate';
      reason = `Escalated by safety floor: irreversible ${safetyFloor} requires human approval`;
      evaluatedRules.push(SAFETY_FLOOR_RULE_ID);
      firedRules.push(SAFETY_FLOOR_RULE_ID);
      warnings.push(`Safety floor: ${safetyFloor} is irreversible and DNA-independent`);
    }

    const result: GovernanceDecision = {
      id: `gov-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action: context.action,
      verdict,
      reason,
      rulesEvaluated: evaluatedRules,
      ...(firedRules.length > 0 ? { firedRules } : {}),
      timestamp: new Date().toISOString(),
      agentId: context.agentId,
      missionId: context.missionId,
      warnings: warnings.length > 0 ? warnings : undefined,
      ...(transformed ? { transformed: true } : {}),
    };

    this.decisionCache.set(cacheKey, { ...result, _createdAt: Date.now() });
    return result;
  }

  evaluateConditions(
    conditions: Array<{ type: string; value: unknown }>,
    context: Record<string, unknown>,
  ): boolean {
    return conditions.every((cond) => {
      const ctxValue = context[cond.type];
      const condValue = cond.value;

      // Handle numeric comparisons (>= for thresholds)
      if (typeof condValue === 'number' && typeof ctxValue === 'number') {
        return ctxValue >= condValue;
      }

      // Handle boolean comparisons
      if (typeof condValue === 'boolean') {
        return ctxValue === condValue;
      }

      // Handle string comparisons
      if (typeof condValue === 'string') {
        return ctxValue === condValue;
      }

      // Default to strict equality
      return ctxValue === condValue;
    });
  }

  getRules(): GovernanceRule[] {
    return this.rules;
  }

  addRule(rule: GovernanceRule): void {
    this.rules.push(rule);
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  clearCache(): void {
    this.decisionCache.clear();
  }

  private stripInternalFields(
    entry: GovernanceDecision & { _createdAt: number },
  ): GovernanceDecision {
    const { _createdAt, ...clean } = entry;
    return clean;
  }
}
