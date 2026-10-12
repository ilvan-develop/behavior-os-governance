// ============================================================
// Governance log
// ============================================================
// Bounded, in-memory, chronological log of how DNA governance is
// applied at runtime. It exists so users can READ governance
// activity on screen — either via the `bos_get_log` tool inside the
// OpenCode session, or from the server console (significant
// outcomes are echoed as `[Behavior-OS:LOG:*]` lines).
//
// State is intentionally module-level (like the engine singleton in
// index.ts) and purely diagnostic: it is never persisted and never
// influences governance decisions.

export type GovernanceLogKind =
  | 'dna_selected'
  | 'mission'
  | 'protocol'
  | 'permission'
  | 'advisory'
  | 'learning'
  | 'restore'
  | 'tool';

export type GovernanceLogOutcome =
  | 'allow'
  | 'deny'
  | 'escalate'
  | 'transform'
  | 'warn'
  | 'info'
  | 'error';

export interface GovernanceLogEvent {
  /** Monotonic sequence number (1-based). */
  seq: number;
  /** ISO timestamp of the event. */
  at: string;
  /**
   * Identity of the process/plugin instance that produced the event. Two OpenCode
   * sessions served by different servers share persisted storage but NOT memory,
   * so their state can diverge; this field makes that visible on screen.
   */
  instance: string;
  kind: GovernanceLogKind;
  outcome: GovernanceLogOutcome;
  /** DNA pattern governing the event, or null before any DNA is active. */
  dna: string | null;
  /** Protocol step at the time of the event (0-based index). */
  step: number;
  /** Active mission at the time of the event, or null. */
  mission: string | null;
  /** Tool or action the event relates to. */
  action: string;
  /** Human-readable detail (reason, message, …). */
  detail: string;
}

export type GovernanceLogInput = Omit<GovernanceLogEvent, 'seq' | 'at' | 'instance'>;

/** Maximum number of events kept in memory (ring buffer). */
export const GOVERNANCE_LOG_MAX = 200;

/**
 * Short, stable identity for this plugin instance. Includes the process id so
 * events logged by two concurrent servers/instances are distinguishable — the
 * cheapest way to expose cross-instance state divergence.
 */
export const GOVERNANCE_INSTANCE_ID = `p${typeof process !== 'undefined' ? process.pid : 0}-${Math.random()
  .toString(36)
  .slice(2, 7)}`;

/** Outcomes that are additionally echoed to the server console. */
const ECHOED_OUTCOMES: ReadonlySet<GovernanceLogOutcome> = new Set(['deny', 'escalate', 'error']);

let events: GovernanceLogEvent[] = [];
let sequence = 0;

/**
 * Append an event to the ring buffer. Returns the stored entry.
 * Designated outcomes are echoed to the console in a greppable
 * `[Behavior-OS:LOG:kind:outcome]` line.
 */
export function appendGovernanceLog(input: GovernanceLogInput): GovernanceLogEvent {
  const entry: GovernanceLogEvent = {
    seq: ++sequence,
    at: new Date().toISOString(),
    instance: GOVERNANCE_INSTANCE_ID,
    ...input,
  };
  events.push(entry);
  if (events.length > GOVERNANCE_LOG_MAX) {
    events = events.slice(events.length - GOVERNANCE_LOG_MAX);
  }
  if (ECHOED_OUTCOMES.has(entry.outcome)) {
    console.log(serializeGovernanceLog(entry));
  }
  return entry;
}

/** Return the most recent events (newest last), capped at `limit`. */
export function getGovernanceLog(limit = 50): GovernanceLogEvent[] {
  const capped = Math.max(1, Math.floor(limit));
  return events.slice(-capped);
}

/** Wipe the log (used by tests and diagnostics). */
export function clearGovernanceLog(): void {
  events = [];
  sequence = 0;
}

/** Single-line rendering of an event, used for console output. */
export function serializeGovernanceLog(entry: GovernanceLogEvent): string {
  return [
    `[Behavior-OS:LOG:${entry.kind}:${entry.outcome}]`,
    `inst=${entry.instance}`,
    `dna=${entry.dna ?? '-'}`,
    `step=${entry.step}`,
    `mission=${entry.mission ?? '-'}`,
    `action="${entry.action}"`,
    entry.detail,
  ].join(' ');
}
