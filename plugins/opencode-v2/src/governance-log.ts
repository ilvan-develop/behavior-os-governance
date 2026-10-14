// ============================================================
// Governance log
// ============================================================
// Bounded, chronological, hash-chained log of how DNA governance is applied at
// runtime. It exists so users can READ governance activity on screen — either
// via the `bos_get_log` / `bos_verify_audit_trail` tools inside the OpenCode
// session, or from the server console (significant outcomes are echoed as
// `[Behavior-OS:LOG:*]` lines).
//
// State is module-level (like the engine singleton in index.ts) and purely
// diagnostic: it never influences governance decisions.
//
// Append-only by design: `appendGovernanceLog` is the only writer, every entry
// is linked into a SHA-256 hash chain (`prevHash` -> `hash`) and entries are
// never updated in place. Two levels of assurance, honestly separated:
//
// - In memory (always on): a ring buffer of the most recent GOVERNANCE_LOG_MAX
//   events, plus a bounded tail persisted in the snapshot envelope
//   (GOVERNANCE_LOG_PERSIST_LIMIT) so recent history survives a restart.
//   `verifyGovernanceLog()` recomputes the chain over that window and detects an
//   edited or reordered entry inside it; after eviction it can only attest the
//   retained window (`complete: false`).
// - Durable sink (opt-in via GOVERNANCE_LOG_FILE_ENV): each entry is appended to
//   a JSONL file with flag 'a' (never rewritten). The file holds the whole
//   history, so `verifyGovernanceLogFile()` additionally detects a truncated
//   head, a deleted middle line and any reordering — the first entry must be
//   seq 1 with the genesis hash and seq must be contiguous. On init the sink is
//   read back, so it is the source of truth for the chain across restarts.
//
// Neither level is WORM storage: a root user with write access to the file can
// rewrite the whole chain and its hashes. What IS guaranteed is that a partial
// or edited log cannot pass verification unnoticed, and that `instance` marks
// which process produced each entry (two OpenCode sessions share persisted
// storage but not memory, so their state can diverge).

import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

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
  /** `hash` of the previous event, or the genesis hash for the first event. */
  prevHash: string;
  /** SHA-256 over this event's canonical fields plus `prevHash`. */
  hash: string;
}

export type GovernanceLogInput = Omit<
  GovernanceLogEvent,
  'seq' | 'at' | 'instance' | 'prevHash' | 'hash'
>;

/** Maximum number of events kept in memory (ring buffer). */
export const GOVERNANCE_LOG_MAX = 200;

/**
 * Environment variable that points at a durable, append-only JSONL sink for the
 * audit trail. Off by default: without it the trail is in-memory + the bounded
 * snapshot tail, and `verifyGovernanceLog` can only attest the retained window.
 */
export const GOVERNANCE_LOG_FILE_ENV = 'BEHAVIOR_OS_AUDIT_LOG';

/**
 * Maximum number of recent events embedded in a persisted snapshot, so a
 * restarted process can still show what happened before it started. Smaller
 * than the in-memory cap on purpose, to keep the envelope compact.
 */
export const GOVERNANCE_LOG_PERSIST_LIMIT = 50;

/** Hash used as the `prevHash` of the very first event in a chain. */
export const GENESIS_HASH = '0'.repeat(64);

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
/** Hash of the most recent event; the `prevHash` for the next one. */
let lastHash = GENESIS_HASH;
/** Hash before the retained window; the verification anchor after eviction. */
let anchorHash = GENESIS_HASH;
/** Durable append-only sink (JSONL), when enabled via the env var. */
let sinkPath: string | null = null;
/** Number of failed sink writes; surfaced so a broken sink is never silent. */
let sinkWriteErrors = 0;

/**
 * Enable a durable, append-only JSONL sink for the audit trail.
 *
 * When the file already exists it is read back on init: the in-memory buffer is
 * re-seeded from the sink (the sink is the source of truth across restarts) and
 * the sequence/hash pointers resume from its last entry, so new events keep the
 * single chain intact even when the persisted snapshot only holds a short tail.
 * Passing `null` disables the sink.
 */
export function initGovernanceLogSink(filePath: string | null): void {
  sinkPath = filePath?.trim() ? filePath : null;
  sinkWriteErrors = 0;
  if (!sinkPath) return;
  const stored = readGovernanceLogFile(sinkPath);
  if (stored.length === 0) return;
  const tail = stored.slice(-GOVERNANCE_LOG_MAX);
  events = tail;
  sequence = tail[tail.length - 1].seq;
  lastHash = tail[tail.length - 1].hash;
  // Anchor on the event before the retained window; genesis for a short log.
  anchorHash =
    tail.length < stored.length ? stored[stored.length - tail.length - 1].hash : GENESIS_HASH;
}

/** Current sink status: `path` is null when the durable sink is disabled. */
export function getGovernanceLogSinkStatus(): { path: string | null; writeErrors: number } {
  return { path: sinkPath, writeErrors: sinkWriteErrors };
}

/**
 * Read and parse an append-only JSONL audit log. Lines that cannot be parsed
 * are skipped here and reported by {@link verifyGovernanceLogFile}, so a
 * corrupted line is never silently ignored during verification.
 */
export function readGovernanceLogFile(filePath: string): GovernanceLogEvent[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const parsed: GovernanceLogEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as GovernanceLogEvent;
      if (typeof entry.seq === 'number' && typeof entry.hash === 'string') parsed.push(entry);
    } catch {
      // Ignored: verification reports unparsable lines explicitly.
    }
  }
  return parsed;
}

/** Append one event to the durable sink. Never throws: governance must not break. */
function writeToSink(entry: GovernanceLogEvent): void {
  if (!sinkPath) return;
  try {
    appendFileSync(sinkPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
  } catch {
    // A failing sink must not stop governance, but it must not look healthy
    // either: the counter is reported by bos_verify_audit_trail.
    sinkWriteErrors += 1;
  }
}

/** Deterministic SHA-256 over an event's canonical fields (excluding `hash`). */
export function computeGovernanceHash(entry: Omit<GovernanceLogEvent, 'hash'>): string {
  const payload = JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    instance: entry.instance,
    kind: entry.kind,
    outcome: entry.outcome,
    dna: entry.dna,
    step: entry.step,
    mission: entry.mission,
    action: entry.action,
    detail: entry.detail,
    prevHash: entry.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Append an event to the ring buffer, linking it into the hash chain. Returns
 * the stored entry. Designated outcomes are echoed to the console in a
 * greppable `[Behavior-OS:LOG:kind:outcome]` line.
 */
export function appendGovernanceLog(input: GovernanceLogInput): GovernanceLogEvent {
  const entry: GovernanceLogEvent = {
    seq: ++sequence,
    at: new Date().toISOString(),
    instance: GOVERNANCE_INSTANCE_ID,
    ...input,
    prevHash: lastHash,
    hash: '',
  };
  entry.hash = computeGovernanceHash(entry);
  lastHash = entry.hash;

  events.push(entry);
  if (events.length > GOVERNANCE_LOG_MAX) {
    const drop = events.length - GOVERNANCE_LOG_MAX;
    anchorHash = events[drop - 1].hash;
    events = events.slice(drop);
  }
  // Mirror to the durable append-only sink (best effort, never throws).
  writeToSink(entry);
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

/** Wipe the log and reset the chain (used by tests and diagnostics). */
export function clearGovernanceLog(): void {
  events = [];
  sequence = 0;
  lastHash = GENESIS_HASH;
  anchorHash = GENESIS_HASH;
  sinkWriteErrors = 0;
}

/**
 * The most recent events (oldest first) to embed in a persisted snapshot. A
 * bounded tail keeps the envelope small while still showing recent history
 * after a restart.
 */
export function exportGovernanceLog(limit = GOVERNANCE_LOG_PERSIST_LIMIT): GovernanceLogEvent[] {
  return events.slice(-Math.max(1, Math.floor(limit)));
}

/**
 * Restore previously persisted events into the in-memory buffer after a
 * restart. Entries are validated defensively (the snapshot may come from an
 * older build) and the sequence counter resumes after the highest restored
 * `seq`, so freshly appended events stay monotonic. Entries that carry a stored
 * `hash` keep it (so tampering is detectable); entries without one are
 * recomputed and re-linked. Returns how many entries were restored.
 */
export function seedGovernanceLog(input: unknown): number {
  // A durable sink already restored the log on init and is the source of truth
  // across restarts; seeding the shorter snapshot tail on top of it would fork
  // the chain (and re-use sequence numbers).
  if (events.length > 0) return 0;
  if (!Array.isArray(input) || input.length === 0) return 0;
  const restored: GovernanceLogEvent[] = [];
  for (const item of input) {
    const entry = (item ?? {}) as Partial<GovernanceLogEvent>;
    if (typeof entry.seq !== 'number' || typeof entry.at !== 'string') continue;
    if (typeof entry.detail !== 'string') continue;
    restored.push({
      seq: entry.seq,
      at: entry.at,
      instance: typeof entry.instance === 'string' ? entry.instance : 'unknown',
      kind: (entry.kind ?? 'tool') as GovernanceLogKind,
      outcome: (entry.outcome ?? 'info') as GovernanceLogOutcome,
      dna: typeof entry.dna === 'string' ? entry.dna : null,
      step: typeof entry.step === 'number' ? entry.step : 0,
      mission: typeof entry.mission === 'string' ? entry.mission : null,
      action: typeof entry.action === 'string' ? entry.action : '',
      detail: entry.detail,
      prevHash: typeof entry.prevHash === 'string' ? entry.prevHash : '',
      hash: typeof entry.hash === 'string' ? entry.hash : '',
    });
  }
  if (restored.length === 0) return 0;
  restored.sort((a, b) => a.seq - b.seq);
  events = restored.slice(-GOVERNANCE_LOG_MAX);

  // Re-link the window: keep stored hashes, recompute legacy (hashless) entries
  // so a snapshot written before hashing still verifies afterwards.
  let prev = events[0].prevHash || GENESIS_HASH;
  anchorHash = prev;
  for (const entry of events) {
    if (!entry.prevHash) entry.prevHash = prev;
    if (!entry.hash) entry.hash = computeGovernanceHash(entry);
    prev = entry.hash;
  }
  lastHash = prev;
  sequence = Math.max(sequence, ...events.map((entry) => entry.seq));
  return events.length;
}

export interface ChainVerification {
  /** True when every retained entry links and hashes correctly. */
  valid: boolean;
  /** Number of entries checked. */
  checked: number;
  /** `seq` of the first entry that failed verification, when invalid. */
  brokenAt?: number;
  /** Human-readable reason for the first failure. */
  reason?: string;
  /**
   * True when verification started at the real head of the chain (`seq === 1`
   * with the genesis `prevHash`). False means only a retained window was
   * attested — what the in-memory buffer can guarantee after eviction.
   */
  complete: boolean;
}

/**
 * Recompute and verify the hash chain over the retained events (or a supplied
 * slice). The first entry is anchored on its own `prevHash`, so verification
 * covers the retained window rather than the whole (evicted) history. Sequence
 * continuity is checked too, so a deleted or reordered entry is reported even
 * when the neighbouring hashes happen to line up.
 */
export function verifyGovernanceLog(
  entries: readonly GovernanceLogEvent[] = events,
): ChainVerification {
  if (entries.length === 0) return { valid: true, checked: 0, complete: false };
  const complete = entries[0].seq === 1 && entries[0].prevHash === GENESIS_HASH;
  let prev = entries[0].prevHash || GENESIS_HASH;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const expectedSeq = entries[0].seq + index;
    if (entry.seq !== expectedSeq) {
      return {
        valid: false,
        checked: index,
        complete,
        brokenAt: entry.seq,
        reason: `sequence gap at seq ${entry.seq} (expected ${expectedSeq})`,
      };
    }
    if (entry.prevHash !== prev) {
      return {
        valid: false,
        checked: index,
        complete,
        brokenAt: entry.seq,
        reason: `prevHash mismatch at seq ${entry.seq}`,
      };
    }
    const expected = computeGovernanceHash(entry);
    if (entry.hash !== expected) {
      return {
        valid: false,
        checked: index,
        complete,
        brokenAt: entry.seq,
        reason: `hash mismatch at seq ${entry.seq}`,
      };
    }
    prev = entry.hash;
  }
  return { valid: true, checked: entries.length, complete };
}

/**
 * Verify a durable append-only audit log (JSONL) end to end: genesis head,
 * sequence continuity and hash chain.
 *
 * This is stronger than {@link verifyGovernanceLog}: the file keeps the whole
 * history, so a truncated head, a deleted middle line, a reordered entry or an
 * edited field is detected — the in-memory buffer can only attest its window.
 * A missing or empty file reports `valid: false` instead of silently passing.
 */
export function verifyGovernanceLogFile(filePath: string): ChainVerification {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { valid: false, checked: 0, complete: false, reason: 'audit log not found' };
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { valid: false, checked: 0, complete: false, reason: 'audit log is empty' };
  }

  const entries: GovernanceLogEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    try {
      entries.push(JSON.parse(lines[index]) as GovernanceLogEvent);
    } catch {
      return {
        valid: false,
        checked: index,
        complete: false,
        reason: `unparsable audit log line ${index + 1}`,
      };
    }
  }

  if (entries[0].seq !== 1 || entries[0].prevHash !== GENESIS_HASH) {
    return {
      valid: false,
      checked: 0,
      complete: false,
      brokenAt: entries[0].seq,
      reason: `truncated head: first entry is seq ${entries[0].seq}`,
    };
  }

  let prev = GENESIS_HASH;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const expectedSeq = index + 1;
    if (entry.seq !== expectedSeq) {
      return {
        valid: false,
        checked: index,
        complete: false,
        brokenAt: entry.seq,
        reason: `sequence gap at line ${index + 1}: seq ${entry.seq} (expected ${expectedSeq})`,
      };
    }
    if (entry.prevHash !== prev) {
      return {
        valid: false,
        checked: index,
        complete: false,
        brokenAt: entry.seq,
        reason: `prevHash mismatch at seq ${entry.seq}`,
      };
    }
    const expected = computeGovernanceHash(entry);
    if (entry.hash !== expected) {
      return {
        valid: false,
        checked: index,
        complete: false,
        brokenAt: entry.seq,
        reason: `hash mismatch at seq ${entry.seq}`,
      };
    }
    prev = entry.hash;
  }

  return { valid: true, checked: entries.length, complete: true };
}

/** Current chain head + anchor, for diagnostics and external attestation. */
export function getGovernanceChainHead(): { head: string; anchor: string; length: number } {
  return { head: lastHash, anchor: anchorHash, length: events.length };
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
    `hash=${entry.hash.slice(0, 12)}`,
    entry.detail,
  ].join(' ');
}
