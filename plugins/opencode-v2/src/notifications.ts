/**
 * Producer-side coalescing for plugin notifications.
 *
 * OpenCode admits synthetic messages with `delivery: 'queue'` when the session
 * yields, so one notice per governance decision can accumulate into a long
 * backlog during a busy turn chain. This module bounds that backlog at the
 * source: redundant notices for the same decision are collapsed, and a session
 * may enqueue at most a fixed number of notices per window.
 *
 * Duplicate suppression outlives a prompt window. A real user prompt resets the
 * cap window, but the decision identity is remembered for `dedupeTtlMs` so a
 * host that re-evaluates the same pending permission request cannot re-notify
 * it on every turn.
 *
 * Deliberately out of scope: the host inbox consumer. This module does not
 * acknowledge, expire, delete or replay inbox records, and it must never be
 * used to claim that a notice was delivered. Late delivery, delivery cursors
 * and dead letters remain a host concern.
 */

export const NOTIFICATION_STATE_VERSION = 2;

/**
 * How long the coalescer remembers a decision identity for duplicate
 * suppression. Independent of the per-window cap: a real user prompt resets
 * the cap window but must not let the host re-notify the same pending decision
 * on every turn.
 */
export const DEFAULT_DEDUPE_TTL_MS = 10 * 60_000;

/** Governance decision families that produce a user-visible notice. */
export type NotificationKind = 'deny' | 'escalate' | 'dna' | 'mission';

export interface NotificationIdentity {
  sessionID: string;
  kind: NotificationKind;
  /** Permission action or hook that produced the notice. */
  action: string;
  /** Decision reason. Normalised for comparison, never rewritten for output. */
  reason: string;
}

export type SuppressionReason = 'duplicate' | 'cap';

export interface NotificationDecision {
  send: boolean;
  key: string;
  at: number;
  suppressed?: SuppressionReason;
}

export interface NotificationStats {
  sent: number;
  suppressedDuplicate: number;
  suppressedCap: number;
}

export interface CoalescerOptions {
  /** Fixed window length in milliseconds; must be positive and finite. */
  windowMs: number;
  /** Maximum notices enqueued per session per window; positive integer. */
  maxPerWindow: number;
  /**
   * How long a decision identity is remembered for duplicate suppression,
   * independent of the per-window cap. Must be positive and finite.
   *
   * This survives `reset()` on a real user prompt: a host that re-evaluates the
   * same pending permission request cannot re-notify it on every turn. The cap
   * still resets per window, so genuinely new decisions are not blocked.
   */
  dedupeTtlMs?: number;
  /** Injectable clock, used by tests. */
  now?: () => number;
}

interface SessionState {
  windowStartedAt: number;
  sent: number;
  keys: Record<string, number>;
  suppressedDuplicate: number;
  suppressedCap: number;
}

export interface CoalescerSnapshot {
  version: typeof NOTIFICATION_STATE_VERSION;
  sessions: Record<string, SessionState>;
  /**
   * Monotonic counter of notices ever sent by this coalescer instance. Used to
   * detect consumer-side losses across restarts: if the restored total is less
   * than what the host inbox reports as delivered, notices were dropped.
   * Incremented on every `take()` that returns `send: true`.
   */
  totalSent: number;
}

/**
 * Collapse whitespace and trim. Case, punctuation and wording are preserved on
 * purpose: two decisions that merely look similar must not share a key.
 */
export function normalizeNotificationReason(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim();
}

/** Stable identity for one governance decision. */
export function notificationKey(identity: NotificationIdentity): string {
  return JSON.stringify([
    identity.sessionID,
    identity.kind,
    identity.action,
    normalizeNotificationReason(identity.reason),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidSession(value: unknown): value is SessionState {
  if (!isRecord(value)) return false;
  if (!isNonNegativeNumber(value.windowStartedAt)) return false;
  if (!isNonNegativeNumber(value.sent)) return false;
  if (!isNonNegativeNumber(value.suppressedDuplicate)) return false;
  if (!isNonNegativeNumber(value.suppressedCap)) return false;
  if (!isRecord(value.keys)) return false;
  return Object.values(value.keys).every(isNonNegativeNumber);
}

/**
 * Bounded, deterministic notification coalescer.
 *
 * `take()` is synchronous on purpose: the duplicate check, the cap check and
 * the recording of a send happen in one turn of the event loop, so concurrent
 * callers in the same runtime cannot both observe an empty slot and both send.
 * Persistence is a separate concern handled by the caller; snapshots are deep
 * copies so a stored value can never alias live state.
 */
export class NotificationCoalescer {
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly dedupeTtlMs: number;
  private readonly now: () => number;
  private sessions = new Map<string, SessionState>();
  /** Monotonic total of notices sent; used for cross-restart loss detection. */
  private totalSent = 0;

  constructor(options: CoalescerOptions) {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('windowMs must be a positive finite number');
    }
    if (!Number.isInteger(options.maxPerWindow) || options.maxPerWindow <= 0) {
      throw new Error('maxPerWindow must be a positive integer');
    }
    const dedupeTtlMs = options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
    if (!Number.isFinite(dedupeTtlMs) || dedupeTtlMs <= 0) {
      throw new Error('dedupeTtlMs must be a positive finite number');
    }
    this.windowMs = options.windowMs;
    this.maxPerWindow = options.maxPerWindow;
    this.dedupeTtlMs = dedupeTtlMs;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Atomically decide whether to send and record the decision.
   *
   * Duplicate identity wins over the cap: a repeated decision is reported as
   * `duplicate` even after the window is full, because suppressing it is not a
   * capacity decision.
   */
  take(identity: NotificationIdentity): NotificationDecision {
    const at = this.now();
    const key = notificationKey(identity);
    const session = this.session(identity.sessionID, at);

    const seenAt = session.keys[key];
    if (seenAt !== undefined) {
      if (at - seenAt < this.dedupeTtlMs) {
        session.suppressedDuplicate += 1;
        return { send: false, key, at, suppressed: 'duplicate' };
      }
      delete session.keys[key];
    }
    if (session.sent >= this.maxPerWindow) {
      session.suppressedCap += 1;
      return { send: false, key, at, suppressed: 'cap' };
    }

    session.keys[key] = at;
    session.sent += 1;
    this.totalSent += 1;
    return { send: true, key, at };
  }

  /** Counters for one session's current window. */
  stats(sessionID: string): NotificationStats {
    const session = this.sessions.get(sessionID);
    if (!session) return { sent: 0, suppressedDuplicate: 0, suppressedCap: 0 };
    return {
      sent: session.sent,
      suppressedDuplicate: session.suppressedDuplicate,
      suppressedCap: session.suppressedCap,
    };
  }

  /**
   * Close one session's cap window and return its counters.
   *
   * Call this only for a real user prompt (`session.prompt`). Synthetic
   * messages do not run that hook, so a synthetic notice can never reset the
   * window and re-enable itself. Duplicate identities are retained until
   * `dedupeTtlMs` so a host that re-evaluates the same pending request cannot
   * re-notify it on every turn; only the per-window cap counters reset.
   */
  reset(sessionID: string): NotificationStats | undefined {
    const session = this.sessions.get(sessionID);
    if (!session) return undefined;
    const at = this.now();
    for (const [key, seenAt] of Object.entries(session.keys)) {
      if (at - seenAt >= this.dedupeTtlMs) delete session.keys[key];
    }
    const stats = {
      sent: session.sent,
      suppressedDuplicate: session.suppressedDuplicate,
      suppressedCap: session.suppressedCap,
    };
    session.windowStartedAt = at;
    session.sent = 0;
    session.suppressedDuplicate = 0;
    session.suppressedCap = 0;
    if (Object.keys(session.keys).length === 0) {
      this.sessions.delete(sessionID);
    }
    return stats;
  }

  /** Deep copy suitable for durable storage. */
  snapshot(): CoalescerSnapshot {
    const sessions: Record<string, SessionState> = {};
    for (const [sessionID, session] of this.sessions) {
      sessions[sessionID] = { ...session, keys: { ...session.keys } };
    }
    return { version: NOTIFICATION_STATE_VERSION, sessions, totalSent: this.totalSent };
  }

  /**
   * Replace state from a stored snapshot. Returns `false` and leaves the
   * current state untouched when the value is invalid; callers must treat a
   * corrupt snapshot as a cold start, never as a reason to throw.
   *
   * On v2 snapshots, logs a warning if the restored `totalSent` is less than
   * what the host inbox has already delivered — that gap means notices were
   * lost between restarts and the consumer should be alerted.
   */
  restore(snapshot: unknown): boolean {
    if (!isRecord(snapshot)) return false;
    if (snapshot.version !== NOTIFICATION_STATE_VERSION) return false;
    if (!isRecord(snapshot.sessions)) return false;

    const sessions = new Map<string, SessionState>();
    for (const [sessionID, value] of Object.entries(snapshot.sessions)) {
      if (!isValidSession(value)) return false;
      sessions.set(sessionID, { ...value, keys: { ...value.keys } });
    }
    this.sessions = sessions;
    this.totalSent = typeof snapshot.totalSent === 'number' ? snapshot.totalSent : 0;
    return true;
  }

  private session(sessionID: string, at: number): SessionState {
    let session = this.sessions.get(sessionID);
    if (!session) {
      session = {
        windowStartedAt: at,
        sent: 0,
        keys: {},
        suppressedDuplicate: 0,
        suppressedCap: 0,
      };
      this.sessions.set(sessionID, session);
      return session;
    }

    // Dedupe keys outlive the cap window; prune only after their own TTL.
    for (const [key, seenAt] of Object.entries(session.keys)) {
      if (at - seenAt >= this.dedupeTtlMs) delete session.keys[key];
    }

    if (at - session.windowStartedAt >= this.windowMs) {
      session.windowStartedAt = at;
      session.sent = 0;
      session.suppressedDuplicate = 0;
      session.suppressedCap = 0;
    }
    return session;
  }
}
