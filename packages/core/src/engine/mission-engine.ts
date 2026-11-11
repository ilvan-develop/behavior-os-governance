import type {
  DNA,
  Mission,
  MissionEvidence,
  MissionPriority,
  MissionStatus,
  MissionTransition,
  MissionType,
} from '@behavior-os/schemas';

export interface CreateMissionOptions {
  title: string;
  description?: string;
  type: MissionType;
  priority: MissionPriority;
  dnaPattern: string;
  createdBy: string;
  assignedTo?: string[];
  tags?: string[];
  /**
   * Gates that must each have passing evidence before the mission may complete.
   * Defaults to `[]`: a mission without declared gates completes with the
   * explicit basis `no-required-checks`, never with an implied verification.
   */
  requiredChecks?: string[];
  /**
   * `any` (default) keeps the historical caller-supplied evidence contract.
   * `executed` requires passing evidence with `provenance: 'executed'` and a
   * non-empty `executionId` for every required gate before completion.
   */
  verificationMode?: 'any' | 'executed';
}

/** Evidence supplied by a caller; `recordedAt` is stamped by the engine. */
export interface MissionEvidenceInput {
  gate: string;
  status: 'passed' | 'failed' | 'skipped';
  source: string;
  detail?: string;
  simulated?: boolean;
  provenance?: 'executed' | 'reported' | 'simulated';
  executionId?: string;
  /** Task whose execution produced this evidence. */
  taskId?: string;
  tool?: string;
  command?: string;
  exitCode?: number;
}

export interface MissionTransitionOptions {
  reason?: string;
  actor?: string;
  evidence?: MissionEvidenceInput[];
  /** Reject the transition when the mission is not at this revision. */
  expectedVersion?: number;
  /** Deterministic clock for tests; defaults to the current ISO timestamp. */
  now?: string;
}

export type MissionTransitionErrorCode =
  | 'MISSION_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'EVIDENCE_MISSING'
  | 'EVIDENCE_FAILED'
  | 'EVIDENCE_SIMULATED'
  | 'EVIDENCE_UNVERIFIED'
  | 'EVIDENCE_INVALID'
  | 'MISSION_TERMINAL'
  | 'PERSISTENCE_FAILED';

export type MissionTransitionResult =
  | { ok: true; changed: boolean; mission: Mission }
  | {
      ok: false;
      code: MissionTransitionErrorCode;
      message: string;
      mission: Mission | null;
      from?: MissionStatus;
      to: MissionStatus;
    };

/**
 * The only legal edges of the mission state machine. Terminal states have no
 * outgoing edges: reopening is a new mission, not a resurrection.
 */
const ALLOWED_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  pending: ['active', 'failed', 'cancelled'],
  active: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['active', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly MissionStatus[] = ['completed', 'failed', 'cancelled'];

/** Trim, dedupe and drop blank required gates so they can never deadlock completion. */
function normalizeRequiredChecks(checks: string[] | undefined): string[] {
  return [
    ...new Set((checks ?? []).map((check) => check.trim()).filter((check) => check.length > 0)),
  ];
}

/**
 * Tags that record a native collaboration session opened for a mission
 * (`brainstorm-<id>`, `conversation-<id>` or the legacy `conv-<id>` form).
 *
 * The tags are removed automatically once the session converges; while one
 * remains, `BehaviorOS.transitionMission` refuses `completed`.
 */
export function isCollaborationTag(tag: string): boolean {
  return (
    tag.startsWith('brainstorm-') || tag.startsWith('conversation-') || tag.startsWith('conv-')
  );
}

type NormalizedEvidence =
  | { ok: true; evidence: MissionEvidence[] }
  | { ok: false; message: string };

/**
 * Validate and stamp evidence once, so transitions and incremental evidence
 * writes cannot disagree.
 *
 * Provenance defaults to `reported` when the caller supplies no provenance:
 * historical callers are not silently upgraded to `executed`, and an
 * `executed` claim without an `executionId` is rejected as malformed rather
 * than trusted.
 */
function normalizeEvidence(entries: MissionEvidenceInput[], now: string): NormalizedEvidence {
  const evidence: MissionEvidence[] = [];
  for (const entry of entries) {
    const gate = entry.gate.trim();
    const source = entry.source.trim();
    if (gate.length === 0 || source.length === 0) {
      return { ok: false, message: 'Evidence requires a non-empty gate and source' };
    }

    const provenance = entry.provenance ?? (entry.simulated === true ? 'simulated' : 'reported');
    const executionId = entry.executionId?.trim();

    if (provenance === 'executed' && (!executionId || executionId.length === 0)) {
      return {
        ok: false,
        message: `Evidence for gate "${gate}" claims provenance "executed" without an executionId`,
      };
    }
    if (provenance === 'executed' && entry.simulated === true) {
      return {
        ok: false,
        message: `Evidence for gate "${gate}" is both "executed" and "simulated"`,
      };
    }

    evidence.push({
      gate,
      status: entry.status,
      source,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      ...(provenance === 'simulated' || entry.simulated === true ? { simulated: true } : {}),
      provenance,
      ...(executionId ? { executionId } : {}),
      ...(entry.taskId?.trim() ? { taskId: entry.taskId.trim() } : {}),
      ...(entry.tool ? { tool: entry.tool } : {}),
      ...(entry.command !== undefined ? { command: entry.command } : {}),
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      recordedAt: now,
    });
  }
  return { ok: true, evidence };
}

export class MissionEngine {
  private missions: Map<string, Mission> = new Map();
  private readonly dna: DNA | undefined;

  constructor(dna?: DNA) {
    this.dna = dna;
  }

  create(options: CreateMissionOptions): Mission {
    // Derive the DNA pattern from the injected DNA when the caller did not
    // explicitly select a pattern, so missions always carry provenance.
    const dnaPattern = options.dnaPattern || this.dna?.name || 'default';

    const mission: Mission = {
      id: `mission-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...options,
      dnaPattern,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
      version: 0,
      verificationMode: options.verificationMode ?? 'any',
      // Trim and drop blank gates: a blank gate could never be matched by
      // valid evidence, leaving the mission permanently uncompletable.
      requiredChecks: normalizeRequiredChecks(options.requiredChecks),
      evidence: [],
      transitions: [],
    };

    this.missions.set(mission.id, mission);
    return mission;
  }

  /**
   * Apply a validated transition. This is the single mutating entry point: the
   * legacy `start`/`complete`/`fail` helpers delegate here so they can never
   * bypass the state machine.
   */
  transition(
    missionId: string,
    to: MissionStatus,
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const mission = this.missions.get(missionId);
    if (!mission) {
      return {
        ok: false,
        code: 'MISSION_NOT_FOUND',
        message: `Mission "${missionId}" not found`,
        mission: null,
        to,
      };
    }

    const from = mission.status;
    const now = options.now ?? new Date().toISOString();

    // Idempotent replay: the mission is already in the requested state. This is
    // a success with no new revision, so retries never duplicate evidence.
    if (from === to) {
      return { ok: true, changed: false, mission };
    }

    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot transition mission "${missionId}" from "${from}" to "${to}"`,
        mission,
        from,
        to,
      };
    }

    const currentVersion = mission.version ?? 0;
    if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `Mission "${missionId}" is at version ${currentVersion}, expected ${options.expectedVersion}`,
        mission,
        from,
        to,
      };
    }

    const normalized = normalizeEvidence(options.evidence ?? [], now);
    if (!normalized.ok) {
      return {
        ok: false,
        code: 'EVIDENCE_INVALID',
        message: normalized.message,
        mission,
        from,
        to,
      };
    }

    const recorded = normalized.evidence;
    const allEvidence = [...(mission.evidence ?? []), ...recorded];

    let completionBasis: Mission['completionBasis'];
    if (to === 'completed') {
      const required = normalizeRequiredChecks(mission.requiredChecks);
      const executedMode = mission.verificationMode === 'executed';

      if (required.length === 0 && executedMode) {
        return {
          ok: false,
          code: 'EVIDENCE_MISSING',
          message:
            'Mission requires executed verification but declares no required checks: declare at least one gate',
          mission,
          from,
          to,
        };
      }

      if (required.length === 0) {
        completionBasis = 'no-required-checks';
      } else {
        for (const gate of required) {
          const found = allEvidence.filter((entry) => entry.gate === gate);
          if (found.length === 0) {
            return {
              ok: false,
              code: 'EVIDENCE_MISSING',
              message: `Missing evidence for required gate "${gate}"`,
              mission,
              from,
              to,
            };
          }
          const latest = found[found.length - 1];
          if (latest.simulated === true || latest.provenance === 'simulated') {
            return {
              ok: false,
              code: 'EVIDENCE_SIMULATED',
              message: `Evidence for required gate "${gate}" is simulated and cannot authorize completion`,
              mission,
              from,
              to,
            };
          }
          if (executedMode && (latest.provenance !== 'executed' || !latest.executionId)) {
            return {
              ok: false,
              code: 'EVIDENCE_UNVERIFIED',
              message: `Evidence for required gate "${gate}" is not executed (provenance "${latest.provenance ?? 'reported'}"); executed verification requires provenance "executed" and an executionId`,
              mission,
              from,
              to,
            };
          }
          if (latest.status !== 'passed') {
            return {
              ok: false,
              code: 'EVIDENCE_FAILED',
              message: `Latest evidence for required gate "${gate}" is "${latest.status}", not "passed"`,
              mission,
              from,
              to,
            };
          }
        }
        completionBasis = 'evidence';
      }
    }

    const version = currentVersion + 1;
    const transition: MissionTransition = {
      from,
      to,
      at: now,
      actor: options.actor ?? 'system',
      reason: typeof options.reason === 'string' ? options.reason : undefined,
      version,
    };
    // Validation above is complete, so a refusal never leaves partial state.
    mission.status = to;
    mission.updatedAt = now;
    mission.version = version;
    mission.transitions = [...(mission.transitions ?? []), transition];
    if (recorded.length > 0) {
      mission.evidence = allEvidence;
    }
    if (to === 'completed') {
      mission.progress = 100;
      mission.completionBasis = completionBasis;
    }
    if (typeof options.reason === 'string') {
      mission.lastTransitionReason = options.reason;
    }

    this.missions.set(missionId, mission);
    return { ok: true, changed: true, mission };
  }

  /**
   * Append evidence without changing status.
   *
   * Orchestrated tasks record evidence as each one finishes, so a later
   * completion (or a resumed run) can prove which gates already passed. The
   * version is bumped, a stale `expectedVersion` is rejected, terminal missions
   * are immutable, and a replayed `executionId` for the same gate/status is
   * deduplicated instead of appended twice.
   */
  addEvidence(
    missionId: string,
    evidence: MissionEvidenceInput[],
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const mission = this.missions.get(missionId);
    if (!mission) {
      return {
        ok: false,
        code: 'MISSION_NOT_FOUND',
        message: `Mission "${missionId}" not found`,
        mission: null,
        to: 'active',
      };
    }
    if (MissionEngine.isTerminal(mission.status)) {
      return {
        ok: false,
        code: 'MISSION_TERMINAL',
        message: `Mission "${missionId}" is ${mission.status}; terminal missions are immutable`,
        mission,
        from: mission.status,
        to: mission.status,
      };
    }

    const currentVersion = mission.version ?? 0;
    if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `Mission "${missionId}" is at version ${currentVersion}, expected ${options.expectedVersion}`,
        mission,
        from: mission.status,
        to: mission.status,
      };
    }

    const now = options.now ?? new Date().toISOString();
    const normalized = normalizeEvidence(evidence, now);
    if (!normalized.ok) {
      return {
        ok: false,
        code: 'EVIDENCE_INVALID',
        message: normalized.message,
        mission,
        from: mission.status,
        to: mission.status,
      };
    }

    const existing = mission.evidence ?? [];
    const fresh = normalized.evidence.filter(
      (entry) =>
        !entry.executionId ||
        !existing.some(
          (previous) =>
            previous.gate === entry.gate &&
            previous.executionId === entry.executionId &&
            previous.status === entry.status,
        ),
    );
    if (fresh.length === 0) {
      return { ok: true, changed: false, mission };
    }

    mission.evidence = [...existing, ...fresh];
    mission.version = currentVersion + 1;
    mission.updatedAt = now;
    this.missions.set(missionId, mission);
    return { ok: true, changed: true, mission };
  }

  /** Legacy helper: returns the mission or null when the transition is refused. */
  start(missionId: string): Mission | null {
    const result = this.transition(missionId, 'active');
    return result.ok ? result.mission : null;
  }

  /** Legacy helper: returns the mission or null when completion is refused. */
  complete(missionId: string): Mission | null {
    const result = this.transition(missionId, 'completed');
    return result.ok ? result.mission : null;
  }

  /** Legacy helper: returns the mission or null when the transition is refused. */
  fail(missionId: string, reason?: string): Mission | null {
    const result = this.transition(missionId, 'failed', { reason });
    return result.ok ? result.mission : null;
  }

  pause(missionId: string, options: MissionTransitionOptions = {}): MissionTransitionResult {
    return this.transition(missionId, 'paused', options);
  }

  resume(missionId: string, options: MissionTransitionOptions = {}): MissionTransitionResult {
    return this.transition(missionId, 'active', options);
  }

  cancel(missionId: string, options: MissionTransitionOptions = {}): MissionTransitionResult {
    return this.transition(missionId, 'cancelled', options);
  }

  get(missionId: string): Mission | null {
    return this.missions.get(missionId) || null;
  }

  /**
   * Record a native collaboration session on a mission so completion can be
   * gated on convergence. Idempotent: re-registering the same session keeps one
   * tag and does not bump the version twice.
   */
  registerCollaboration(missionId: string, sessionId: string): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission || MissionEngine.isTerminal(mission.status)) return null;
    const tags = mission.tags ?? [];
    if (tags.includes(sessionId)) return mission;
    mission.tags = [...tags, sessionId];
    mission.updatedAt = new Date().toISOString();
    mission.version = (mission.version ?? 0) + 1;
    return mission;
  }

  /** Drop a collaboration tag once its session has converged (or vanished). */
  removeCollaboration(missionId: string, sessionId: string): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission || MissionEngine.isTerminal(mission.status)) return null;
    const tags = mission.tags ?? [];
    if (!tags.includes(sessionId)) return mission;
    mission.tags = tags.filter((tag) => tag !== sessionId);
    mission.updatedAt = new Date().toISOString();
    mission.version = (mission.version ?? 0) + 1;
    return mission;
  }

  list(filter?: { status?: string; type?: string; priority?: string }): Mission[] {
    let result = Array.from(this.missions.values());

    if (filter?.status) {
      result = result.filter((m) => m.status === filter.status);
    }
    if (filter?.type) {
      result = result.filter((m) => m.type === filter.type);
    }
    if (filter?.priority) {
      result = result.filter((m) => m.priority === filter.priority);
    }

    return result.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
    });
  }

  updateProgress(missionId: string, progress: number): Mission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    // Terminal states are immutable: progress after completion/failure/
    // cancellation would contradict the recorded outcome.
    if (MissionEngine.isTerminal(mission.status)) return null;

    mission.progress = Math.min(100, Math.max(0, progress));
    mission.version = (mission.version ?? 0) + 1;
    mission.updatedAt = new Date().toISOString();
    return mission;
  }

  /** Snapshot every mission as a plain array (JSON-serializable) for persistence. */
  snapshot(): Mission[] {
    return Array.from(this.missions.values());
  }

  /** Replace all in-memory missions with a previously snapshotted array. */
  restore(missions: readonly Mission[]): void {
    const entries = Array.isArray(missions) ? missions : [];
    this.missions = new Map(
      entries.map((mission) => [
        mission.id,
        { ...mission, requiredChecks: normalizeRequiredChecks(mission.requiredChecks) },
      ]),
    );
  }

  /** Restore a single mission (used to roll back a failed persistence write). */
  restoreOne(mission: Mission): void {
    const normalized: Mission = {
      ...mission,
      requiredChecks: normalizeRequiredChecks(mission.requiredChecks),
    };
    const existing = this.missions.get(normalized.id);
    if (existing) {
      // Preserve object identity so callers holding the mission observe the
      // rollback instead of a stale, half-applied transition. Delete keys the
      // failed transition added (completionBasis, lastTransitionReason):
      // Object.assign alone would leave them on the restored object.
      const target = existing as unknown as Record<string, unknown>;
      const snapshot = normalized as unknown as Record<string, unknown>;
      for (const key of Object.keys(target)) {
        if (!(key in snapshot)) delete target[key];
      }
      Object.assign(existing, normalized);
      return;
    }
    this.missions.set(normalized.id, normalized);
  }

  /** Remove a mission from memory (used to roll back a failed creation write). */
  remove(missionId: string): void {
    this.missions.delete(missionId);
  }

  /** Whether `status` is terminal (no outgoing transitions). */
  static isTerminal(status: MissionStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
  }
}
