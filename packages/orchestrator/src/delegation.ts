/**
 * Agent delegation: bounded, capability-aware task assignment that reuses the
 * existing core `CognitiveLoadBalancerEngine` (F4: wire load into assignment)
 * and the mission's explorer/fixer role policy (F9: max two concurrent
 * implementation agents).
 *
 * This is an *orchestrator-side* decision helper. It does not replace the
 * orchestrator's dispatch loop or the RolePolicyEngine — it feeds them: a
 * `DelegationPlan` tells the orchestrator *which registered agent should own
 * the next task* under a bounded-concurrency budget. The orchestrator's
 * existing governance preflight and task dispatch still apply to every task
 * (ADR-004: delegation is data, not authority).
 *
 * Delegation constraint (mission spec):
 *  - At most `maxConcurrent` (default 2) implementation agents run in parallel.
 *  - The `explorer` role is read-only (investigation only, no writes).
 *  - The `fixer` role implements within the authorized scope.
 *  - The `auditor` role verifies without authority to silently modify the
 *    implementation.
 *
 * Note: mutual exclusion of two agents editing the *same file* is NOT enforced
 * here — this module has no file/scope input. The orchestrator's per-task
 * ownership + idempotency key remains the execution-layer control; adding a
 * scope-aware lock here is documented remaining work.
 */

import type { CognitiveLoadBalancerEngine } from '@behavior-os/core';
import type { AgentConfig } from './orchestrator.js';

export type DelegationRole = 'explorer' | 'fixer' | 'auditor' | 'operator';

export interface DelegationPolicy {
  /** Maximum number of implementation agents running concurrently. */
  maxConcurrent: number;
  /** Roles that may hold write authority. */
  writeRoles: DelegationRole[];
  /** Roles that are strictly read-only. */
  readonlyRoles: DelegationRole[];
}

export const DEFAULT_DELEGATION_POLICY: DelegationPolicy = {
  maxConcurrent: 2,
  writeRoles: ['fixer', 'operator'],
  readonlyRoles: ['explorer', 'auditor'],
};

export interface AgentProfile {
  id: string;
  role: DelegationRole;
  /** Agent's declared capabilities (skill tags). */
  capabilities: string[];
  /** Authoritative authority label from `AgentConfig`. */
  authority: AgentConfig['authority'];
}

export interface DelegationTaskRequest {
  taskId: string;
  /** Skills the task requires. */
  requiredSkills: string[];
  /** Whether the task mutates state (needs write authority). */
  mutating: boolean;
  /** Current number of in-flight tasks already assigned. */
  inFlightCount: number;
}

export interface DelegationAssignment {
  taskId: string;
  agentId: string | null;
  role: DelegationRole | null;
  /** Reason the agent was selected (or why no agent was eligible). */
  reason: string;
  /** The load-based recommendation that informed the choice. */
  recommendedBy: 'load-balancer' | 'none';
}

/**
 * Deterministic, load-aware task→agent assignment under a bounded-concurrency
 * budget. Reuses the core `CognitiveLoadBalancerEngine` for load/skill
 * matching; adds the mission's role + concurrency policy on top.
 */
export class DelegationEngine {
  private readonly load: CognitiveLoadBalancerEngine;
  private readonly profiles: Map<string, AgentProfile>;
  private readonly policy: DelegationPolicy;
  private readonly reservations = new Map<string, DelegationReservation>();

  constructor(
    loadEngine: CognitiveLoadBalancerEngine,
    options: {
      profiles?: AgentProfile[];
      policy?: Partial<DelegationPolicy>;
    } = {},
  ) {
    this.load = loadEngine;
    this.policy = { ...DEFAULT_DELEGATION_POLICY, ...options.policy };
    this.profiles = new Map();
    for (const profile of options.profiles ?? []) {
      this.registerAgent(profile);
    }
  }

  registerAgent(profile: AgentProfile): void {
    this.profiles.set(profile.id, profile);
    // Mirror into the load balancer so assignment is load-aware. The
    // authority label is preserved on the profile (not the engine) so a
    // read-only role can never be promoted by a load signal.
    this.load.registerAgent(profile.id, {
      skills: profile.capabilities,
      maxCapacity: 1.0,
    });
  }

  getProfile(agentId: string): AgentProfile | undefined {
    return this.profiles.get(agentId);
  }

  /**
   * Assign the next task to an eligible agent under the policy.
   *
   * - If the concurrency budget is exhausted, no agent is assigned (the
   *   orchestrator waits; it does not over-assign).
   * - A mutating task is only ever assigned to a write-authority role.
   * - Read-only roles are never assigned mutating tasks.
   * - Within the eligible set, the load balancer picks the lowest-loaded
   *   agent that matches the required skills.
   */
  assign(request: DelegationTaskRequest): DelegationAssignment {
    const { taskId, requiredSkills, mutating, inFlightCount } = request;

    if (inFlightCount >= this.policy.maxConcurrent) {
      return {
        taskId,
        agentId: null,
        role: null,
        reason: `Concurrency budget exhausted (${inFlightCount}/${this.policy.maxConcurrent})`,
        recommendedBy: 'none',
      };
    }

    const eligible = [...this.profiles.values()].filter((profile) => {
      // A mutating task requires a write-authority role.
      if (mutating && this.policy.readonlyRoles.includes(profile.role)) return false;
      // A mutating task must not go to a role that lacks write authority.
      if (mutating && !this.policy.writeRoles.includes(profile.role)) return false;
      // Authority is a second, independent gate: a mislabelled role can never
      // turn a readonly agent into a writer (ADR-006: delegation is data).
      if (mutating && profile.authority === 'readonly') return false;
      // Skill match (if any skills are required): at least one required skill
      // must be present (same semantics as the core load balancer).
      if (requiredSkills.length > 0) {
        const hasSkills = requiredSkills.some((skill) => profile.capabilities.includes(skill));
        if (!hasSkills) return false;
      }
      // Load-based eligibility (overloaded agents are deprioritized by the
      // balancer's own threshold; we still allow assignment to a less-loaded
      // eligible agent).
      return !this.load.isAgentOverloaded(profile.id);
    });

    if (eligible.length === 0) {
      return {
        taskId,
        agentId: null,
        role: null,
        reason: mutating
          ? 'No write-authority agent is eligible for this mutating task'
          : 'No eligible agent (skills or load)',
        recommendedBy: 'none',
      };
    }

    // Ask the load balancer for the best-fit among the eligible set. We pass
    // the required skills; the balancer picks the lowest-loaded agent that
    // matches. If it names an agent that is *not* in our eligible set (e.g. an
    // overloaded one), we fall back to the lowest-loaded eligible agent.
    const recommendation = this.load.recommendAssignment(taskId, requiredSkills, {
      considerSkills: requiredSkills.length > 0,
    });
    let chosen = eligible[0];
    if (
      recommendation?.agentId &&
      eligible.some((profile) => profile.id === recommendation.agentId)
    ) {
      chosen = eligible.find((profile) => profile.id === recommendation.agentId) ?? chosen;
      return {
        taskId,
        agentId: chosen.id,
        role: chosen.role,
        reason: `load-balancer selected ${chosen.id} (${recommendation.reason})`,
        recommendedBy: 'load-balancer',
      };
    }
    // Deterministic fallback: lowest current load among the eligible set.
    chosen = eligible.reduce((best, profile) =>
      this.load.getAgentLoad(profile.id) < this.load.getAgentLoad(best.id) ? profile : best,
    );
    return {
      taskId,
      agentId: chosen.id,
      role: chosen.role,
      reason: `lowest-load eligible agent ${chosen.id}`,
      recommendedBy: 'load-balancer',
    };
  }

  /**
   * Record a task's lifecycle so the load balancer's load/fatigue stay
   * current. The orchestrator calls `onTaskStarted`/`onTaskCompleted`/
   * `onTaskFailed` from its dispatch loop (the existing `taskStarted` /
   * `taskSettled` observer hooks).
   */
  onTaskStarted(agentId: string, taskId: string): void {
    this.load.assignTask(agentId, taskId);
  }

  onTaskCompleted(agentId: string, taskId: string): void {
    this.load.completeTask(agentId, taskId);
  }

  onTaskFailed(agentId: string, taskId: string): void {
    // A settled (failed) task must release its load slot too, otherwise
    // repeated failures leak load until the agent is permanently overloaded
    // and every future assignment is refused. `completeTask` is the load
    // balancer's only release path; failure fatigue is a separate concern.
    this.load.completeTask(agentId, taskId);
  }

  getPolicy(): DelegationPolicy {
    return { ...this.policy };
  }

  /** Current load of a registered agent (0 when unknown). */
  getAgentLoad(agentId: string): number {
    return this.load.getAgentLoad(agentId);
  }

  /**
   * Atomically select an eligible agent and reserve a budget slot.
   * Returns an assignment or a refusal with reason.
   */
  reserve(request: {
    reservationKey: string;
    taskId: string;
    requiredSkills: string[];
    mutating: boolean;
  }): DelegationAssignment {
    const { reservationKey, ...task } = request;

    // 1. Reject duplicate reservation keys. Do not overwrite an existing slot.
    if (this.reservations.has(reservationKey)) {
      return {
        taskId: task.taskId,
        agentId: null,
        role: null,
        reason: `Reservation already held for ${reservationKey}`,
        recommendedBy: 'none',
      };
    }

    // 2. Select an agent using the existing pure assign() logic. The budget is
    // a ceiling on *distinct* agents, not on the number of tasks, so an agent
    // that already holds a reservation may keep taking tasks.
    const activeAgents = new Set(
      [...this.reservations.values()].map((reservation) => reservation.agentId),
    );
    const newAgentCount = activeAgents.size;
    const assignment = this.assign({ ...task, inFlightCount: newAgentCount });
    if (!assignment.agentId) return assignment;

    // 3. Defensive re-check for a new distinct agent.
    if (!activeAgents.has(assignment.agentId) && newAgentCount >= this.policy.maxConcurrent) {
      return {
        taskId: task.taskId,
        agentId: null,
        role: null,
        reason: `Concurrency budget exhausted (${activeAgents.size}/${this.policy.maxConcurrent})`,
        recommendedBy: 'none',
      };
    }

    // 5. Commit the reservation before returning.
    this.reservations.set(reservationKey, {
      taskId: task.taskId,
      agentId: assignment.agentId,
      started: false,
    });

    return assignment;
  }

  /** Mark the reservation as actually started and update load. */
  markStarted(reservationKey: string): boolean {
    const reservation = this.reservations.get(reservationKey);
    if (!reservation || reservation.started) return false;
    reservation.started = true;
    this.load.assignTask(reservation.agentId, reservationKey);
    return true;
  }

  /** Release a reservation that never reached dispatch; does not touch load. */
  cancel(reservationKey: string): boolean {
    const reservation = this.reservations.get(reservationKey);
    if (!reservation) return false;
    if (reservation.started) return false; // only cancel pre-start
    this.reservations.delete(reservationKey);
    return true;
  }

  /**
   * Release a started reservation and update load. Idempotent.
   * `completeTask` is the load balancer's only release path, so it is used
   * for both success and failure outcomes; failure fatigue is a separate
   * concern tracked in the load engine itself.
   */
  release(reservationKey: string, _completed: boolean): boolean {
    const reservation = this.reservations.get(reservationKey);
    if (!reservation) return false;
    this.reservations.delete(reservationKey);

    if (!reservation.started) return true; // never dispatched; nothing to release in load

    this.load.completeTask(reservation.agentId, reservationKey);
    return true;
  }

  /** Number of distinct agents currently holding a reservation. */
  activeAgentCount(): number {
    return new Set([...this.reservations.values()].map((reservation) => reservation.agentId)).size;
  }

  /** Number of active tasks (started or not) across all agents. */
  activeTaskCount(): number {
    return this.reservations.size;
  }

  /** Diagnostics and tests. */
  getReservations(): ReadonlyArray<{
    key: string;
    taskId: string;
    agentId: string;
    started: boolean;
  }> {
    return [...this.reservations.entries()].map(([key, res]) => ({
      key,
      taskId: res.taskId,
      agentId: res.agentId,
      started: res.started,
    }));
  }
}

/** Internal reservation record. */
interface DelegationReservation {
  taskId: string;
  agentId: string;
  started: boolean;
}
