import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type MissionEvidence,
  MissionEvidenceSchema,
  type MissionPriority,
  type MissionType,
  type TaskAcceptance,
  TaskAcceptanceSchema,
  type TaskError,
  TaskErrorSchema,
  type TaskStatus,
} from '@behavior-os/schemas';
import {
  type AutonomousOrchestrator,
  type MissionExecutionResult,
  type MissionObserver,
  type MissionPlan,
  normalizeRequiredSkills,
  OrchestratorError,
  type TaskDefinitionInput,
} from './orchestrator.js';

/**
 * Mission tag used to recover a first dispatch that crashed after mission
 * creation but before the control-loop state recorded the mission id.
 */
const CONTROL_LOOP_MISSION_TAG_PREFIX = 'control-loop-run:';

export type ControlOutcome = 'PASS' | 'PASS_WITH_LIMITATIONS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';

export type ControlPhase =
  | 'plan'
  | 'execute'
  | 'validate'
  | 'audit'
  | 'evidence'
  | 'learn'
  | 'next'
  | 'done';

export type ControlRunStatus = 'running' | 'blocked' | 'done' | 'failed';

export type ControlNextActionKind =
  | 'run_task'
  | 'audit'
  | 'await_approval'
  | 'resolve_unverified'
  | 'done'
  | 'failed';

export interface ControlNextAction {
  kind: ControlNextActionKind;
  taskId?: string;
  reason: string;
}

export interface ControlTaskDefinition extends TaskDefinitionInput {
  /** Engineering phase gate, for example `3D` or `3E`. */
  phase?: string;
  /** Known limitations that must survive a `PASS_WITH_LIMITATIONS` result. */
  limitations?: string[];
}

export interface ControlLoopPlan extends Omit<MissionPlan, 'tasks'> {
  tasks: ControlTaskDefinition[];
}

export interface ControlTaskState {
  id: string;
  type: string;
  objective: string;
  adapter: string;
  agentId: string;
  phase?: string;
  dependsOn: string[];
  acceptance: TaskAcceptance[];
  input: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts: number;
  idempotencyKey: string;
  /** Skills handed to delegation (empty means no skill constraint). */
  requiredSkills: string[];
  /** Whether the task mutates state. Defaults to true (safety-first). */
  mutating: boolean;
  /**
   * Agent the orchestrator actually delegated the task to. `agentId` stays
   * the plan pin so resuming a state file keeps matching its plan.
   */
  assignedAgentId?: string;
  status: TaskStatus;
  outcome?: ControlOutcome;
  attempts: number;
  error?: TaskError;
  evidence: MissionEvidence[];
  limitations: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface ControlApprovalState {
  status: 'not_required' | 'pending' | 'approved' | 'denied';
  /** Mission-scoped approval stops all dispatch; task-scoped approval does not. */
  scope: 'none' | 'mission' | 'task';
  reason?: string;
  blockedOperations: string[];
}

export interface ControlValidationState {
  status: 'not_run' | 'passed' | 'passed_with_limitations' | 'failed' | 'unverified';
  detail?: string;
  checkedAt?: string;
}

export interface ControlAuditState {
  status: 'not_run' | 'passed' | 'failed' | 'unverified';
  detail?: string;
  checkedAt?: string;
  limitations: string[];
}

export interface ControlLoopState {
  version: 1;
  runId: string;
  planSignature: string;
  missionId?: string;
  agentId: string;
  dnaPattern: string;
  /** Omitted means no phase restriction; an empty array denies every phase. */
  authorizedPhases?: string[];
  phase: ControlPhase;
  status: ControlRunStatus;
  outcome?: ControlOutcome;
  currentTaskId?: string;
  tasks: ControlTaskState[];
  evidence: MissionEvidence[];
  failureClassifications: Record<string, string[]>;
  approval: ControlApprovalState;
  validation: ControlValidationState;
  audit: ControlAuditState;
  nextAction: ControlNextAction;
  terminationReason?: string;
  limitations: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ControlAuditResult {
  status: 'passed' | 'failed' | 'unverified';
  detail: string;
  limitations?: string[];
}

export type ControlAuditor = (
  state: ControlLoopState,
) => ControlAuditResult | Promise<ControlAuditResult>;

export interface ControlLoopOptions {
  /** Durable JSON state. Atomic replacement is used after every transition. */
  statePath: string;
  plan: ControlLoopPlan;
  agentId: string;
  orchestrator: AutonomousOrchestrator;
  /** When supplied, a task in any other phase is blocked before dispatch. */
  authorizedPhases?: string[];
  /**
   * Independent final audit. Without it the loop stops as `UNVERIFIED`; it never
   * declares `PASS` from task results alone.
   */
  auditor?: ControlAuditor;
  /** Deterministic clock for tests. */
  now?: () => string;
}

export interface InitialControlStateOptions {
  authorizedPhases?: string[];
  now?: () => string;
  runId?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

/** Stable identity for a plan. A state file from a different plan is rejected. */
export function controlPlanSignature(plan: ControlLoopPlan): string {
  return createHash('sha256')
    .update(
      stableStringify({
        title: plan.title,
        description: plan.description ?? null,
        type: plan.type,
        priority: plan.priority,
        dnaPattern: plan.dnaPattern ?? null,
        tags: plan.tags ?? null,
        requiredChecks: plan.requiredChecks ?? null,
        governanceContext: plan.governanceContext ?? null,
        tasks: plan.tasks.map((task) => ({
          id: task.id,
          dependsOn: task.dependsOn ?? [],
          phase: task.phase ?? null,
          type: task.type ?? 'execute',
          objective: task.objective,
          adapter: task.adapter,
          agentId: task.agentId ?? null,
          input: task.input ?? {},
          acceptance: task.acceptance,
          timeoutMs: task.timeoutMs ?? null,
          maxAttempts: task.maxAttempts ?? null,
          idempotencyKey: task.idempotencyKey ?? null,
          limitations: task.limitations ?? [],
          // Only include delegation hints when the plan declares them, so the
          // signature of a plan written before delegation existed is stable.
          ...(task.requiredSkills && task.requiredSkills.length > 0
            ? { requiredSkills: normalizeRequiredSkills(task.id ?? 'task', task.requiredSkills) }
            : {}),
          ...(task.mutating !== undefined ? { mutating: task.mutating } : {}),
        })),
      }),
    )
    .digest('hex');
}

function normalizeAcceptance(acceptance: TaskDefinitionInput['acceptance']): TaskAcceptance[] {
  return acceptance.map((criterion) => ({
    ...criterion,
    required: criterion.required ?? true,
  }));
}

function dependencyIds(task: ControlTaskDefinition): string[] {
  return [...new Set((task.dependsOn ?? []).map((dependency) => dependency.trim()))];
}

/** Create the durable state without executing anything. Pure and testable. */
export function createInitialControlState(
  plan: ControlLoopPlan,
  agentId: string,
  options: InitialControlStateOptions = {},
): ControlLoopState {
  if (!plan.title.trim()) {
    throw new OrchestratorError('INVALID_INPUT', 'Control-loop plan requires a title');
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new OrchestratorError('INVALID_INPUT', 'Control-loop plan requires at least one task');
  }

  const now = options.now ?? (() => new Date().toISOString());
  const createdAt = now();
  const seen = new Set<string>();
  const tasks: ControlTaskState[] = plan.tasks.map((task, index) => {
    const id = (task.id ?? `task-${index + 1}`).trim();
    if (!id) {
      throw new OrchestratorError('INVALID_INPUT', `Task ${index + 1} has an empty id`);
    }
    if (seen.has(id)) {
      throw new OrchestratorError('INVALID_INPUT', `Duplicate control-loop task id "${id}"`);
    }
    seen.add(id);
    if (!task.objective.trim()) {
      throw new OrchestratorError('INVALID_INPUT', `Task "${id}" requires an objective`);
    }
    if (!task.adapter.trim()) {
      throw new OrchestratorError('INVALID_INPUT', `Task "${id}" requires an adapter`);
    }
    if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Task "${id}" requires at least one acceptance criterion`,
      );
    }
    const requiredSkills = normalizeRequiredSkills(id, task.requiredSkills);
    if (task.mutating !== undefined && typeof task.mutating !== 'boolean') {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Task "${id}" mutating must be a boolean when provided`,
      );
    }
    const dependsOn = dependencyIds(task);
    if (dependsOn.includes(id)) {
      throw new OrchestratorError('INVALID_INPUT', `Task "${id}" cannot depend on itself`);
    }
    const phase = task.phase?.trim();
    if (task.phase !== undefined && !phase) {
      throw new OrchestratorError('INVALID_INPUT', `Task "${id}" has an empty phase`);
    }
    return {
      id,
      type: task.type ?? 'execute',
      objective: task.objective,
      adapter: task.adapter,
      agentId: task.agentId ?? agentId,
      ...(phase ? { phase } : {}),
      dependsOn,
      acceptance: normalizeAcceptance(task.acceptance),
      input: task.input ?? {},
      ...(task.timeoutMs ? { timeoutMs: task.timeoutMs } : {}),
      maxAttempts: Math.min(10, Math.max(1, Math.trunc(task.maxAttempts ?? 1))),
      idempotencyKey: task.idempotencyKey ?? `${options.runId ?? createdAt}:${id}`,
      requiredSkills,
      mutating: task.mutating ?? true,
      status: 'pending',
      attempts: 0,
      evidence: [],
      limitations: [...(task.limitations ?? [])],
    };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!seen.has(dependency)) {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Task "${task.id}" depends on unknown task "${dependency}"`,
        );
      }
    }
  }
  validateControlDependencyGraph(tasks);

  const producedGates = new Set(
    tasks.flatMap((task) => task.acceptance.map((criterion) => criterion.gate)),
  );
  const gateOwners = new Map<string, string>();
  for (const task of tasks) {
    for (const criterion of task.acceptance) {
      const owner = gateOwners.get(criterion.gate);
      if (owner && owner !== task.id) {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Gate "${criterion.gate}" is produced by both "${owner}" and "${task.id}"; task evidence must be unambiguous`,
        );
      }
      gateOwners.set(criterion.gate, task.id);
    }
  }
  for (const gate of plan.requiredChecks ?? []) {
    if (!producedGates.has(gate.trim())) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Control-loop plan requires gate "${gate}" but no task produces it`,
      );
    }
  }

  const authorizedPhases = options.authorizedPhases;
  for (const task of tasks) {
    const unauthorized =
      authorizedPhases !== undefined &&
      (authorizedPhases.length === 0 ||
        task.phase === undefined ||
        !authorizedPhases.includes(task.phase));
    if (unauthorized) {
      task.status = 'blocked';
      task.outcome = 'BLOCKED';
      task.error = {
        code: 'APPROVAL_REQUIRED',
        message: `Phase "${task.phase ?? '(none)'}" is not authorized for this control-loop run`,
        retryable: false,
      };
      task.limitations.push(`phase ${task.phase ?? '(none)'} is not authorized`);
    }
  }

  propagateBlockedDependencies(tasks);

  const blocked = tasks.filter((task) => task.status === 'blocked');
  const approval: ControlApprovalState =
    blocked.length > 0
      ? {
          status: 'pending',
          scope: 'task',
          reason: 'One or more tasks are blocked before dispatch',
          blockedOperations: blocked.map((task) => task.id),
        }
      : { status: 'not_required', scope: 'none', blockedOperations: [] };

  const state: ControlLoopState = {
    version: 1,
    runId: options.runId ?? `run-${randomUUID()}`,
    planSignature: controlPlanSignature(plan),
    agentId,
    dnaPattern: plan.dnaPattern ?? 'agent-default',
    ...(options.authorizedPhases !== undefined
      ? { authorizedPhases: [...options.authorizedPhases] }
      : {}),
    phase: 'plan',
    status: blocked.length > 0 ? 'blocked' : 'running',
    ...(blocked.length > 0 ? { outcome: 'BLOCKED' as const } : {}),
    tasks,
    evidence: [],
    failureClassifications: {},
    approval,
    validation: { status: 'not_run' },
    audit: { status: 'not_run', limitations: [] },
    nextAction: { kind: 'run_task', reason: 'plan initialized' },
    limitations: tasks.flatMap((task) => task.limitations),
    createdAt,
    updatedAt: createdAt,
  };
  state.nextAction = computeNextControlAction(state);
  return state;
}

function validateControlDependencyGraph(tasks: ControlTaskState[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Control-loop dependency cycle detected at "${id}"`,
      );
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function propagateBlockedDependencies(tasks: ControlTaskState[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      const blockedBy = task.dependsOn
        .map((dependency) => tasks.find((candidate) => candidate.id === dependency))
        .find(
          (dependency) =>
            dependency !== undefined &&
            ['failed', 'cancelled', 'blocked'].includes(dependency.status),
        );
      if (!blockedBy) continue;
      task.status = 'blocked';
      task.outcome = 'BLOCKED';
      task.error = {
        code: 'DEPENDENCY_BLOCKED',
        message: `Task "${task.id}" cannot run because dependency "${blockedBy.id}" is ${blockedBy.status}`,
        retryable: false,
      };
      task.limitations.push(`dependency ${blockedBy.id} is ${blockedBy.status}`);
      changed = true;
    }
  }
}

/** Select the next eligible action from the persisted graph. */
export function computeNextControlAction(state: ControlLoopState): ControlNextAction {
  if (state.status === 'failed') {
    return { kind: 'failed', reason: state.terminationReason ?? 'control loop failed' };
  }
  if (state.approval.status === 'pending' && state.approval.scope === 'mission') {
    return {
      kind: 'await_approval',
      reason: state.approval.reason ?? 'mission-level approval is pending',
    };
  }
  if (state.approval.status === 'denied') {
    return {
      kind: 'failed',
      reason: state.approval.reason ?? 'mission-level approval was denied',
    };
  }

  const running = state.tasks.find((task) => task.status === 'running');
  if (running) {
    return { kind: 'run_task', taskId: running.id, reason: `task ${running.id} is running` };
  }

  const pending = state.tasks.filter((task) => task.status === 'pending');
  const eligible = pending.find((task) =>
    task.dependsOn.every(
      (dependency) =>
        state.tasks.find((candidate) => candidate.id === dependency)?.status === 'completed',
    ),
  );
  if (eligible) {
    return { kind: 'run_task', taskId: eligible.id, reason: `task ${eligible.id} is eligible` };
  }
  if (pending.length > 0) {
    return {
      kind: 'resolve_unverified',
      reason: 'pending tasks remain but no task is dependency-eligible',
    };
  }

  const blocked = state.tasks.filter((task) => task.status === 'blocked');
  if (blocked.length > 0) {
    if (state.approval.status === 'pending') {
      return {
        kind: 'await_approval',
        reason: `approval pending for: ${blocked.map((task) => task.id).join(', ')}`,
      };
    }
    return { kind: 'resolve_unverified', reason: 'blocked tasks require resolution' };
  }

  const failed = state.tasks.find((task) => task.status === 'failed');
  if (failed) {
    return { kind: 'failed', reason: `task ${failed.id} failed` };
  }

  if (state.tasks.some((task) => task.status !== 'completed')) {
    return { kind: 'resolve_unverified', reason: 'tasks remain incomplete' };
  }
  if (
    state.tasks.some((task) => task.outcome !== 'PASS' && task.outcome !== 'PASS_WITH_LIMITATIONS')
  ) {
    return { kind: 'resolve_unverified', reason: 'completed tasks lack valid outcomes' };
  }

  if (state.audit.status === 'passed') {
    return { kind: 'done', reason: 'all tasks and independent audit passed' };
  }
  if (state.audit.status === 'failed') {
    return { kind: 'failed', reason: 'independent audit failed' };
  }
  if (state.status === 'done') {
    return { kind: 'audit', reason: 'terminal state is missing a passing independent audit' };
  }
  return { kind: 'audit', reason: 'independent audit has not passed' };
}

export interface ClassifiedControlTask {
  outcome: ControlOutcome;
  limitations: string[];
}

/** Classify a task from its status and executed evidence. Missing evidence can never be PASS. */
export function classifyControlTask(task: ControlTaskState): ClassifiedControlTask {
  if (task.status === 'failed') return { outcome: 'FAIL', limitations: [] };
  if (task.status === 'blocked') return { outcome: 'BLOCKED', limitations: [] };
  if (task.status === 'cancelled') {
    return { outcome: 'BLOCKED', limitations: ['task was cancelled'] };
  }
  if (task.status !== 'completed') return { outcome: 'UNVERIFIED', limitations: [] };

  const pool = task.evidence;
  const required = task.acceptance.filter((criterion) => criterion.required !== false);
  const limitations = [...task.limitations];
  if (pool.length === 0) {
    return {
      outcome: 'UNVERIFIED',
      limitations: [...limitations, 'task has no executed evidence'],
    };
  }

  for (const criterion of required) {
    const latest = [...pool].reverse().find((entry) => entry.gate === criterion.gate);
    if (
      latest?.status !== 'passed' ||
      latest.provenance !== 'executed' ||
      latest.simulated === true ||
      !latest.executionId
    ) {
      return {
        outcome: 'UNVERIFIED',
        limitations: [
          ...limitations,
          `required gate ${criterion.gate} has no passing executed evidence`,
        ],
      };
    }
  }

  if (
    !pool.some(
      (entry) =>
        entry.status === 'passed' &&
        entry.provenance === 'executed' &&
        entry.simulated !== true &&
        Boolean(entry.executionId),
    )
  ) {
    return {
      outcome: 'UNVERIFIED',
      limitations: [...limitations, 'task has no passing executed evidence'],
    };
  }

  for (const criterion of task.acceptance.filter((entry) => entry.required === false)) {
    const latest = [...pool].reverse().find((entry) => entry.gate === criterion.gate);
    if (latest?.status === 'failed') {
      limitations.push(`optional gate ${criterion.gate} failed`);
    }
  }

  return {
    outcome: limitations.length > 0 ? 'PASS_WITH_LIMITATIONS' : 'PASS',
    limitations,
  };
}

export class ControlLoop {
  private readonly statePath: string;
  private readonly plan: ControlLoopPlan;
  private readonly agentId: string;
  private readonly orchestrator: AutonomousOrchestrator;
  private readonly authorizedPhases?: string[];
  private readonly auditor?: ControlAuditor;
  private readonly now: () => string;

  constructor(options: ControlLoopOptions) {
    this.statePath = options.statePath;
    this.plan = options.plan;
    this.agentId = options.agentId;
    this.orchestrator = options.orchestrator;
    this.authorizedPhases = options.authorizedPhases;
    this.auditor = options.auditor;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Read the persisted state without creating, mutating, or executing anything. */
  getState(): ControlLoopState | null {
    return this.loadState();
  }

  /**
   * Continue from persisted state. A pending approval returns the same state
   * without redispatching or re-asking; it is not an implicit approval.
   */
  async run(signal?: AbortSignal): Promise<ControlLoopState> {
    let state = this.loadState();
    if (!state) {
      state = createInitialControlState(this.plan, this.agentId, {
        ...(this.authorizedPhases ? { authorizedPhases: this.authorizedPhases } : {}),
        now: this.now,
      });
      this.persist(state);
    } else {
      this.assertPlanMatches(state);
    }

    if (state.status === 'failed') {
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }

    // A crash can happen after the mission was created but before the loop
    // persisted its id. Adopt the mission carrying this run's tag instead of
    // creating a second one on resume.
    this.adoptOrphanedMission(state);

    // Authorization and agent validity must be re-applied on every resume. A
    // state file created without a phase allow-list must not bypass a narrower
    // list supplied by the caller that resumes it.
    const authorizationChanged = this.enforceAuthorizedPhases(state);
    const agentChanged = this.enforceKnownAgents(state);
    const evidenceChanged = this.reconcileStoredEvidence(state);
    if (authorizationChanged || agentChanged || evidenceChanged) this.persist(state);

    if (state.status === 'done') {
      // Never trust a persisted terminal claim: re-derive every outcome from
      // executed evidence before accepting `done`.
      for (const task of state.tasks) {
        const classified = classifyControlTask(task);
        task.outcome = classified.outcome;
        task.limitations = [...new Set([...task.limitations, ...classified.limitations])];
        state.limitations = [...new Set([...state.limitations, ...task.limitations])];
      }
      state.limitations = [...new Set([...state.limitations, ...state.audit.limitations])];
      const incomplete = state.tasks.some((task) => task.status !== 'completed');
      const failed = state.tasks.some((task) => task.status === 'failed');
      const outcomesValid = state.tasks.every(
        (task) => task.outcome === 'PASS' || task.outcome === 'PASS_WITH_LIMITATIONS',
      );
      if (state.audit.status === 'failed') {
        state.status = 'failed';
        state.outcome = 'FAIL';
        state.phase = 'audit';
        state.terminationReason = 'AUDIT_FAILED';
        state.validation = {
          status: 'failed',
          detail: state.audit.detail,
          checkedAt: this.now(),
        };
        state.nextAction = computeNextControlAction(state);
        this.persist(state);
        return state;
      }
      if (incomplete || !outcomesValid || state.audit.status !== 'passed') {
        if (state.audit.status === 'passed') {
          state.audit = {
            status: 'unverified',
            detail: 'terminal state was invalidated on resume',
            checkedAt: this.now(),
            limitations: state.audit.limitations,
          };
        }
        state.status = failed ? 'failed' : 'blocked';
        state.outcome = failed ? 'FAIL' : 'UNVERIFIED';
        state.phase = 'validate';
        state.terminationReason = failed
          ? 'TASK_FAILED'
          : incomplete
            ? 'AUTHORIZED_TASKS_REMAIN'
            : !outcomesValid
              ? 'TASK_OUTCOME_INVALID'
              : 'INDEPENDENT_AUDIT_REQUIRED';
        state.validation = {
          status: failed ? 'failed' : 'unverified',
          detail: state.terminationReason,
          checkedAt: this.now(),
        };
        state.nextAction = computeNextControlAction(state);
        this.persist(state);
        return state;
      }
      // A persisted audit narrative is not evidence. Re-run the independent
      // auditor before accepting `done`; without one the terminal claim is
      // unverified and must remain blocked.
      if (!this.auditor) {
        state.audit = {
          status: 'unverified',
          detail: 'persisted terminal audit cannot be trusted without an independent auditor',
          checkedAt: this.now(),
          limitations: [],
        };
        state.status = 'blocked';
        state.outcome = 'UNVERIFIED';
        state.phase = 'audit';
        state.terminationReason = 'INDEPENDENT_AUDIT_REQUIRED';
        state.validation = {
          status: 'unverified',
          detail: state.audit.detail,
          checkedAt: this.now(),
        };
        state.nextAction = computeNextControlAction(state);
        this.persist(state);
        return state;
      }
      // Drop audit-derived limitations with the old narrative. Task-local
      // limitations remain and the fresh audit supplies its own.
      state.limitations = [...new Set(state.tasks.flatMap((task) => task.limitations))];
      state.audit = {
        status: 'not_run',
        detail: 'persisted audit is revalidated on resume',
        limitations: [],
      };
      state.validation = {
        status: 'not_run',
        detail: 'revalidating persisted terminal audit',
        checkedAt: this.now(),
      };
      state.status = 'running';
      state.phase = 'validate';
      delete state.outcome;
      delete state.terminationReason;
      this.persist(state);
    }
    // A mission-level approval blocks dispatch entirely. A task-level approval
    // must not stop independent authorized branches; those remain pending and
    // eligible below.
    if (state.approval.status === 'pending' && this.missionLevelApprovalPending(state)) {
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }
    if (state.approval.status === 'denied') {
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.validation = { status: 'not_run', detail: 'approval was denied' };
      state.terminationReason = 'APPROVAL_DENIED';
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }

    if (this.reconcileMissionTerminality(state)) {
      this.persist(state);
      return state;
    }

    const runnable = state.tasks.some(
      (task) => task.status === 'pending' || task.status === 'running',
    );
    if (runnable) {
      state.phase = 'execute';
      state.currentTaskId = state.tasks.find(
        (task) => task.status === 'pending' || task.status === 'running',
      )?.id;
      this.persist(state);

      try {
        const result = await this.orchestrator.executeMission(
          this.toMissionPlan(state),
          state.agentId,
          {
            ...(state.missionId ? { resumeMissionId: state.missionId } : {}),
            ...(state.evidence.length > 0 ? { seedEvidence: state.evidence } : {}),
            observer: this.observer(state),
            ...(signal ? { signal } : {}),
          },
        );
        this.applyMissionResult(state, result);
      } catch (error) {
        state.status = 'failed';
        state.outcome = 'FAIL';
        state.terminationReason = `EXECUTION_ERROR: ${
          error instanceof Error ? error.message : String(error)
        }`;
        state.validation = {
          status: 'failed',
          detail: state.terminationReason,
          checkedAt: this.now(),
        };
        state.nextAction = computeNextControlAction(state);
        this.persist(state);
        return state;
      }
    }

    this.validateState(state);
    this.persist(state);
    if (state.status !== 'running') return state;

    return await this.runAudit(state);
  }

  /** Record a human decision. It never bypasses phase/agent authorization. */
  recordApproval(
    decision: 'approved' | 'denied',
    reason = decision === 'approved' ? 'approved by operator' : 'denied by operator',
  ): ControlLoopState {
    const state = this.loadState();
    if (!state) {
      throw new OrchestratorError('INVALID_INPUT', 'No control-loop state exists to approve');
    }
    if (state.approval.status !== 'pending') {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Control-loop approval is ${state.approval.status}, not pending`,
      );
    }
    state.approval = { ...state.approval, status: decision, reason };
    if (decision === 'approved') {
      const blocked = state.tasks.some((task) => task.status === 'blocked');
      state.status = blocked ? 'blocked' : 'running';
      if (blocked) {
        state.outcome = 'BLOCKED';
      } else {
        delete state.outcome;
      }
      delete state.terminationReason;
      state.validation = { status: 'not_run', detail: 'approval recorded' };
    } else {
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.terminationReason = 'APPROVAL_DENIED';
      state.validation = { status: 'not_run', detail: 'approval denied' };
    }
    state.nextAction = computeNextControlAction(state);
    this.persist(state);
    return state;
  }

  /**
   * Reset blocked tasks so the next run can retry them after an adapter/agent
   * fix. Phase authorization still applies; dependency-blocked tasks wait for
   * their dependency.
   */
  retryBlocked(taskIds?: string[], reason = 'blocked task retried by operator'): ControlLoopState {
    const state = this.loadState();
    if (!state) {
      throw new OrchestratorError('INVALID_INPUT', 'No control-loop state exists to retry');
    }
    if (state.status === 'failed') {
      throw new OrchestratorError(
        'INVALID_INPUT',
        'A failed control-loop state is terminal and cannot be retried',
      );
    }
    const declaredLimitations = new Map<string, string[]>();
    this.plan.tasks.forEach((task, index) => {
      const id = (task.id ?? `task-${index + 1}`).trim();
      declaredLimitations.set(id, [...new Set(task.limitations ?? [])]);
    });
    const requested = taskIds ? new Set(taskIds) : undefined;
    let changed = false;
    for (const task of state.tasks) {
      if (task.status !== 'blocked') continue;
      if (requested && !requested.has(task.id)) continue;
      if (
        state.authorizedPhases !== undefined &&
        (state.authorizedPhases.length === 0 ||
          task.phase === undefined ||
          !state.authorizedPhases.includes(task.phase))
      ) {
        continue;
      }
      if (task.error?.code === 'AGENT_NOT_FOUND' && !this.orchestrator.hasAgent(task.agentId)) {
        continue;
      }
      if (
        task.error?.code === 'DEPENDENCY_BLOCKED' &&
        task.dependsOn.some(
          (dependency) =>
            state.tasks.find((candidate) => candidate.id === dependency)?.status !== 'completed',
        )
      ) {
        continue;
      }
      task.status = 'pending';
      task.attempts = 0;
      // Derived limitations describe the blocker being retried, not a standing
      // property of the task. Keep only limitations declared by the plan.
      task.limitations = [...new Set(declaredLimitations.get(task.id) ?? [])];
      delete task.outcome;
      delete task.error;
      delete task.startedAt;
      delete task.completedAt;
      // A retried task is no longer assigned; only a new dispatch records a
      // fresh assignment.
      delete task.assignedAgentId;
      const failures = new Set(state.failureClassifications[task.id] ?? []);
      failures.add(`RETRY_REQUESTED: ${reason}`);
      state.failureClassifications[task.id] = [...failures];
      changed = true;
    }
    if (!changed) {
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }

    state.limitations = [
      ...new Set([...state.tasks.flatMap((task) => task.limitations), ...state.audit.limitations]),
    ];
    const blocked = state.tasks.filter((task) => task.status === 'blocked');
    state.approval =
      blocked.length > 0
        ? {
            ...state.approval,
            status: 'pending',
            blockedOperations: blocked.map((task) => task.id),
          }
        : { status: 'not_required', scope: 'none', blockedOperations: [] };
    state.status = blocked.length > 0 ? 'blocked' : 'running';
    if (blocked.length > 0) {
      state.outcome = 'BLOCKED';
      state.terminationReason = 'BLOCKED_TASKS_REMAIN';
    } else {
      delete state.outcome;
      delete state.terminationReason;
    }
    state.validation = { status: 'not_run', detail: 'blocked tasks retried' };
    state.nextAction = computeNextControlAction(state);
    this.persist(state);
    return state;
  }

  private observer(state: ControlLoopState): MissionObserver {
    return {
      missionCreated: (mission) => {
        if (state.missionId && state.missionId !== mission.id) {
          throw new Error(
            `Control-loop state is bound to mission "${state.missionId}", not "${mission.id}"`,
          );
        }
        state.missionId = mission.id;
        state.phase = 'execute';
        this.persist(state);
      },
      taskStarted: (task) => {
        const stored = state.tasks.find((candidate) => candidate.id === task.id);
        if (!stored) {
          throw new Error(`Control-loop state has no task "${task.id}"`);
        }
        stored.status = 'running';
        stored.startedAt = task.updatedAt;
        stored.assignedAgentId = task.agentId;
        state.phase = 'execute';
        state.currentTaskId = task.id;
        this.persist(state);
      },
      taskSettled: (_task, result) => {
        const stored = state.tasks.find((candidate) => candidate.id === result.id);
        if (!stored) {
          throw new Error(`Control-loop state has no settled task "${result.id}"`);
        }
        stored.status = result.status;
        // A resumed task that was skipped reports `attempts: 0` and carries
        // the plan pin, not a real dispatch. Only a real dispatch may update
        // the recorded assignment.
        if (result.attempts > 0) {
          stored.assignedAgentId = result.agentId;
        }
        stored.attempts = Math.max(stored.attempts, result.attempts);
        stored.completedAt = result.completedAt;
        stored.evidence = result.evidence;
        if (result.error) {
          stored.error = result.error;
          const failures = new Set(state.failureClassifications[stored.id] ?? []);
          failures.add(result.error.code);
          state.failureClassifications[stored.id] = [...failures];
        } else {
          delete stored.error;
        }
        this.mergeEvidence(state, result.evidence);
        state.phase = 'validate';
        state.nextAction = computeNextControlAction(state);
        this.persist(state);
      },
    };
  }

  private applyMissionResult(state: ControlLoopState, result: MissionExecutionResult): void {
    state.missionId = result.missionId;
    for (const settled of result.tasks) {
      const stored = state.tasks.find((candidate) => candidate.id === settled.id);
      if (!stored) continue;
      stored.status = settled.status;
      // A skipped resume result carries the plan pin and `attempts: 0`; only a
      // real dispatch may update the recorded assignment.
      if (settled.attempts > 0) {
        stored.assignedAgentId = settled.agentId;
      }
      stored.attempts = Math.max(stored.attempts, settled.attempts);
      stored.completedAt = settled.completedAt;
      stored.evidence = settled.evidence;
      if (settled.error) {
        stored.error = settled.error;
        const failures = new Set(state.failureClassifications[stored.id] ?? []);
        failures.add(settled.error.code);
        state.failureClassifications[stored.id] = [...failures];
      } else {
        delete stored.error;
      }
      this.mergeEvidence(state, settled.evidence);
    }

    const mission = this.orchestrator.getMission(result.missionId);
    if (mission?.dnaPattern) state.dnaPattern = mission.dnaPattern;
    state.phase = 'validate';

    if (result.outcome === 'blocked') {
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.approval = {
        status: 'pending',
        scope:
          result.error?.code === 'APPROVAL_REQUIRED' && result.tasks.length === 0
            ? 'mission'
            : 'task',
        reason: result.error?.message ?? 'mission blocked',
        blockedOperations: state.tasks
          .filter((task) => task.status !== 'completed')
          .map((task) => task.id),
      };
      state.terminationReason = result.error?.code ?? 'BLOCKED';
    } else if (result.outcome === 'failed') {
      state.status = 'failed';
      state.outcome = 'FAIL';
      state.terminationReason = result.error?.code ?? 'MISSION_FAILED';
    } else if (result.outcome === 'cancelled') {
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.terminationReason = 'CANCELLED';
    }
    state.nextAction = computeNextControlAction(state);
  }

  private validateState(state: ControlLoopState): void {
    if (state.approval.status === 'pending' && state.approval.scope === 'mission') {
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.validation = {
        status: 'not_run',
        detail: 'mission-level approval is pending; no task evidence is available',
        checkedAt: this.now(),
      };
      state.nextAction = computeNextControlAction(state);
      return;
    }

    for (const task of state.tasks) {
      const classified = classifyControlTask(task);
      task.outcome = classified.outcome;
      task.limitations = [...new Set([...task.limitations, ...classified.limitations])];
    }

    const outcomes = state.tasks.map((task) => task.outcome ?? 'UNVERIFIED');
    const limitations = [
      ...new Set([...state.limitations, ...state.tasks.flatMap((task) => task.limitations)]),
    ];
    state.limitations = limitations;

    let validationStatus: ControlValidationState['status'];
    let outcome: ControlOutcome;
    if (outcomes.includes('FAIL')) {
      validationStatus = 'failed';
      outcome = 'FAIL';
    } else if (outcomes.includes('BLOCKED')) {
      validationStatus = 'failed';
      outcome = 'BLOCKED';
    } else if (outcomes.includes('UNVERIFIED')) {
      validationStatus = 'unverified';
      outcome = 'UNVERIFIED';
    } else if (outcomes.includes('PASS_WITH_LIMITATIONS') || limitations.length > 0) {
      validationStatus = 'passed_with_limitations';
      outcome = 'PASS_WITH_LIMITATIONS';
    } else {
      validationStatus = 'passed';
      outcome = 'PASS';
    }

    state.validation = {
      status: validationStatus,
      detail: `tasks: ${state.tasks
        .map((task) => `${task.id}=${task.outcome ?? 'UNVERIFIED'}`)
        .join(', ')}`,
      checkedAt: this.now(),
    };
    state.outcome = outcome;
    state.phase = 'validate';
    if (outcome === 'FAIL') {
      state.status = 'failed';
      state.terminationReason ??= 'TASK_FAILED';
    } else if (outcome === 'BLOCKED') {
      state.status = 'blocked';
      state.terminationReason ??= 'TASK_BLOCKED';
    } else if (outcome === 'UNVERIFIED') {
      state.status = 'blocked';
      state.terminationReason ??= 'EVIDENCE_UNVERIFIED';
    } else {
      state.status = 'running';
    }
    state.nextAction = computeNextControlAction(state);
  }

  private async runAudit(state: ControlLoopState): Promise<ControlLoopState> {
    if (state.status !== 'running') return state;
    const pending = state.tasks.some(
      (task) => task.status === 'pending' || task.status === 'running',
    );
    if (pending) {
      state.status = 'blocked';
      state.outcome = 'UNVERIFIED';
      state.terminationReason = 'AUTHORIZED_TASKS_REMAIN';
      state.validation = {
        status: 'unverified',
        detail: 'tasks remain pending before independent audit',
        checkedAt: this.now(),
      };
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }

    state.phase = 'audit';
    this.persist(state);
    if (!this.auditor) {
      state.audit = {
        status: 'unverified',
        detail: 'No independent auditor was supplied',
        checkedAt: this.now(),
        limitations: [],
      };
      state.status = 'blocked';
      state.outcome = 'UNVERIFIED';
      state.terminationReason = 'INDEPENDENT_AUDIT_REQUIRED';
      state.validation = {
        status: 'unverified',
        detail: 'No independent auditor was supplied',
        checkedAt: this.now(),
      };
      state.nextAction = computeNextControlAction(state);
      this.persist(state);
      return state;
    }

    let audit: ControlAuditResult;
    try {
      audit = await this.auditor(state);
    } catch (error) {
      audit = {
        status: 'unverified',
        detail: `Auditor threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    state.audit = {
      status: audit.status,
      detail: audit.detail,
      checkedAt: this.now(),
      limitations: audit.limitations ?? [],
    };
    state.limitations = [...new Set([...state.limitations, ...(audit.limitations ?? [])])];
    state.validation = {
      status:
        audit.status === 'passed'
          ? state.limitations.length > 0
            ? 'passed_with_limitations'
            : 'passed'
          : audit.status === 'failed'
            ? 'failed'
            : 'unverified',
      detail: audit.detail,
      checkedAt: this.now(),
    };

    if (audit.status === 'passed') {
      state.phase = 'evidence';
      this.persist(state);
      state.phase = 'learn';
      this.persist(state);
      state.phase = 'next';
      this.persist(state);
      state.status = 'done';
      state.outcome = state.limitations.length > 0 ? 'PASS_WITH_LIMITATIONS' : 'PASS';
      state.terminationReason = 'ALL_AUTHORIZED_TASKS_COMPLETE_AND_AUDITED';
      state.phase = 'done';
      state.nextAction = computeNextControlAction(state);
    } else if (audit.status === 'failed') {
      state.status = 'failed';
      state.outcome = 'FAIL';
      state.terminationReason = 'AUDIT_FAILED';
      state.nextAction = computeNextControlAction(state);
    } else {
      state.status = 'blocked';
      state.outcome = 'UNVERIFIED';
      state.terminationReason = 'AUDIT_UNVERIFIED';
      state.nextAction = computeNextControlAction(state);
    }
    this.persist(state);
    return state;
  }

  private missionLevelApprovalPending(state: ControlLoopState): boolean {
    return state.approval.status === 'pending' && state.approval.scope === 'mission';
  }

  private enforceAuthorizedPhases(state: ControlLoopState): boolean {
    const stored = state.authorizedPhases;
    const current = this.authorizedPhases;
    // A caller-supplied list is authoritative (including an empty deny-all
    // list). Without one, the persisted list is honoured. Undefined means the
    // loop was never restricted.
    const effective = current !== undefined ? [...current] : stored ? [...stored] : undefined;
    const configChanged = JSON.stringify(stored ?? null) !== JSON.stringify(effective ?? null);
    if (effective === undefined) {
      if (configChanged) delete state.authorizedPhases;
      return configChanged;
    }
    state.authorizedPhases = [...effective];

    let changed = configChanged;
    let phaseChanged = false;
    for (const task of state.tasks) {
      const unauthorized =
        effective.length === 0 || task.phase === undefined || !effective.includes(task.phase);
      if (!unauthorized) continue;
      const label = task.phase ?? '(none)';
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'blocked';
        task.outcome = 'BLOCKED';
        task.error = {
          code: 'APPROVAL_REQUIRED',
          message: `Phase "${label}" is not authorized for this control-loop run`,
          retryable: false,
        };
        task.limitations = [...new Set([...task.limitations, `phase ${label} is not authorized`])];
        changed = true;
        phaseChanged = true;
      } else if (task.status === 'completed') {
        const limitation = `phase ${label} was completed before authorization was narrowed`;
        if (!task.limitations.includes(limitation)) {
          task.limitations.push(limitation);
          if (task.outcome === 'PASS') task.outcome = 'PASS_WITH_LIMITATIONS';
          changed = true;
          phaseChanged = true;
        }
      }
    }

    const blocked = state.tasks.filter((task) => task.status === 'blocked');
    if (phaseChanged && blocked.length > 0) {
      propagateBlockedDependencies(state.tasks);
      state.status = 'blocked';
      state.outcome = 'BLOCKED';
      state.terminationReason = 'UNAUTHORIZED_PHASE';
      state.validation = {
        status: 'not_run',
        detail:
          effective.length === 0
            ? 'phase allow-list is empty; every task is blocked'
            : `phases outside [${effective.join(', ')}] are blocked`,
        checkedAt: this.now(),
      };
      if (state.approval.status !== 'denied') {
        state.approval = {
          status: 'pending',
          scope:
            state.approval.status === 'pending' && state.approval.scope === 'mission'
              ? 'mission'
              : 'task',
          reason: `phase authorization blocked: ${
            effective.length === 0 ? '(none)' : effective.join(', ')
          }`,
          blockedOperations: blocked.map((task) => task.id),
        };
      }
      changed = true;
    }
    state.nextAction = computeNextControlAction(state);
    return changed;
  }

  private enforceKnownAgents(state: ControlLoopState): boolean {
    let changed = false;
    for (const task of state.tasks) {
      if (task.status !== 'pending' && task.status !== 'running') continue;
      if (this.orchestrator.hasAgent(task.agentId)) continue;
      task.status = 'blocked';
      task.outcome = 'BLOCKED';
      task.error = {
        code: 'AGENT_NOT_FOUND',
        message: `Agent "${task.agentId}" is not registered`,
        retryable: false,
      };
      task.limitations = [
        ...new Set([...task.limitations, `agent ${task.agentId} is not registered`]),
      ];
      changed = true;
    }
    if (!changed) return false;
    propagateBlockedDependencies(state.tasks);
    state.status = 'blocked';
    state.outcome = 'BLOCKED';
    state.terminationReason = 'AGENT_NOT_FOUND';
    state.validation = {
      status: 'not_run',
      detail: 'one or more tasks reference an unregistered agent',
      checkedAt: this.now(),
    };
    if (state.approval.status !== 'denied') {
      state.approval = {
        status: 'pending',
        scope:
          state.approval.status === 'pending' && state.approval.scope === 'mission'
            ? 'mission'
            : 'task',
        reason: 'one or more tasks reference an unregistered agent',
        blockedOperations: state.tasks
          .filter((task) => task.status === 'blocked')
          .map((task) => task.id),
      };
    }
    state.nextAction = computeNextControlAction(state);
    return true;
  }

  private reconcileStoredEvidence(state: ControlLoopState): boolean {
    let changed = false;
    for (const task of state.tasks) {
      if (task.status !== 'completed') continue;
      const classified = classifyControlTask(task);
      if (classified.outcome === 'UNVERIFIED') {
        task.status = 'blocked';
        task.outcome = 'UNVERIFIED';
        task.error = {
          code: 'PERSISTENCE_FAILED',
          message: 'Completed task state has no valid executed evidence',
          retryable: false,
        };
        task.limitations = [...new Set([...task.limitations, ...classified.limitations])];
        changed = true;
      }
    }
    if (changed) {
      propagateBlockedDependencies(state.tasks);
      state.status = 'blocked';
      state.outcome = 'UNVERIFIED';
      state.terminationReason = 'EVIDENCE_UNVERIFIED';
      if (state.audit.status === 'passed') {
        state.audit = {
          status: 'unverified',
          detail: 'completed task evidence changed after the audit passed',
          checkedAt: this.now(),
          limitations: state.audit.limitations,
        };
      }
      state.validation = {
        status: 'unverified',
        detail: 'completed task evidence could not be verified',
        checkedAt: this.now(),
      };
      if (state.approval.status !== 'denied') {
        state.approval = {
          status: 'pending',
          scope:
            state.approval.status === 'pending' && state.approval.scope === 'mission'
              ? 'mission'
              : 'task',
          reason: 'Completed task state could not be verified from persisted evidence',
          blockedOperations: state.tasks
            .filter((task) => task.status === 'blocked')
            .map((task) => task.id),
        };
      }
      state.nextAction = computeNextControlAction(state);
    }
    return changed;
  }

  private adoptOrphanedMission(state: ControlLoopState): boolean {
    if (state.missionId) return false;
    const tag = `${CONTROL_LOOP_MISSION_TAG_PREFIX}${state.runId}`;
    const matches = this.orchestrator
      .listMissions()
      .filter((mission) => (mission.tags ?? []).includes(tag));
    if (matches.length === 0) return false;
    if (matches.length > 1) {
      throw new OrchestratorError(
        'PERSISTENCE_FAILED',
        `Multiple missions carry control-loop tag "${tag}"; refusing to choose one`,
      );
    }
    state.missionId = matches[0].id;
    state.phase = 'execute';
    state.nextAction = computeNextControlAction(state);
    this.persist(state);
    return true;
  }

  private reconcileMissionTerminality(state: ControlLoopState): boolean {
    if (!state.missionId) return false;
    const mission = this.orchestrator.getMission(state.missionId);
    if (!mission) return false;
    if (!['completed', 'failed', 'cancelled'].includes(mission.status)) return false;

    const pending = state.tasks.some(
      (task) => task.status === 'pending' || task.status === 'running',
    );
    if (!pending) return false;

    for (const task of state.tasks) {
      if (task.status !== 'pending' && task.status !== 'running') continue;
      task.status = 'blocked';
      task.outcome = 'UNVERIFIED';
      task.error = {
        code: 'PERSISTENCE_FAILED',
        message: `Mission "${mission.id}" is already ${mission.status}; refusing to duplicate work`,
        retryable: false,
      };
      task.limitations.push(`mission is already ${mission.status}`);
    }
    state.status = 'blocked';
    state.outcome = 'UNVERIFIED';
    state.terminationReason = `MISSION_TERMINAL:${mission.status}`;
    state.nextAction = computeNextControlAction(state);
    return true;
  }

  private toMissionPlan(state: ControlLoopState): MissionPlan {
    const included = state.tasks.filter(
      (task) =>
        task.status === 'completed' || task.status === 'pending' || task.status === 'running',
    );
    const includedIds = new Set(included.map((task) => task.id));
    const tasks: TaskDefinitionInput[] = included.map((task) => ({
      id: task.id,
      dependsOn: task.dependsOn.filter((dependency) => includedIds.has(dependency)),
      type: task.type,
      objective: task.objective,
      adapter: task.adapter,
      agentId: task.agentId,
      input: task.input,
      acceptance: task.acceptance,
      ...(task.timeoutMs ? { timeoutMs: task.timeoutMs } : {}),
      maxAttempts: task.maxAttempts,
      idempotencyKey: task.idempotencyKey,
      ...(task.requiredSkills.length > 0 ? { requiredSkills: task.requiredSkills } : {}),
      mutating: task.mutating,
    }));
    const produced = new Set(
      tasks.flatMap((task) => task.acceptance.map((criterion) => criterion.gate)),
    );
    const required = new Set<string>();
    for (const gate of this.plan.requiredChecks ?? []) {
      if (produced.has(gate)) required.add(gate);
    }
    for (const task of tasks) {
      for (const criterion of task.acceptance) {
        if (criterion.required) required.add(criterion.gate);
      }
    }
    return {
      title: this.plan.title,
      ...(this.plan.description ? { description: this.plan.description } : {}),
      type: this.plan.type as MissionType,
      priority: this.plan.priority as MissionPriority,
      ...(this.plan.dnaPattern ? { dnaPattern: this.plan.dnaPattern } : {}),
      tags: [
        ...new Set([...(this.plan.tags ?? []), `${CONTROL_LOOP_MISSION_TAG_PREFIX}${state.runId}`]),
      ],
      requiredChecks: [...required],
      tasks,
      ...(this.plan.governanceContext ? { governanceContext: this.plan.governanceContext } : {}),
    };
  }

  private mergeEvidence(state: ControlLoopState, evidence: MissionEvidence[]): void {
    const seen = new Set(
      state.evidence.map(
        (entry) => `${entry.executionId ?? 'no-exec'}:${entry.gate}:${entry.status}`,
      ),
    );
    for (const entry of evidence) {
      const key = `${entry.executionId ?? 'no-exec'}:${entry.gate}:${entry.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      state.evidence.push(entry);
    }
  }

  private assertPlanMatches(state: ControlLoopState): void {
    const signature = controlPlanSignature(this.plan);
    if (state.planSignature !== signature) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        'Persisted control-loop state belongs to a different plan',
      );
    }
    if (state.agentId !== this.agentId) {
      throw new OrchestratorError(
        'PERSISTENCE_FAILED',
        'Persisted control-loop state belongs to a different agent',
      );
    }
    if (state.tasks.length !== this.plan.tasks.length) {
      throw new OrchestratorError(
        'PERSISTENCE_FAILED',
        'Persisted control-loop task count does not match the plan',
      );
    }

    const storedById = new Map(state.tasks.map((task) => [task.id, task]));
    for (const [index, task] of this.plan.tasks.entries()) {
      const id = (task.id ?? `task-${index + 1}`).trim();
      const stored = storedById.get(id);
      if (!stored) {
        throw new OrchestratorError(
          'PERSISTENCE_FAILED',
          `Persisted control-loop state is missing task "${id}"`,
        );
      }
      const expected = {
        type: task.type ?? 'execute',
        objective: task.objective,
        adapter: task.adapter,
        agentId: task.agentId ?? this.agentId,
        phase: task.phase?.trim() || undefined,
        dependsOn: [...new Set((task.dependsOn ?? []).map((dependency) => dependency.trim()))],
        acceptance: normalizeAcceptance(task.acceptance),
        input: task.input ?? {},
        timeoutMs: task.timeoutMs ? task.timeoutMs : undefined,
        maxAttempts: Math.min(10, Math.max(1, Math.trunc(task.maxAttempts ?? 1))),
        idempotencyKey: task.idempotencyKey,
        requiredSkills: normalizeRequiredSkills(id, task.requiredSkills),
        mutating: task.mutating ?? true,
      };
      const matches =
        stored.type === expected.type &&
        stored.objective === expected.objective &&
        stored.adapter === expected.adapter &&
        stored.agentId === expected.agentId &&
        isDeepStrictEqual(stored.phase, expected.phase) &&
        isDeepStrictEqual(stored.dependsOn, expected.dependsOn) &&
        isDeepStrictEqual(stored.acceptance, expected.acceptance) &&
        isDeepStrictEqual(stored.input, expected.input) &&
        isDeepStrictEqual(stored.timeoutMs, expected.timeoutMs) &&
        isDeepStrictEqual(stored.requiredSkills ?? [], expected.requiredSkills) &&
        (stored.mutating ?? true) === expected.mutating &&
        stored.maxAttempts === expected.maxAttempts &&
        (expected.idempotencyKey === undefined ||
          stored.idempotencyKey === expected.idempotencyKey);
      if (!matches) {
        throw new OrchestratorError(
          'PERSISTENCE_FAILED',
          `Persisted control-loop task "${id}" does not match the plan`,
        );
      }
    }
  }

  private loadState(): ControlLoopState | null {
    if (!existsSync(this.statePath)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as unknown;
    } catch (error) {
      throw new OrchestratorError(
        'PERSISTENCE_FAILED',
        `Control-loop state is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!isControlLoopState(parsed)) {
      throw new OrchestratorError(
        'PERSISTENCE_FAILED',
        'Control-loop state does not match the persisted state contract',
      );
    }
    // Zod defaults are not applied by `safeParse().success`; normalize the
    // persisted acceptance flags before they can drive classification.
    for (const task of parsed.tasks) {
      task.acceptance = task.acceptance.map((criterion) => ({
        ...criterion,
        required: criterion.required ?? true,
      }));
      // Delegation hints were added after the first state version. Older
      // state files keep their original safety posture: mutating by default.
      task.requiredSkills ??= [];
      task.mutating ??= true;
    }
    return parsed;
  }

  private persist(state: ControlLoopState): void {
    state.updatedAt = this.now();
    const directory = dirname(this.statePath);
    mkdirSync(directory, { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameWithRetry(temporary, this.statePath);
  }
}

/** Delays between atomic-rename attempts; the first attempt is immediate. */
const RENAME_RETRY_DELAYS_MS = [0, 10, 25, 50, 100];

/**
 * Atomically move `from` over `to`, retrying the transient denials Windows
 * produces while a scanner or indexer still holds the freshly written file.
 * Permanent errors (ENOENT, ENOSPC, ...) are thrown immediately.
 */
export function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => void = renameSync,
  wait: (ms: number) => void = sleepSync,
): void {
  let lastError: unknown;
  for (const delay of RENAME_RETRY_DELAYS_MS) {
    if (delay > 0) wait(delay);
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Synchronous sleep without a timer; callers are already on the sync path. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const CONTROL_PHASES = new Set<string>([
  'plan',
  'execute',
  'validate',
  'audit',
  'evidence',
  'learn',
  'next',
  'done',
]);
const CONTROL_RUN_STATUSES = new Set<string>(['running', 'blocked', 'done', 'failed']);
const CONTROL_OUTCOMES = new Set<string>([
  'PASS',
  'PASS_WITH_LIMITATIONS',
  'FAIL',
  'BLOCKED',
  'UNVERIFIED',
]);
const CONTROL_TASK_STATUSES = new Set<string>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);
const CONTROL_APPROVAL_STATUSES = new Set<string>([
  'not_required',
  'pending',
  'approved',
  'denied',
]);
const CONTROL_VALIDATION_STATUSES = new Set<string>([
  'not_run',
  'passed',
  'passed_with_limitations',
  'failed',
  'unverified',
]);
const CONTROL_AUDIT_STATUSES = new Set<string>(['not_run', 'passed', 'failed', 'unverified']);
const CONTROL_NEXT_ACTIONS = new Set<string>([
  'run_task',
  'audit',
  'await_approval',
  'resolve_unverified',
  'done',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFinitePositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function isControlTaskState(value: unknown): value is ControlTaskState {
  if (!isRecord(value)) return false;
  const acceptance = TaskAcceptanceSchema.array().min(1).safeParse(value.acceptance);
  // Reject empty strings for required identifiers.
  if (
    typeof value.id !== 'string' ||
    value.id.trim().length === 0 ||
    typeof value.type !== 'string' ||
    value.type.trim().length === 0 ||
    typeof value.objective !== 'string' ||
    value.objective.trim().length === 0 ||
    typeof value.adapter !== 'string' ||
    value.adapter.trim().length === 0 ||
    typeof value.agentId !== 'string' ||
    value.agentId.trim().length === 0 ||
    typeof value.idempotencyKey !== 'string' ||
    value.idempotencyKey.trim().length === 0
  ) {
    return false;
  }
  const attempts = value.attempts as number | undefined;
  const maxAttempts = value.maxAttempts as number | undefined;
  const timeoutMs = value.timeoutMs as number | undefined;
  if (
    !isNonNegativeInteger(attempts) ||
    !Number.isInteger(maxAttempts) ||
    (maxAttempts ?? 0) < 1 ||
    (maxAttempts ?? 0) > 10 ||
    (timeoutMs !== undefined && !isFinitePositiveNumber(timeoutMs))
  ) {
    return false;
  }
  return (
    (value.phase === undefined ||
      (typeof value.phase === 'string' && value.phase.trim().length > 0)) &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.length >= 0 &&
    value.dependsOn.every(
      (dependency) => typeof dependency === 'string' && dependency.trim().length > 0,
    ) &&
    (value.requiredSkills === undefined ||
      (Array.isArray(value.requiredSkills) &&
        value.requiredSkills.every(
          (skill) => typeof skill === 'string' && skill.trim().length > 0,
        ))) &&
    (value.mutating === undefined || typeof value.mutating === 'boolean') &&
    (value.assignedAgentId === undefined ||
      (typeof value.assignedAgentId === 'string' && value.assignedAgentId.trim().length > 0)) &&
    acceptance.success &&
    isRecord(value.input) &&
    CONTROL_TASK_STATUSES.has(value.status as string) &&
    (value.outcome === undefined || CONTROL_OUTCOMES.has(value.outcome as string)) &&
    (value.startedAt === undefined ||
      (typeof value.startedAt === 'string' && value.startedAt.trim().length > 0)) &&
    (value.completedAt === undefined ||
      (typeof value.completedAt === 'string' && value.completedAt.trim().length > 0)) &&
    Array.isArray(value.evidence) &&
    value.evidence.every((entry) => MissionEvidenceSchema.safeParse(entry).success) &&
    Array.isArray(value.limitations) &&
    value.limitations.every((limitation) => typeof limitation === 'string') &&
    (value.error === undefined || TaskErrorSchema.safeParse(value.error).success)
  );
}

function isControlLoopState(value: unknown): value is ControlLoopState {
  if (!isRecord(value)) return false;
  const state = value as Partial<ControlLoopState>;
  // Required string fields must be non-empty.
  if (
    typeof state.runId !== 'string' ||
    state.runId.trim().length === 0 ||
    typeof state.planSignature !== 'string' ||
    state.planSignature.trim().length === 0 ||
    typeof state.agentId !== 'string' ||
    state.agentId.trim().length === 0 ||
    typeof state.dnaPattern !== 'string' ||
    state.dnaPattern.trim().length === 0 ||
    typeof state.phase !== 'string' ||
    state.phase.trim().length === 0 ||
    typeof state.status !== 'string' ||
    state.status.trim().length === 0 ||
    typeof state.createdAt !== 'string' ||
    state.createdAt.trim().length === 0 ||
    typeof state.updatedAt !== 'string' ||
    state.updatedAt.trim().length === 0
  ) {
    return false;
  }
  return (
    state.version === 1 &&
    CONTROL_PHASES.has(state.phase) &&
    CONTROL_RUN_STATUSES.has(state.status) &&
    (state.outcome === undefined || CONTROL_OUTCOMES.has(state.outcome)) &&
    Array.isArray(state.tasks) &&
    state.tasks.length > 0 &&
    state.tasks.every((task) => isControlTaskState(task)) &&
    new Set(state.tasks.map((task) => task.id)).size === state.tasks.length &&
    Array.isArray(state.evidence) &&
    state.evidence.every((entry) => MissionEvidenceSchema.safeParse(entry).success) &&
    isRecord(state.failureClassifications) &&
    Object.values(state.failureClassifications).every(
      (codes) => Array.isArray(codes) && codes.every((code) => typeof code === 'string'),
    ) &&
    isRecord(state.approval) &&
    CONTROL_APPROVAL_STATUSES.has(state.approval.status as string) &&
    ['none', 'mission', 'task'].includes(state.approval.scope as string) &&
    Array.isArray(state.approval.blockedOperations) &&
    state.approval.blockedOperations.every(
      (id) => typeof id === 'string' && id.trim().length > 0,
    ) &&
    isRecord(state.validation) &&
    CONTROL_VALIDATION_STATUSES.has(state.validation.status as string) &&
    isRecord(state.audit) &&
    CONTROL_AUDIT_STATUSES.has(state.audit.status as string) &&
    Array.isArray(state.audit.limitations) &&
    state.audit.limitations.every((limitation) => typeof limitation === 'string') &&
    isRecord(state.nextAction) &&
    CONTROL_NEXT_ACTIONS.has(state.nextAction.kind as string) &&
    typeof state.nextAction.reason === 'string' &&
    state.nextAction.reason.trim().length > 0 &&
    (state.nextAction.taskId === undefined ||
      (typeof state.nextAction.taskId === 'string' && state.nextAction.taskId.trim().length > 0)) &&
    Array.isArray(state.limitations) &&
    state.limitations.every((limitation) => typeof limitation === 'string') &&
    (state.missionId === undefined ||
      (typeof state.missionId === 'string' && state.missionId.trim().length > 0)) &&
    (state.currentTaskId === undefined ||
      (typeof state.currentTaskId === 'string' && state.currentTaskId.trim().length > 0)) &&
    (state.terminationReason === undefined ||
      (typeof state.terminationReason === 'string' && state.terminationReason.trim().length > 0)) &&
    (state.authorizedPhases === undefined ||
      (Array.isArray(state.authorizedPhases) &&
        state.authorizedPhases.every(
          (phase) => typeof phase === 'string' && phase.trim().length > 0,
        )))
  );
}
