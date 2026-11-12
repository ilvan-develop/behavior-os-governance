import type { Mission, MissionPriority, MissionStatus, MissionType } from '@behavior-os/schemas';
import type {
  MissionEvidenceInput,
  MissionTransitionOptions,
  MissionTransitionResult,
} from '../engine/mission-engine.js';
import { isCollaborationTag, MissionEngine } from '../engine/mission-engine.js';
import type { Store } from '../persistence/store.js';

/**
 * Everything the mission lifecycle needs from its host (the {@link BehaviorOS}
 * facade). The host is the single place that owns durable state, the engines and
 * the protocol cursor, so the service stays testable in isolation and the facade
 * keeps its public API as a thin delegate.
 */
export interface MissionServiceHost {
  /** Durable store, or null when persistence is disabled. */
  store(): Store | null;
  missionEngine(): MissionEngine;
  /** True when a collaboration session is closed or no longer known. */
  isCollaborationClosed(sessionId: string): boolean;
  /** Id of the mission currently in flight, if any. */
  activeMission(): string | null;
  /** Set (or clear) the active mission and stamp the agent-state update time. */
  setActiveMission(missionId: string | null): void;
  /** Name of the loaded DNA pattern, used as the mission's default. */
  dnaName(): string | null | undefined;
  /** Advance the 7-step protocol when the caller is an explicit agent action. */
  advanceProtocolStep(tool: string): void;
}

export interface CreateMissionRequest {
  title: string;
  description?: string;
  type: string;
  priority: string;
  dnaPattern?: string;
  createdBy?: string;
  tags?: string[];
  /** Gates that must each have passing evidence before completion. */
  requiredChecks?: string[];
  /** `executed` requires real, provenance-stamped evidence for every gate. */
  verificationMode?: 'any' | 'executed';
  /**
   * Whether creating this mission should advance the 7-step protocol. The
   * plugin's auto-mission passes `false` so protocol progress still reflects
   * work the agent performed explicitly. Defaults to `true`.
   */
  advanceProtocol?: boolean;
}

/**
 * Mission lifecycle extracted from the BehaviorOS facade (Fase 2.6).
 *
 * Owns creation, validated transitions, evidence append and persistence with
 * rollback. Completion waits for every collaboration tag to converge; a session
 * that vanished (for example after a restart) is dropped instead of deadlocking
 * the mission forever.
 */
export class MissionService {
  constructor(private readonly host: MissionServiceHost) {}

  /**
   * Register a native collaboration session against the mission in flight so
   * completion waits for it to converge. No-op when no mission is live:
   * collaboration outside a mission has nothing to gate.
   */
  registerCollaboration(
    kind: 'brainstorm' | 'conversation',
    sessionId: string,
    missionId?: string,
  ): Mission | null {
    const target = missionId ?? this.host.activeMission();
    if (!target || !isCollaborationTag(sessionId)) return null;
    const expected = kind === 'brainstorm' ? 'brainstorm-' : 'conv';
    if (!sessionId.startsWith(expected)) return null;
    return this.host.missionEngine().registerCollaboration(target, sessionId);
  }

  /**
   * Return the collaboration tags still awaiting convergence, dropping the ones
   * whose session is closed or no longer known.
   */
  private openCollaborations(mission: Mission): string[] {
    const tags = (mission.tags ?? []).filter(isCollaborationTag);
    if (tags.length === 0) return [];
    const engine = this.host.missionEngine();
    const open: string[] = [];
    for (const tag of tags) {
      if (this.host.isCollaborationClosed(tag)) engine.removeCollaboration(mission.id, tag);
      else open.push(tag);
    }
    return open;
  }

  create(options: CreateMissionRequest): Mission {
    const { advanceProtocol, ...missionOptions } = options;
    const engine = this.host.missionEngine();
    const mission = engine.create({
      ...missionOptions,
      type: options.type as MissionType,
      priority: options.priority as MissionPriority,
      dnaPattern: options.dnaPattern ?? this.host.dnaName() ?? 'default',
      createdBy: options.createdBy ?? 'system',
    });
    const store = this.host.store();
    if (store) {
      try {
        store.saveMission(mission);
      } catch (error) {
        // Creation must not leave a mission that durable state never saw.
        engine.remove(mission.id);
        throw error;
      }
    }
    if (advanceProtocol !== false) {
      this.host.advanceProtocolStep('bos_create_mission');
    }
    return mission;
  }

  /**
   * Apply a validated mission transition and persist it atomically.
   *
   * Memory is rolled back when the store write throws, so a failed persistence
   * can never leave the engine ahead of durable state. The write is a single
   * idempotent upsert; no multi-write transaction is claimed.
   */
  transition(
    missionId: string,
    to: MissionStatus,
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const engine = this.host.missionEngine();
    const before = engine.get(missionId);
    const rollback = before ? structuredClone(before) : null;

    // Convergence gate: a mission that opened native collaboration must let the
    // session converge before it can complete.
    if (to === 'completed' && before) {
      const open = this.openCollaborations(before);
      if (open.length > 0) {
        return {
          ok: false,
          code: 'EVIDENCE_MISSING',
          message:
            `Open collaboration must converge before completion: ${open.join(', ')}. ` +
            'Resolve each brainstorm (decided/cancelled) or conversation (resolved/cancelled) and retry.',
          mission: before,
          from: before.status,
          to,
        };
      }
    }

    const result = engine.transition(missionId, to, options);
    if (!result.ok || !result.changed) return result;

    const store = this.host.store();
    if (store) {
      try {
        store.saveMission(result.mission);
      } catch (error) {
        if (rollback) engine.restoreOne(rollback);
        return {
          ok: false,
          code: 'PERSISTENCE_FAILED',
          message: `Failed to persist mission "${missionId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          mission: rollback,
          from: before?.status,
          to,
        };
      }
    }

    if (to === 'active') {
      // Starting (or resuming) makes this the single active mission.
      this.host.setActiveMission(missionId);
    } else if (MissionEngine.isTerminal(to) && this.host.activeMission() === missionId) {
      this.host.setActiveMission(null);
    }

    return result;
  }

  /**
   * Append evidence to an in-flight mission and persist it atomically, with the
   * same rollback guarantee as {@link transition}.
   */
  addEvidence(
    missionId: string,
    evidence: MissionEvidenceInput[],
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const engine = this.host.missionEngine();
    const before = engine.get(missionId);
    const rollback = before ? structuredClone(before) : null;

    const result = engine.addEvidence(missionId, evidence, options);
    if (!result.ok || !result.changed) return result;

    const store = this.host.store();
    if (store) {
      try {
        store.saveMission(result.mission);
      } catch (error) {
        if (rollback) engine.restoreOne(rollback);
        return {
          ok: false,
          code: 'PERSISTENCE_FAILED',
          message: `Failed to persist evidence for mission "${missionId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          mission: rollback,
          from: before?.status,
          to: before?.status ?? 'active',
        };
      }
    }

    return result;
  }

  start(missionId: string, options: { advanceProtocol?: boolean } = {}): Mission | null {
    const result = this.transition(missionId, 'active');
    if (!result.ok) return null;
    if (result.changed && options.advanceProtocol !== false) {
      this.host.advanceProtocolStep('bos_start_mission');
    }
    return result.mission;
  }

  complete(missionId: string, options: MissionTransitionOptions = {}): Mission | null {
    const result = this.transition(missionId, 'completed', options);
    return result.ok ? result.mission : null;
  }

  fail(
    missionId: string,
    reason?: string,
    options: Omit<MissionTransitionOptions, 'reason'> = {},
  ): Mission | null {
    const result = this.transition(missionId, 'failed', { ...options, reason });
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
}
