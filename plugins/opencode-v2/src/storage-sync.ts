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
 *   seen).
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
 * An equal revision means the store still shows our own write — an exactly
 * simultaneous equal-revision collision is indistinguishable from our own
 * write without a storage-side compare-and-swap, and that residual race is
 * documented as the irreducible limit of a get/set storage API.
 */
export function detectOvertake(wroteRevision: number, storedRevision: number): OvertakeReport {
  return { overtaken: storedRevision > wroteRevision, storedRevision };
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

  return {
    ...a,
    ...b,
    version: a.version ?? b.version,
    dna: b.dna ?? a.dna ?? null,
    agentState: {
      ...aState,
      ...bState,
      selectedDna: bState.selectedDna ?? aState.selectedDna ?? null,
      activeMission: bState.activeMission ?? aState.activeMission ?? null,
      currentStep,
      stepHistory: mergedStepHistory,
    },
    missions: unionById(a.missions, b.missions),
    learnings: unionById(a.learnings, b.learnings),
  };
}
