/**
 * Autonomous-mode guard (headless / no-human-on-loop).
 *
 * In headless mode the interaction model changes: there is no "ask" fallback
 * because no human is reviewing prompts. Governance becomes:
 *
 *   pré-decisão total  →  permissions[] + deny final + veto no `execute.before`
 *   observabilidade    →  auditoria contínua + quotas em `ctx.storage`
 *
 * This module exports three cooperating subsystems:
 *
 * 1. **AutonomousDenyList** — regex-based deny patterns that catch dangerous
 *    constructs even when invoked indirectly (`bash -c "nft cmd"`, `node -e`,
 *    `eval`, `child_process.execSync`, etc.). The veto runs in
 *    `ctx.tool.hook("execute.before")` and *throws* to cancel the tool call.
 *
 * 2. **QuotaBreaker** — a per-session circuit breaker persisted in `ctx.storage`.
 *    Enforces soft limits (e.g. max 20 bash calls per session) and opens a
 *    tripwire that escalates remaining calls to a hard deny.
 *
 * 3. **DoomLoopGuard** — tracks consecutive denials of similar actions per
 *    session. Once a threshold is crossed, it forces a permanent block and
 *    emits a human-urgent notification, breaking the agent's retry cycle.
 */
import type { StorageDomain } from '@opencode/plugin/promise/storage';
import type { Schema } from 'effect';

/** JSON-round-trip a value so only persistable values reach storage. */
function toStorageJson(value: unknown): Schema.Json {
  return JSON.parse(JSON.stringify(value)) as Schema.Json;
}

// ─── 1. Autonomous Deny-List ────────────────────────────────────────────────

/**
 * Patterns that indicate a command or script invocation is attempting to
 * bypass governance through indirection. We block by *pattern*, not by a
 * closed command list — the model is too creative for that.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<{
  label: string;
  test: (tool: string, input: unknown) => boolean;
}> = [
  {
    label: 'bash -c / sh -c indirection',
    test: (tool, input) => {
      if (tool !== 'bash') return false;
      const cmd = (input as { command?: string })?.command ?? '';
      return (
        /\b(c\b|--|-c)\s*$/.test(cmd.slice(0, 5)) ||
        cmd.includes('bash -c') ||
        cmd.includes('sh -c')
      );
    },
  },
  {
    label: 'node -e / node -p code injection',
    test: (tool, input) => {
      if (tool !== 'bash') return false;
      const cmd = (input as { command?: string })?.command ?? '';
      return /node\s+-[ep]\s/.test(cmd) || /node\s+--eval\s/.test(cmd);
    },
  },
  {
    label: 'eval / Function constructor',
    test: (_tool, input) => {
      const code = JSON.stringify(input);
      return /["'`]\s*eval\s*\(/.test(code) || /new\s+Function\s*\(/.test(code);
    },
  },
  {
    label: 'child_process / subprocess escape',
    test: (_tool, input) => {
      const code = JSON.stringify(input);
      return (
        /require\s*\(\s*["']child_process["']/.test(code) ||
        /process\.mainModule\.require/.test(code)
      );
    },
  },
  {
    label: 'reverse shell / network exfil',
    test: (tool, input) => {
      if (tool !== 'bash') return false;
      const cmd = (input as { command?: string })?.command ?? '';
      return /(\|\s*nc\b|curl\s+http|wget\s+http|base64\s+-d\b|python\s+-c\b)/i.test(cmd);
    },
  },
];

/**
 * Evaluate a tool call against the deny-list. Returns the label of the first
 * matched pattern (indicating denial) or `null` if the call is clean.
 */
export function evaluateDenyList(tool: string, input: unknown): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(tool, input)) return pattern.label;
  }
  return null;
}

// ─── 2. Quota Circuit Breaker ───────────────────────────────────────────────

const DEFAULT_BASH_QUOTA = 20;
const STORAGE_PREFIX = 'behavioros:quota:';

interface QuotaState {
  bashCount: number;
  shellCount: number;
  tripwire: boolean;
  firstCall: number;
}

/**
 * Per-session quota tracker backed by `ctx.storage`.
 *
 * Each session gets its own counter namespace. When the quota is exceeded,
 * the `tripwire` flag is set and subsequent calls are denied.
 */
export class QuotaBreaker {
  private storage: StorageDomain;
  private quotas: Map<string, QuotaState> = new Map();
  private bashLimit: number;

  constructor(storage: StorageDomain, bashLimit = DEFAULT_BASH_QUOTA) {
    this.storage = storage;
    this.bashLimit = bashLimit;
  }

  /**
   * Check a tool invocation against the session quota. Returns `null` if
   * allowed, or a reason string if the quota has been tripped.
   */
  async check(sessionID: string, tool: string): Promise<string | null> {
    const key = `${STORAGE_PREFIX}${sessionID}`;
    const existing = await this.storage.get(key);
    const state: QuotaState =
      existing && typeof existing === 'object'
        ? (existing as unknown as QuotaState)
        : { bashCount: 0, shellCount: 0, tripwire: false, firstCall: Date.now() };

    // If already tripped, deny everything
    if (state.tripwire) return 'quota: tripwire active — session limit exceeded';

    // Increment counters for shell tools
    const normalizedTool = tool.toLowerCase();
    if (normalizedTool === 'bash' || normalizedTool === 'shell') {
      state.bashCount += 1;
      if (state.bashCount > this.bashLimit) {
        state.tripwire = true;
        await this.storage.set(key, toStorageJson(state));
        return `quota: ${this.bashLimit} shell calls exceeded for session ${sessionID}`;
      }
    }

    await this.storage.set(key, toStorageJson(state));
    this.quotas.set(sessionID, state);
    return null;
  }

  /** Cleanup: remove a session's quota when it ends. */
  async reset(sessionID: string): Promise<void> {
    const key = `${STORAGE_PREFIX}${sessionID}`;
    await this.storage.remove(key);
    this.quotas.delete(sessionID);
  }
}

// ─── 3. Doom Loop Guard ─────────────────────────────────────────────────────

const DOOM_LOOP_THRESHOLD = 3;

interface DenialRecord {
  action: string;
  reason: string;
  timestamp: number;
  count: number;
}

/**
 * Prevents agents from spinning in a "doom loop" — repeatedly attempting an
 * action that keeps getting denied/escalated.
 *
 * Tracks consecutive denials of the same action pattern per session. Once the
 * threshold is crossed, the guard escalates to a *permanent block* and emits
 * a human-urgent notification, breaking the retry cycle.
 */
export class DoomLoopGuard {
  private violations: Map<string, DenialRecord[]> = new Map();

  /**
   * Record a denial. Returns `true` if the doom-loop threshold was crossed
   * (i.e., the action should now be permanently blocked).
   */
  recordDenial(sessionID: string, action: string, reason: string): boolean {
    const records = this.violations.get(sessionID) ?? [];

    // Find an existing record for the same action *pattern* (not exact match,
    // since the model may append timestamps or IDs).
    const pattern = normalizeAction(action);
    const existing = records.find((r) => normalizeAction(r.action) === pattern);

    if (existing) {
      existing.count += 1;
      existing.timestamp = Date.now();
      existing.reason = reason;
    } else {
      records.push({ action, reason, timestamp: Date.now(), count: 1 });
    }

    // Cap history to prevent unbounded growth
    if (records.length > 50) records.shift();

    this.violations.set(sessionID, records);

    return existing ? existing.count >= DOOM_LOOP_THRESHOLD : false;
  }

  /**
   * Check if an action should be permanently blocked due to doom-loop detection.
   */
  isBlocked(sessionID: string, action: string): boolean {
    const records = this.violations.get(sessionID);
    if (!records) return false;
    const pattern = normalizeAction(action);
    const record = records.find((r) => normalizeAction(r.action) === pattern);
    return record !== undefined && record.count >= DOOM_LOOP_THRESHOLD;
  }

  /**
   * Get the reason for a permanent block, if any.
   */
  getBlockReason(sessionID: string, action: string): string | undefined {
    const records = this.violations.get(sessionID);
    if (!records) return undefined;
    const pattern = normalizeAction(action);
    const record = records.find((r) => normalizeAction(r.action) === pattern);
    if (!record || record.count < DOOM_LOOP_THRESHOLD) return undefined;
    return `doom_loop: ${record.count} consecutive denials of similar action — permanently blocked`;
  }

  reset(sessionID: string): void {
    this.violations.delete(sessionID);
  }
}

/** Normalize an action to a comparable pattern (strips timestamps, IDs). */
function normalizeAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/\b\d{10,}\b/g, '') // unix timestamps
    .replace(/[0-9a-f]{8,}/g, '') // hex ids
    .trim();
}
