// ============================================================
// LoopManager — autonomous control-loop execution for the plugin
// ============================================================
// Drives a real `ControlLoop` (behavioros-orchestrator) from the plugin tool
// surface. Tasks are dispatched through `AutonomousOrchestrator`, whose default
// `ShellAdapter` spawns real child processes and validates acceptance checks.
//
// Durable state lives under `.behavioros/loops/`:
//
//   <runId>.json        ControlLoop state (owned by the loop, atomic writes)
//   <runId>.plan.json   plan sidecar so a *later process* can resume the run
//
// The loop stays fail-safe: without an independent auditor it never reports
// `PASS`; it stops as `UNVERIFIED`. A blocked run (unregistered agent, missing
// adapter, pending approval) is resumable through `bos_resume_loop`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BehaviorOS } from '@behavior-os/core';
import type { DNA, MissionPriority, MissionType } from '@behavior-os/schemas';
import {
  AutonomousOrchestrator,
  ControlLoop,
  type ControlLoopPlan,
  type ControlLoopState,
  type ControlTaskDefinition,
} from 'behavioros-orchestrator';

/** Directory (relative to the session root) holding loop state and plans. */
const LOOP_STATE_DIR = '.behavioros/loops';

export type TaskAcceptanceType =
  | 'exit-code'
  | 'stdout-contains'
  | 'stdout-matches'
  | 'stderr-not-contains';

export interface LoopTaskInput {
  id: string;
  objective: string;
  adapter: string;
  agentId: string;
  acceptance: Array<{
    gate: string;
    description: string;
    type: TaskAcceptanceType;
    expected?: string;
    required?: boolean;
  }>;
  type?: string;
  phase?: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface StartLoopOptions {
  title: string;
  tasks: LoopTaskInput[];
  authorizedPhases?: string[];
  missionType?: MissionType;
  priority?: MissionPriority;
  /** Active DNA so the orchestrator does not have to re-read `dnas/<pattern>.yaml`. */
  dna?: DNA | null;
}

export interface LoopRunResult {
  runId: string;
  statePath: string;
  planPath: string;
  state: ControlLoopState;
}

/** Compact projection of the loop state for tool output. */
export interface LoopSummary {
  runId: string;
  status: ControlLoopState['status'];
  outcome?: ControlLoopState['outcome'];
  phase: ControlLoopState['phase'];
  missionId?: string;
  nextAction: ControlLoopState['nextAction'];
  audit: ControlLoopState['audit'];
  terminationReason?: string;
  limitations: string[];
  tasks: Array<{
    id: string;
    status: string;
    outcome?: string;
    attempts: number;
    error?: { code: string; message: string; retryable: boolean };
    evidence: number;
  }>;
}

/** Serialisable plan sidecar persisted next to the loop state. */
interface PlanSidecar {
  plan: ControlLoopPlan;
  authorizedPhases: string[] | null;
}

export class LoopManager {
  private readonly behaviorOS: BehaviorOS;
  private readonly rootDir: string;

  constructor(behaviorOS: BehaviorOS, rootDir: string) {
    this.behaviorOS = behaviorOS;
    this.rootDir = rootDir;
  }

  static statePath(rootDir: string, runId: string): string {
    return join(rootDir, LOOP_STATE_DIR, `${runId}.json`);
  }

  static planPath(rootDir: string, runId: string): string {
    return join(rootDir, LOOP_STATE_DIR, `${runId}.plan.json`);
  }

  /** Project a loop state into the compact tool summary. */
  static summarise(runId: string, state: ControlLoopState): LoopSummary {
    return {
      runId,
      status: state.status,
      ...(state.outcome ? { outcome: state.outcome } : {}),
      phase: state.phase,
      ...(state.missionId ? { missionId: state.missionId } : {}),
      nextAction: state.nextAction,
      audit: state.audit,
      ...(state.terminationReason ? { terminationReason: state.terminationReason } : {}),
      limitations: state.limitations,
      tasks: state.tasks.map((task) => ({
        id: task.id,
        status: task.status,
        ...(task.outcome ? { outcome: task.outcome } : {}),
        attempts: task.attempts,
        ...(task.error
          ? {
              error: {
                code: task.error.code,
                message: task.error.message,
                retryable: task.error.retryable,
              },
            }
          : {}),
        evidence: task.evidence.length,
      })),
    };
  }

  /**
   * Create and run a new control loop to completion (or until blocked).
   * Returns the run id and the terminal/blocked state.
   */
  async start(options: StartLoopOptions): Promise<LoopRunResult> {
    const runId = `loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const statePath = LoopManager.statePath(this.rootDir, runId);
    const planPath = LoopManager.planPath(this.rootDir, runId);
    mkdirSync(dirname(statePath), { recursive: true });

    const plan: ControlLoopPlan = {
      title: options.title,
      type: options.missionType ?? 'feature',
      priority: options.priority ?? 'medium',
      tasks: options.tasks as ControlTaskDefinition[],
    };

    // Persist the plan before running so a crash (or a later process) can resume.
    const sidecar: PlanSidecar = {
      plan,
      authorizedPhases: options.authorizedPhases ?? null,
    };
    writeFileSync(planPath, JSON.stringify(sidecar, null, 2), 'utf-8');

    const loop = this.createLoop(runId, plan, options.authorizedPhases, options.dna ?? null);
    const state = await loop.run();
    return { runId, statePath, planPath, state };
  }

  /**
   * Resume a loop from its persisted plan sidecar. Returns null when the run is
   * unknown to this workspace.
   */
  async resume(runId: string, dna?: DNA | null): Promise<LoopRunResult | null> {
    const planPath = LoopManager.planPath(this.rootDir, runId);
    if (!existsSync(planPath)) return null;
    const sidecar = JSON.parse(readFileSync(planPath, 'utf-8')) as PlanSidecar;
    const loop = this.createLoop(
      runId,
      sidecar.plan,
      sidecar.authorizedPhases ?? undefined,
      dna ?? null,
    );
    const state = await loop.run();
    return {
      runId,
      statePath: LoopManager.statePath(this.rootDir, runId),
      planPath,
      state,
    };
  }

  /** Read-only status snapshot: never advances the loop. */
  status(runId: string): { runId: string; exists: boolean; state: ControlLoopState | null } {
    const statePath = LoopManager.statePath(this.rootDir, runId);
    if (!existsSync(statePath)) return { runId, exists: false, state: null };
    const raw = readFileSync(statePath, 'utf-8');
    return { runId, exists: true, state: JSON.parse(raw) as ControlLoopState };
  }

  /** Known run ids in this workspace (state files, excluding plan sidecars). */
  list(): string[] {
    const dir = join(this.rootDir, LOOP_STATE_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith('.json') && !file.endsWith('.plan.json'))
      .map((file) => file.replace(/\.json$/, ''));
  }

  /**
   * Record an approval decision for a blocked loop and re-run it. A pending
   * mission-level approval is required; the run may still stop again at a
   * subsequent gate. When no approval is pending the call is a no-op that
   * returns the current state unchanged.
   */
  async approve(
    runId: string,
    decision: 'approve' | 'deny',
    reason = decision === 'approve' ? 'approved by operator' : 'denied by operator',
  ): Promise<{ runId: string; statePath: string; planPath: string; state: ControlLoopState }> {
    const planPath = LoopManager.planPath(this.rootDir, runId);
    if (!existsSync(planPath)) throw new Error(`Loop "${runId}" not found`);
    const sidecar = JSON.parse(readFileSync(planPath, 'utf-8')) as PlanSidecar;
    const loop = this.createLoop(runId, sidecar.plan, sidecar.authorizedPhases ?? undefined, null);
    // Only record when the loop is actually waiting for approval; otherwise
    // the call is a no-op and we return the current state.
    const currentState = loop.getState();
    if (currentState?.approval.status !== 'pending') {
      return {
        runId,
        statePath: LoopManager.statePath(this.rootDir, runId),
        planPath,
        state: currentState ?? (loop.getState() as ControlLoopState),
      };
    }
    loop.recordApproval(decision === 'approve' ? 'approved' : 'denied', reason);
    const state = await loop.run();
    return { runId, statePath: LoopManager.statePath(this.rootDir, runId), planPath, state };
  }

  /**
   * Build a `ControlLoop` wired to a fresh orchestrator. Every agent referenced
   * by a task is registered, otherwise the loop blocks the task with
   * `AGENT_NOT_FOUND` and never dispatches it.
   */
  private createLoop(
    runId: string,
    plan: ControlLoopPlan,
    authorizedPhases: string[] | undefined,
    dna: DNA | null,
  ): ControlLoop {
    const agentIds = [
      ...new Set(
        plan.tasks
          .map((task) => task.agentId)
          .filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
      ),
    ];

    const orchestrator = new AutonomousOrchestrator({
      behaviorOS: this.behaviorOS,
      dnasDir: join(this.rootDir, 'dnas'),
      ...(dna ? { dna } : {}),
    });

    const loopAgentId = agentIds[0] ?? this.behaviorOS.resolveAgentIdentity().agentId;
    for (const id of new Set([...agentIds, loopAgentId])) {
      orchestrator.registerAgent({
        id,
        dnaPattern: dna?.name ?? 'unassigned',
        capabilities: ['execute'],
        authority: 'write',
      });
    }

    return new ControlLoop({
      statePath: LoopManager.statePath(this.rootDir, runId),
      plan,
      agentId: loopAgentId,
      orchestrator,
      ...(authorizedPhases && authorizedPhases.length > 0 ? { authorizedPhases } : {}),
    });
  }
}
