// ============================================================
// Storage sync — cross-instance conflict resolution
// ============================================================
// Several OpenCode servers can share one storage backend while keeping separate
// in-memory engines. Plain "exportState on every change" is last-writer-wins and
// can silently clobber a newer snapshot written by another instance.
//
// This module holds the pure decision logic (no OpenCode imports) so the
// contract — adopt-then-write — is unit-testable in isolation: an instance must
// ADOPT a snapshot committed by a *different* instance at a higher revision
// before it writes, and revisions must always move forward.

export interface StoredManifest {
  /** Revision stamped on the stored snapshot, or 0 when absent/legacy. */
  revision: number;
  /** Instance id that wrote the stored snapshot, or null when absent/legacy. */
  writer: string | null;
}

/** Read the `revision`/`writer` stamp a persisted envelope carries, if any. */
export function readStoredManifest(raw: unknown): StoredManifest {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
  const revision = typeof record?.revision === 'number' ? record.revision : 0;
  const writer = typeof record?.writer === 'string' ? record.writer : null;
  return { revision, writer };
}

export interface PersistPlan {
  /**
   * True when the caller must `importState` the stored snapshot before writing,
   * so a newer commit from another instance is not lost.
   */
  adopt: boolean;
  /** Revision to stamp on the next write (strictly greater than both inputs). */
  nextRevision: number;
}

/**
 * Decide how the current instance should persist given what is already stored.
 *
 * - `adopt` is true only when the store holds a *foreign* writer's snapshot with
 *   a strictly higher revision than the local one (a newer commit we have not
 *   seen). An *equal* revision from a rival is a collision that the caller
 *   recovers with a forced adopt+merge retry, not part of this pure decision.
 * - `nextRevision` is `max(local, stored) + 1`, so revisions are monotonic even
 *   when two writers race.
 */
export function planPersist(params: {
  localRevision: number;
  instanceId: string;
  storedRevision: number;
  storedWriter: string | null;
}): PersistPlan {
  const adopt =
    Boolean(params.storedWriter) &&
    params.storedWriter !== params.instanceId &&
    params.storedRevision > params.localRevision;

  return {
    adopt,
    nextRevision: Math.max(params.localRevision, params.storedRevision) + 1,
  };
}

export interface OvertakeReport {
  overtaken: boolean;
  storedRevision: number;
}

/**
 * Post-write verification over a plain get/set backend. If the store already
 * holds a *higher* revision than the one we just wrote, another instance wrote
 * inside our read→write window and the caller should retry with adopt+merge.
 *
 * An equal revision written by a *different* writer means we collided with a
 * rival at the same revision and the store now shows their value. That is
 * detectable, and recoverable via adopt+merge, even without a storage-side
 * compare-and-swap, so it is treated as an overtake as well. The only residual
 * race left is a rival write that never becomes observable in our read-back
 * window, which no get/set API can eliminate.
 */
export function detectOvertake(
  wroteRevision: number,
  storedRevision: number,
  storedWriter: string | null = null,
  instanceId: string | null = null,
): OvertakeReport {
  const higher = storedRevision > wroteRevision;
  const collision =
    storedRevision === wroteRevision && !!storedWriter && storedWriter !== instanceId;
  return { overtaken: higher || collision, storedRevision };
}

// ============================================================
// Conflict merge (adopt-then-write with no lost updates)
// ============================================================
// Adopting a newer foreign snapshot wholesale would discard local-only items
// (e.g. a mission the local engine created since the snapshot it last saw).
// `mergeSnapshots` unions item collections by `id` (same id -> the foreign,
// newer snapshot wins) and keeps the healthiest scalar values: DNA and the
// active mission from the newer snapshot when present, else the local ones,
// and the maximum protocol step.

export interface SnapshotLike {
  version?: string;
  dna?: unknown | null;
  agentState?: {
    selectedDna?: string | null;
    activeMission?: string | null;
    currentStep?: number;
    stepHistory?: Array<{ step?: number; tool?: string }>;
    [key: string]: unknown;
  } | null;
  missions?: Array<{ id?: string; [key: string]: unknown }>;
  learnings?: Array<{ id?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

function unionById<T extends { id?: string }>(a: T[] | undefined, b: T[] | undefined): T[] {
  const byId = new Map<string, T>();
  for (const item of a ?? []) if (item.id) byId.set(item.id, item);
  for (const item of b ?? []) if (item.id) byId.set(item.id, item); // foreign (newer) wins
  return [...byId.values()];
}

const TERMINAL_MISSION_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function missionStatus(mission: { [key: string]: unknown }): string | null {
  return typeof mission.status === 'string' ? mission.status : null;
}

function isTerminalMission(mission: { [key: string]: unknown } | undefined): boolean {
  const status = mission ? missionStatus(mission) : null;
  return status !== null && TERMINAL_MISSION_STATUSES.has(status);
}

function missionVersion(mission: { [key: string]: unknown }): number {
  return typeof mission.version === 'number' ? mission.version : -1;
}

/**
 * Merge two copies of the same mission. A higher `version` wins; a terminal
 * state can never be downgraded to a non-terminal one by a stale writer. This
 * matters because terminal missions are immutable and their evidence is the
 * only proof of completion.
 */
function pickMission(
  local: { [key: string]: unknown },
  foreign: { [key: string]: unknown },
): { [key: string]: unknown } {
  const localStatus = missionStatus(local);
  const foreignStatus = missionStatus(foreign);
  const localTerminal = localStatus !== null && TERMINAL_MISSION_STATUSES.has(localStatus);
  const foreignTerminal = foreignStatus !== null && TERMINAL_MISSION_STATUSES.has(foreignStatus);

  if (localTerminal && !foreignTerminal) return local;
  if (foreignTerminal && !localTerminal) return foreign;

  const localVersion = missionVersion(local);
  const foreignVersion = missionVersion(foreign);
  if (localVersion !== foreignVersion) {
    return foreignVersion > localVersion ? foreign : local;
  }
  if (localTerminal && foreignTerminal) {
    // Divergent terminal outcomes at the same version (e.g. completed vs
    // failed from two writers). Pick the later update deterministically so
    // both instances converge; equal timestamps fall back to a status rank.
    const localAt = typeof local.updatedAt === 'string' ? local.updatedAt : '';
    const foreignAt = typeof foreign.updatedAt === 'string' ? foreign.updatedAt : '';
    if (localAt !== foreignAt) return foreignAt > localAt ? foreign : local;
    const rank: Record<string, number> = { completed: 3, failed: 2, cancelled: 1 };
    const localRank = localStatus ? (rank[localStatus] ?? 0) : 0;
    const foreignRank = foreignStatus ? (rank[foreignStatus] ?? 0) : 0;
    return foreignRank > localRank ? foreign : local;
  }
  // Same version, non-terminal: the foreign (newer snapshot) wins.
  return foreign;
}

function mergeMissions(
  a: Array<{ id?: string; [key: string]: unknown }> | undefined,
  b: Array<{ id?: string; [key: string]: unknown }> | undefined,
): Array<{ id?: string; [key: string]: unknown }> {
  const byId = new Map<string, { id?: string; [key: string]: unknown }>();
  for (const item of a ?? []) if (item.id) byId.set(item.id, item);
  for (const item of b ?? []) {
    if (!item.id) continue;
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickMission(existing, item) : item);
  }
  return [...byId.values()];
}

/** Union protocol steps by their step number (history entries carry no id). */
function unionStepHistory(
  a: Array<{ step?: number; tool?: string }> | undefined,
  b: Array<{ step?: number; tool?: string }> | undefined,
): Array<{ step?: number; tool?: string }> {
  const byStep = new Map<number, { step?: number; tool?: string }>();
  for (const entry of a ?? []) if (typeof entry.step === 'number') byStep.set(entry.step, entry);
  for (const entry of b ?? []) if (typeof entry.step === 'number') byStep.set(entry.step, entry);
  return [...byStep.values()];
}

function maxStep(stepHistory: Array<{ step?: number }> | undefined): number {
  return (stepHistory ?? []).reduce(
    (max, entry) => (typeof entry.step === 'number' && entry.step > max ? entry.step : max),
    0,
  );
}

/**
 * Shape of a merged snapshot: the item collections and the agent state are
 * always present (possibly empty), so consumers never need null checks.
 */
export interface MergedSnapshot {
  version?: string;
  dna: unknown | null;
  agentState: {
    selectedDna: string | null;
    activeMission: string | null;
    currentStep: number;
    stepHistory: Array<{ step?: number; tool?: string }>;
    [key: string]: unknown;
  };
  missions: Array<{ id?: string; [key: string]: unknown }>;
  learnings: Array<{ id?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Merge the local snapshot with a newer foreign one so no item is lost.
 * `foreign` is the snapshot kept by another instance at a higher revision;
 * identical items are resolved in its favour (it is newer), while items that
 * only exist locally are preserved.
 */
export function mergeSnapshots(
  local: SnapshotLike | null | undefined,
  foreign: SnapshotLike | null | undefined,
): MergedSnapshot {
  const a = local ?? {};
  const b = foreign ?? {};
  const aState = a.agentState ?? {};
  const bState = b.agentState ?? {};

  const mergedStepHistory = unionStepHistory(aState.stepHistory, bState.stepHistory);
  const currentStep = Math.max(
    maxStep(aState.stepHistory),
    maxStep(bState.stepHistory),
    typeof aState.currentStep === 'number' ? aState.currentStep : 0,
    typeof bState.currentStep === 'number' ? bState.currentStep : 0,
  );

  const missions = mergeMissions(a.missions, b.missions);
  const preferredActive = bState.activeMission ?? aState.activeMission ?? null;
  const preferredMission = preferredActive
    ? missions.find((mission) => mission.id === preferredActive)
    : undefined;
  // Never point activeMission at a terminal mission: it would suppress
  // auto-missions and make bos_start_mission refuse a mission that is done.
  const activeMission = isTerminalMission(preferredMission) ? null : preferredActive;

  return {
    ...a,
    ...b,
    version: a.version ?? b.version,
    dna: b.dna ?? a.dna ?? null,
    agentState: {
      ...aState,
      ...bState,
      selectedDna: bState.selectedDna ?? aState.selectedDna ?? null,
      activeMission,
      currentStep,
      stepHistory: mergedStepHistory,
    },
    missions,
    learnings: unionById(a.learnings, b.learnings),
  };
}
