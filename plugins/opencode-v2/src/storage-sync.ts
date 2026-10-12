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
