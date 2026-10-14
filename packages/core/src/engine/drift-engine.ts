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
  /** Ids of governance rules present in both but with a different body. */
  rulesChanged: string[];
  /** Number of quality gates added. */
  gatesAdded: number;
  /** Number of quality gates removed. */
  gatesRemoved: number;
  /** Ids of quality gates present in both but with a different body. */
  gatesChanged: string[];
  /** Total count of differing items (added + removed + changed). */
  totalChanges: number;
  /** Whether the drift is significant (>= 2 changes). */
  significant: boolean;
  /** Plain-language summary. */
  summary: string;
  /** Timestamp of comparison. */
  timestamp: string;
}

/**
 * Canonical JSON for structural comparison: object keys are sorted so two
 * semantically identical objects serialize the same way regardless of the key
 * order they were parsed with.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

/**
 * Computes behavioral drift between two DNA snapshots.
 *
 * Drift is the symmetric difference of governance rules and quality gates:
 * - `rulesAdded` / `rulesRemoved` — ids only in one side;
 * - `rulesChanged` — ids present in both whose body differs (e.g. a rule whose
 *   action was tightened from `warn` to `block`, or whose threshold moved);
 * - same three for quality gates.
 *
 * Bodies are compared structurally (key order independent), so a re-serialized
 * but equivalent rule is **not** reported as drift.
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
    const rulesChanged = [...rulesA.keys()].filter(
      (id) => rulesB.has(id) && canonical(rulesA.get(id)) !== canonical(rulesB.get(id)),
    );
    const gatesChanged = [...gatesA.keys()].filter(
      (id) => gatesB.has(id) && canonical(gatesA.get(id)) !== canonical(gatesB.get(id)),
    );
    const totalChanges =
      rulesAdded +
      rulesRemoved +
      rulesChanged.length +
      gatesAdded +
      gatesRemoved +
      gatesChanged.length;

    const parts = [
      `${rulesAdded} rule(s) added`,
      `${rulesRemoved} removed`,
      `${rulesChanged.length} changed`,
      `${gatesAdded} gate(s) added`,
      `${gatesRemoved} removed`,
      `${gatesChanged.length} changed`,
    ];
    const summary =
      totalChanges === 0
        ? 'No drift detected — DNAs are identical in governance and quality.'
        : `Drift detected: ${parts.join(', ')}.`;

    return {
      id: `drift-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      newerName: dnaB.name,
      olderName: dnaA.name,
      rulesAdded,
      rulesRemoved,
      rulesChanged,
      gatesAdded,
      gatesRemoved,
      gatesChanged,
      totalChanges,
      significant: totalChanges >= 2,
      summary,
      timestamp: new Date().toISOString(),
    };
  }
}
