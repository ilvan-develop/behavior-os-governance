import type { DNA } from '@behavior-os/schemas';

export interface DriftInfo {
  /** Unique run id. */
  id: string;
  /** Name of the newer DNA. */
  newerName: string;
  /** Name of the older DNA. */
  olderName: string;
  /** Number of governance rules added. */
  rulesAdded: number;
  /** Number of governance rules removed. */
  rulesRemoved: number;
  /** Number of quality gates added. */
  gatesAdded: number;
  /** Number of quality gates removed. */
  gatesRemoved: number;
  /** Total count of differing items. */
  totalChanges: number;
  /** Whether the drift is significant (>= 2 changes). */
  significant: boolean;
  /** Plain-language summary. */
  summary: string;
  /** Timestamp of comparison. */
  timestamp: string;
}

/**
 * Computes behavioral drift between two DNA snapshots.
 *
 * Drift is the symmetric difference of governance rules and quality gates:
 * - `rulesAdded` — rules present in `newer` but not in `older`;
 * - `rulesRemoved` — rules present in `older` but not in `newer`;
 * - same for quality gates.
 *
 * A drift is **significant** when `totalChanges >= 2`.
 *
 * A DNA loaded without schema validation (e.g. raw YAML in a host adapter) may
 * omit `governance`/`quality`; those are treated as empty arrays.
 */
export class DriftEngine {
  compare(dnaA: DNA, dnaB: DNA): DriftInfo {
    const rulesA = new Map((dnaA.governance ?? []).map((r) => [r.id, r]));
    const rulesB = new Map((dnaB.governance ?? []).map((r) => [r.id, r]));
    const gatesA = new Map((dnaA.quality ?? []).map((g) => [g.id, g]));
    const gatesB = new Map((dnaB.quality ?? []).map((g) => [g.id, g]));

    const rulesAdded = [...rulesB.keys()].filter((id) => !rulesA.has(id)).length;
    const rulesRemoved = [...rulesA.keys()].filter((id) => !rulesB.has(id)).length;
    const gatesAdded = [...gatesB.keys()].filter((id) => !gatesA.has(id)).length;
    const gatesRemoved = [...gatesA.keys()].filter((id) => !gatesB.has(id)).length;
    const totalChanges = rulesAdded + rulesRemoved + gatesAdded + gatesRemoved;

    const summary =
      totalChanges === 0
        ? 'No drift detected — DNAs are identical in governance and quality.'
        : `Drift detected: ${rulesAdded} rule(s) added, ${rulesRemoved} removed, ${gatesAdded} gate(s) added, ${gatesRemoved} removed.`;

    return {
      id: `drift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      newerName: dnaB.name,
      olderName: dnaA.name,
      rulesAdded,
      rulesRemoved,
      gatesAdded,
      gatesRemoved,
      totalChanges,
      significant: totalChanges >= 2,
      summary,
      timestamp: new Date().toISOString(),
    };
  }
}
