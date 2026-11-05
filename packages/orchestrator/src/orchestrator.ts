import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { BehaviorOS, DNALoader } from '@behavior-os/core';
import type {
  AdapterResult,
  DNA,
  Mission,
  MissionEvidence,
  MissionPriority,
  MissionType,
  TaskCheckResult,
  TaskDefinition,
  TaskError,
  TaskErrorCode,
  TaskEvent,
  TaskEventType,
  TaskResult,
  TaskStatus,
} from '@behavior-os/schemas';
import { AdapterResultSchema, TaskAcceptanceSchema } from '@behavior-os/schemas';
import { type AdapterExecutionContext, ShellAdapter, type TaskAdapter } from './adapters.js';
import {
  CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from './circuit-breaker.js';
import type { DelegationEngine, DelegationRole } from './delegation.js';

/** A typed orchestration precondition failure (never a synthetic task success). */
export class OrchestratorError extends Error {
  readonly code: TaskErrorCode;

  constructor(code: TaskErrorCode, message: string) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
  }
}

export interface AgentConfig {
  id: string;
  dnaPattern: string;
  capabilities: string[];
  authority: 'readonly' | 'write' | 'admin';
  /**
   * Delegation role. When omitted, `readonly` agents become `explorer` and
   * write/admin agents become `operator`. Only used when a
   * `DelegationEngine` is configured.
   */
  role?: DelegationRole;
}

export interface TaskAcceptanceInput {
  gate: string;
  description: string;
  type: 'exit-code' | 'stdout-contains' | 'stdout-matches' | 'stderr-not-contains';
  expected?: string;
  required?: boolean;
}

export interface TaskDefinitionInput {
  /** Stable task id. Defaults to `task-<index>`. */
  id?: string;
  parentTaskId?: string;
  /** Tasks that must complete before this task is eligible. */
  dependsOn?: string[];
  type?: string;
  objective: string;
  adapter: string;
  /** Defaults to the mission's acting agent. */
  agentId?: string;
  input?: Record<string, unknown>;
  acceptance: TaskAcceptanceInput[];
  /** Per-attempt deadline. Defaults to the orchestrator's `defaultTimeoutMs`. */
  timeoutMs?: number;
  /** Bounded retries: 1 means a single attempt. Defaults to 1, max 10. */
  maxAttempts?: number;
  idempotencyKey?: string;
  /**
   * Skills the task requires. Empty or omitted means no skill constraint; it
   * never falls back to the pinned agent's capabilities.
   */
  requiredSkills?: string[];
  /**
   * Whether the task mutates state. Defaults to `true` (safety-first): a task
   * must explicitly declare itself read-only before it can run on a readonly
   * role such as `auditor` or `explorer`.
   */
  mutating?: boolean;
}

/**
 * Internal task shape: the persisted `TaskDefinition` plus the delegation hints
 * that must not become part of the public schema. Task definitions are not
 * validated against `TaskDefinitionSchema` before dispatch, so the extra
 * properties are inert.
 */
type DelegatedTaskDefinition = TaskDefinition & {
  requiredSkills?: string[];
  mutating?: boolean;
};

/**
 * Validate and normalize `requiredSkills` at every plan boundary.
 *
 * An empty array means "no skill constraint". It never inherits the pinned
 * agent's capabilities. Invalid element types are a governed input error, not
 * an accidental `TypeError` from `.trim()`.
 */
export function normalizeRequiredSkills(taskId: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((skill) => typeof skill !== 'string')) {
    throw new OrchestratorError(
      'INVALID_INPUT',
      `Task "${taskId}" requiredSkills must be an array of skill names`,
    );
  }
  return [...new Set(value.map((skill) => skill.trim()).filter(Boolean))];
}

export interface MissionPlan {
  title: string;
  description?: string;
  type: MissionType;
  priority: MissionPriority;
  dnaPattern?: string;
  tags?: string[];
  /** Additional gates; every one must also be produced by a task acceptance. */
  requiredChecks?: string[];
  tasks: TaskDefinitionInput[];
  /** Flags passed to governance (e.g. `{ production: true }`). */
  governanceContext?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Observation hooks for durable control loops. Hooks are synchronous on purpose:
 * a control loop must persist the transition before the next task is selected.
 * A hook that throws is treated as a persistence failure and stops the mission.
 */
export interface MissionObserver {
  /**
   * Called as soon as the mission id exists and before governance or dispatch.
   * A durable control loop persists this id here so a crash cannot create a
   * second mission on resume.
   */
  missionCreated?: (mission: Mission) => void;
  taskStarted?: (task: TaskDefinition) => void;
  taskSettled?: (task: TaskDefinition, result: TaskResult) => void;
}

export interface ExecuteMissionOptions {
  signal?: AbortSignal;
  /** Default `executed`: completion requires executed evidence + executionId. */
  verificationMode?: 'any' | 'executed';
  idempotencyKey?: string;
  /** Resume an existing active/paused mission instead of creating a new one. */
  resumeMissionId?: string;
  /** Repeated identical failures that abort a task. Default 2. */
  loopThreshold?: number;
  /**
   * Executed evidence from a prior control-loop run. Seeded before dispatch so
   * a new mission can skip tasks that were already proven by an earlier run.
   *
   * This is trusted caller input: the engine validates shape/provenance, but
   * cannot prove that an `executionId` originated in this process. Callers must
   * only seed evidence read from a protected prior run artifact.
   */
  seedEvidence?: MissionEvidence[];
  /** Durable control-loop observation hooks. */
  observer?: MissionObserver;
  /**
   * Maximum number of mutually ready, independent tasks to execute
   * concurrently within this mission. Default 1 (strictly sequential, the
   * historical behaviour). A task never starts before all of its dependencies
   * have completed, regardless of this value.
   */
  maxParallelism?: number;
}

export type MissionOutcome = 'completed' | 'failed' | 'cancelled' | 'blocked';

export interface MissionExecutionResult {
  missionId: string;
  status: Mission['status'];
  outcome: MissionOutcome;
  tasks: TaskResult[];
  events: TaskEvent[];
  governance: import('@behavior-os/schemas').GovernanceDecision | null;
  correlationId: string;
  idempotencyKey?: string;
  startedAt: string;
  completedAt: string;
  error?: TaskError;
}

export interface OrchestratorOptions {
  /** Inject a configured engine (tests, hosts, shared persistence). */
  behaviorOS?: BehaviorOS;
  /** Inject a DNA directly instead of loading `dnas/<pattern>.yaml`. */
  dna?: DNA;
  /** Directory containing `<pattern>.yaml`. Defaults to `<cwd>/dnas`. */
  dnasDir?: string;
  defaultTimeoutMs?: number;
  defaultMaxAttempts?: number;
  circuitBreaker?: CircuitBreakerOptions;
  /**
   * Optional delegation engine. When present, every dispatched task is
   * assigned through it before governance/dispatch. Without it the legacy
   * pinned `task.agentId` behaviour is unchanged.
   */
  delegation?: DelegationEngine;
  /** Deterministic clock for tests. */
  now?: () => string;
}

export interface SystemStatus {
  agents: string[];
  dnaPattern: string | null;
  activeMissions: number;
  adapters: Array<{ name: string; circuit: CircuitState; failures: number }>;
}

const BLOCKED_CODES: ReadonlySet<TaskErrorCode> = new Set([
  'ADAPTER_NOT_FOUND',
  'AGENT_NOT_FOUND',
  'APPROVAL_REQUIRED',
  'CIRCUIT_OPEN',
  'DEPENDENCY_BLOCKED',
]);

const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

interface AttemptOutcome {
  result?: AdapterResult;
  error?: TaskError;
  executionId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/**
 * Autonomous orchestrator for governed agent teams.
 *
 * A mission plan is validated, created as a real `Mission` in `verificationMode:
 * 'executed'`, gated by governance, started, and dispatched task-by-task through
 * registered adapters. Each adapter result is schema-validated and checked
 * against the task's acceptance criteria before executed evidence is appended to
 * the mission. The mission can only complete when every required gate has
 * passing executed evidence.
 *
 * Failure semantics are explicit: governance denial fails the mission, an
 * escalated verdict pauses it pending human approval, cancellation cancels it,
 * and adapter/timeout/retry/loop/circuit failures terminate with a classified
 * error. There is no "executed" status that bypasses the lifecycle.
 */

export class AutonomousOrchestrator {
  private readonly behaviorOS: BehaviorOS;
  private readonly agents = new Map<string, AgentConfig>();
  private readonly adapters = new Map<string, TaskAdapter>();
  private readonly idempotencyByKey = new Map<string, TaskResult>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();
  private readonly completedByKey = new Map<string, MissionExecutionResult>();
  private readonly inflightByKey = new Map<string, Promise<MissionExecutionResult>>();
  private readonly eventBuffers = new Map<string, TaskEvent[]>();
  private readonly options: OrchestratorOptions;
  private readonly dnasDir: string;
  private readonly now: () => string;
  private readonly delegation?: DelegationEngine;
  private eventSeq = 0;

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
    this.behaviorOS = options.behaviorOS ?? new BehaviorOS();
    this.dnasDir = options.dnasDir ?? resolve(process.cwd(), 'dnas');
    this.now = options.now ?? (() => new Date().toISOString());
    this.delegation = options.delegation;
    this.registerAdapter(new ShellAdapter());
  }

  /** Register an agent identity. The adapter does the executing; the agent is governance provenance. */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
    if (this.delegation) {
      // Mirror the orchestrator's authoritative identity into the delegation
      // policy. The role defaults from authority so a readonly agent can never
      // be registered as a writer by omission.
      const role: DelegationRole =
        config.role ?? (config.authority === 'readonly' ? 'explorer' : 'operator');
      this.delegation.registerAgent({
        id: config.id,
        role,
        capabilities: config.capabilities,
        authority: config.authority,
      });
    }
  }

  /** Read-only delegation engine access for hosts and tests (null when disabled). */
  getDelegationEngine(): DelegationEngine | null {
    return this.delegation ?? null;
  }

  /**
   * Trust the adapter's mutability metadata over the plan's declaration.
   * Only `task.mutating === false` *and* `adapter.mutating === false` is
   * read-only; a missing/unknown adapter is treated as mutating (fail closed).
   */
  private isEffectiveMutating(task: DelegatedTaskDefinition): boolean {
    if (task.mutating !== false) return true;
    const adapter = this.adapters.get(task.adapter);
    return adapter?.mutating !== false;
  }

  /** Register an execution adapter. Its `name` is the plan's `adapter` value. */
  registerAdapter(adapter: TaskAdapter): void {
    if (!adapter.name || adapter.name.trim().length === 0) {
      throw new OrchestratorError('INVALID_INPUT', 'Adapter requires a non-empty name');
    }
    this.adapters.set(adapter.name, adapter);
    if (!this.breakers.has(adapter.name)) {
      this.breakers.set(adapter.name, new CircuitBreaker(this.options.circuitBreaker));
    }
  }

  getAdapter(name: string): TaskAdapter | undefined {
    return this.adapters.get(name);
  }

  /** Read-only mission lookup for durable control loops. */
  getMission(missionId: string): Mission | null {
    return this.behaviorOS.getMission(missionId);
  }

  /** Read-only agent lookup so a control loop can block a bad branch, not the run. */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Read-only mission list for durable control loops. */
  listMissions(): Mission[] {
    return this.behaviorOS.listMissions();
  }

  /** Subscribe to lifecycle events. Returns an unsubscribe function. */
  onEvent(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Execute a mission plan end to end.
   *
   * Replaying the same `idempotencyKey` returns the original result (in-process)
   * or awaits the in-flight run; it never creates a second mission or dispatches
   * a second task.
   */
  async executeMission(
    plan: MissionPlan,
    agentId: string,
    options: ExecuteMissionOptions = {},
  ): Promise<MissionExecutionResult> {
    const key = options.idempotencyKey ?? plan.idempotencyKey;
    if (key) {
      const completed = this.completedByKey.get(key);
      if (completed) return structuredClone(completed);
      const inflight = this.inflightByKey.get(key);
      if (inflight) return structuredClone(await inflight);
    }

    const run = this.runMission(
      plan,
      agentId,
      key ? { ...options, idempotencyKey: options.idempotencyKey ?? key } : options,
    );
    if (!key) return await run;

    this.inflightByKey.set(key, run);
    try {
      const result = await run;
      this.completedByKey.set(key, result);
      return structuredClone(result);
    } finally {
      this.inflightByKey.delete(key);
    }
  }

  /** Current orchestrator view (agents, active missions, adapter circuit state). */
  getStatus(): SystemStatus {
    return {
      agents: Array.from(this.agents.keys()),
      dnaPattern: this.behaviorOS.getDNA()?.name ?? null,
      activeMissions: this.behaviorOS
        .listMissions()
        .filter((mission) => mission.status === 'active').length,
      adapters: Array.from(this.adapters.keys()).map((name) => {
        const breaker = this.breakers.get(name);
        return {
          name,
          circuit: breaker?.getState() ?? 'closed',
          failures: breaker?.getConsecutiveFailures() ?? 0,
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Mission lifecycle
  // -------------------------------------------------------------------------

  private async runMission(
    plan: MissionPlan,
    agentId: string,
    options: ExecuteMissionOptions,
  ): Promise<MissionExecutionResult> {
    const startedAt = this.now();

    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new OrchestratorError(
        'AGENT_NOT_FOUND',
        `Agent "${agentId}" is not registered; registerAgent() before executing a mission`,
      );
    }

    const existing = options.resumeMissionId
      ? this.behaviorOS.getMission(options.resumeMissionId)
      : null;
    if (options.resumeMissionId && !existing) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Mission "${options.resumeMissionId}" does not exist`,
      );
    }
    if (existing && ['completed', 'failed', 'cancelled'].includes(existing.status)) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        `Mission "${existing.id}" is ${existing.status}; terminal missions cannot be resumed`,
      );
    }

    const pattern = plan.dnaPattern ?? existing?.dnaPattern ?? agent.dnaPattern;
    try {
      await this.loadDNA(pattern, this.options.dna);
    } catch (error) {
      if (error instanceof OrchestratorError) throw error;
      throw new OrchestratorError(
        'DNA_NOT_FOUND',
        `Could not load DNA "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const tasks = this.normalizeTasks(plan, agentId, existing);
    const requiredChecks = this.missionRequiredChecks(plan, tasks);
    const verificationMode = options.verificationMode ?? 'executed';

    let mission: Mission;
    if (existing) {
      mission = existing;
      if (mission.status === 'pending') {
        const started = this.behaviorOS.transitionMission(mission.id, 'active', {
          actor: agentId,
          reason: 'orchestrator resume',
        });
        if (!started.ok) {
          throw new OrchestratorError(
            started.code === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED' : 'INVALID_INPUT',
            started.message,
          );
        }
      } else if (mission.status === 'paused') {
        const resumed = this.behaviorOS.transitionMission(mission.id, 'active', {
          actor: agentId,
          reason: 'orchestrator resume after approval',
        });
        if (!resumed.ok) {
          throw new OrchestratorError(
            resumed.code === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED' : 'INVALID_INPUT',
            resumed.message,
          );
        }
      }
    } else {
      mission = this.behaviorOS.createMission({
        title: plan.title,
        description: plan.description,
        type: plan.type,
        priority: plan.priority,
        dnaPattern: pattern,
        createdBy: agentId,
        requiredChecks,
        verificationMode,
        tags: plan.tags,
        advanceProtocol: false,
      });

      const started = this.behaviorOS.transitionMission(mission.id, 'active', {
        actor: agentId,
        reason: 'orchestrator dispatch',
      });
      if (!started.ok) {
        return this.blockedBeforeDispatch(
          mission.id,
          started.code === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED' : 'INVALID_INPUT',
          started.message,
          startedAt,
          options,
        );
      }
      mission = started.mission;
    }

    // Tasks were validated before the mission existed (required checks depend on
    // them). Bind them to the real mission id now; the placeholder id must never
    // leak into evidence, events or idempotency keys.
    for (const task of tasks) {
      if (task.missionId !== mission.id) {
        task.missionId = mission.id;
        task.correlationId = mission.id;
        if (task.idempotencyKey.startsWith('pending:')) {
          task.idempotencyKey = `${mission.id}:${task.id}`;
        }
      }
    }
    this.eventBuffers.set(mission.id, []);

    const correlationId = mission.id;
    this.emit('mission.created', mission.id, correlationId, {
      type: mission.type,
      priority: mission.priority,
      dnaPattern: mission.dnaPattern,
      requiredChecks: mission.requiredChecks ?? [],
      verificationMode: mission.verificationMode,
      resumed: existing !== null,
    });

    try {
      options.observer?.missionCreated?.(mission);
    } catch (error) {
      const observerError = this.observerFailure(error);
      const failed = this.behaviorOS.transitionMission(mission.id, 'failed', {
        actor: agentId,
        reason: observerError.message,
      });
      this.emit('mission.failed', mission.id, correlationId, {
        code: observerError.code,
      });
      return this.result(
        failed.ok ? failed.mission : mission,
        'failed',
        [],
        null,
        correlationId,
        startedAt,
        observerError,
        options,
      );
    }

    // Governance runs after the mission exists (so a denial is auditable) and
    // before any task is dispatched (so it is a real pre-execution veto).
    const governanceContext: Record<string, unknown> = {
      ...(plan.governanceContext ?? {}),
      action: 'execute',
      missionId: mission.id,
      authority: agent.authority,
    };
    const preflight = this.behaviorOS.preflightAction('execute', {
      agent: agentId,
      context: governanceContext,
    });
    const governance = this.behaviorOS.evaluateGovernance('execute', {
      agent: agentId,
      missionId: mission.id,
      context: governanceContext,
    });

    if (!preflight.allowed || governance.verdict === 'deny') {
      const reason = preflight.allowed
        ? governance.reason
        : `Blocked by gate "${preflight.blockedBy ?? 'unknown'}"`;
      const failed = this.behaviorOS.transitionMission(mission.id, 'failed', {
        actor: agentId,
        reason,
      });
      this.emit('mission.failed', mission.id, correlationId, {
        code: 'GOVERNANCE_DENIED',
        gate: preflight.blockedBy ?? null,
      });
      return this.result(
        failed.ok ? failed.mission : mission,
        'failed',
        [],
        governance,
        correlationId,
        startedAt,
        undefined,
        options,
        {
          code: 'GOVERNANCE_DENIED',
          message: reason,
          retryable: false,
        },
      );
    }

    if (governance.verdict === 'escalate') {
      const paused = this.behaviorOS.transitionMission(mission.id, 'paused', {
        actor: agentId,
        reason: `Approval required: ${governance.reason}`,
      });
      this.emit('mission.blocked', mission.id, correlationId, {
        code: 'APPROVAL_REQUIRED',
        reason: governance.reason,
      });
      return this.result(
        paused.ok ? paused.mission : mission,
        'blocked',
        [],
        governance,
        correlationId,
        startedAt,
        undefined,
        options,
        {
          code: 'APPROVAL_REQUIRED',
          message: `Escalated by governance (${governance.reason}); an explicit human approval is required before resuming`,
          retryable: false,
        },
      );
    }

    if (options.seedEvidence && options.seedEvidence.length > 0) {
      const seeded = this.behaviorOS.addMissionEvidence(mission.id, options.seedEvidence, {
        actor: agentId,
      });
      if (!seeded.ok) {
        const failed = this.behaviorOS.transitionMission(mission.id, 'failed', {
          actor: agentId,
          reason: seeded.message,
        });
        return this.result(
          failed.ok ? failed.mission : mission,
          'failed',
          [],
          governance,
          correlationId,
          startedAt,
          {
            code: 'PERSISTENCE_FAILED',
            message: seeded.message,
            retryable: false,
          },
          options,
        );
      }
      mission = seeded.mission;
    }

    // -----------------------------------------------------------------------
    // Task dispatch (dependency-aware, fail-fast on failed/cancelled, paused on
    // blocked; resumable from executed evidence). A blocked approval or external
    // dependency must not stop independent authorized tasks.
    // -----------------------------------------------------------------------
    const results: TaskResult[] = [];
    let terminalError: TaskError | undefined;
    let blockedError: TaskError | undefined;
    let cancelled = false;
    const requestedParallelism = options.maxParallelism ?? 1;
    const parallelism =
      Number.isFinite(requestedParallelism) && requestedParallelism >= 1
        ? Math.floor(requestedParallelism)
        : 1;

    while (true) {
      if (terminalError) break;
      if (options.signal?.aborted) {
        cancelled = true;
        terminalError = {
          code: 'CANCELLED',
          message: 'Mission cancelled by the caller before the next task',
          retryable: false,
        };
        break;
      }

      const pending = tasks.filter((task) => task.status === 'pending');
      if (pending.length === 0) break;

      // Tasks whose dependency already failed/blocked/cancelled cannot run.
      // This is done before eligibility so independent branches keep moving.
      const dependencyBlocked = pending.filter((task) =>
        (task.dependsOn ?? []).some((dependencyId) => {
          const dependency = tasks.find((candidate) => candidate.id === dependencyId);
          return (
            dependency !== undefined &&
            dependency.status !== 'pending' &&
            dependency.status !== 'running' &&
            dependency.status !== 'completed'
          );
        }),
      );
      if (dependencyBlocked.length > 0) {
        for (const task of dependencyBlocked) {
          const error: TaskError = {
            code: 'DEPENDENCY_BLOCKED',
            message: `Task "${task.id}" cannot run because a dependency did not complete successfully`,
            retryable: false,
          };
          const result = this.taskFailure(task, this.now(), error, 'blocked');
          task.status = 'blocked';
          task.updatedAt = this.now();
          results.push(result);
          blockedError ??= error;
          this.emit('task.blocked', mission.id, correlationId, { code: error.code }, task.id);
          const observerError = await this.observeSettled(options, task, result);
          if (observerError) {
            terminalError = observerError;
            break;
          }
        }
        continue;
      }

      const readyTasks = pending.filter((task) =>
        (task.dependsOn ?? []).every((dependencyId) => {
          const dependency = tasks.find((candidate) => candidate.id === dependencyId);
          return dependency?.status === 'completed';
        }),
      );
      if (readyTasks.length === 0) {
        // Normalization rejects cycles, so this is defensive only.
        terminalError = {
          code: 'INVALID_INPUT',
          message: 'No eligible task remains; the task graph is blocked',
          retryable: false,
        };
        break;
      }

      // Up to `maxParallelism` mutually ready tasks run concurrently. Every
      // dependency of a ready task is already completed, so the batch holds
      // independent branches only. Tasks already proven by executed evidence
      // resume without consuming a concurrency slot, so unproven siblings can
      // still fill the batch. Results are applied sequentially in batch order,
      // which keeps evidence, events and outcome deterministic.
      let executableSlots = parallelism;
      const batch = readyTasks.filter((task) => {
        if (this.completedEvidenceFor(task, mission)) return true;
        if (executableSlots === 0) return false;
        executableSlots -= 1;
        return true;
      });
      let stopDispatch = false;
      const scheduled: Array<{
        task: DelegatedTaskDefinition;
        delegationKey: string;
        reservationHeld: boolean;
        delegationStarted: boolean;
        promise: Promise<TaskResult>;
      }> = [];

      for (const task of batch) {
        if (stopDispatch) break;

        const existingEvidence = this.completedEvidenceFor(task, mission);
        if (existingEvidence) {
          const skipped: TaskResult = {
            id: task.id,
            missionId: task.missionId,
            status: 'completed',
            agentId: task.agentId,
            adapter: task.adapter,
            attempts: 0,
            correlationId,
            idempotencyKey: task.idempotencyKey,
            acceptance: [],
            evidence: existingEvidence,
            completedAt: this.now(),
          };
          task.status = 'completed';
          task.updatedAt = this.now();
          results.push(skipped);
          this.emit(
            'task.completed',
            mission.id,
            correlationId,
            {
              attempts: 0,
              skipped: true,
            },
            task.id,
          );
          const observerError = await this.observeSettled(options, task, skipped);
          if (observerError) {
            terminalError = observerError;
            stopDispatch = true;
          }
          continue;
        }

        // ---------------------------------------------------------------
        // Delegation: pick the eligible agent *before* the task is frozen as
        // running. A refusal blocks this task (independent branches continue)
        // instead of silently dispatching to the pinned agent.
        // ---------------------------------------------------------------
        const delegationKey = `${mission.id}:${task.id}`;
        let reservationHeld = false;
        let delegationStarted = false;
        let delegated = false;

        if (this.delegation) {
          const assignment = this.delegation.reserve({
            reservationKey: delegationKey,
            taskId: task.id,
            requiredSkills: task.requiredSkills ?? [],
            mutating: this.isEffectiveMutating(task),
          });
          if (!assignment.agentId) {
            const error: TaskError = {
              code: 'AGENT_NOT_FOUND',
              message: `Delegation refused task "${task.id}": ${assignment.reason}`,
              retryable: false,
            };
            const result = this.taskFailure(task, this.now(), error, 'blocked');
            task.status = 'blocked';
            task.updatedAt = this.now();
            results.push(result);
            blockedError ??= error;
            this.emit(
              'task.blocked',
              mission.id,
              correlationId,
              { code: error.code, delegation: assignment.reason },
              task.id,
            );
            const observerError = await this.observeSettled(options, task, result);
            if (observerError) {
              terminalError = observerError;
              stopDispatch = true;
            }
            continue;
          }
          reservationHeld = true;
          task.agentId = assignment.agentId;
          delegated = true;
          this.emit(
            'task.dispatched',
            mission.id,
            correlationId,
            {
              delegated: true,
              agentId: assignment.agentId,
              role: assignment.role,
              reason: assignment.reason,
              recommendedBy: assignment.recommendedBy,
            },
            task.id,
          );
        }

        // A mutating task is re-checked against governance immediately before
        // dispatch, with the task's own context and the *selected* agent. The
        // mission-level preflight remains the first veto; this closes the gap
        // where a task declares itself read-only while its adapter mutates.
        if (this.isEffectiveMutating(task)) {
          const taskAgent = this.agents.get(task.agentId);
          const taskGovernanceContext: Record<string, unknown> = {
            ...(plan.governanceContext ?? {}),
            action: 'execute',
            missionId: mission.id,
            taskId: task.id,
            taskType: task.type,
            adapter: task.adapter,
            mutating: true,
            authority: taskAgent?.authority ?? 'readonly',
          };
          const taskPreflight = this.behaviorOS.preflightAction('execute', {
            agent: task.agentId,
            context: taskGovernanceContext,
          });
          const taskDecision = this.behaviorOS.evaluateGovernance('execute', {
            agent: task.agentId,
            missionId: mission.id,
            context: taskGovernanceContext,
          });
          if (
            !taskPreflight.allowed ||
            taskDecision.verdict === 'deny' ||
            taskDecision.verdict === 'escalate'
          ) {
            if (reservationHeld) {
              this.delegation?.cancel(delegationKey);
            }
            const code: TaskErrorCode =
              taskPreflight.allowed && taskDecision.verdict === 'escalate'
                ? 'APPROVAL_REQUIRED'
                : 'GOVERNANCE_DENIED';
            const message =
              taskPreflight.allowed && taskDecision.verdict !== 'deny'
                ? `Task "${task.id}" requires approval: ${taskDecision.reason}`
                : `Task "${task.id}" blocked by governance: ${
                    taskPreflight.allowed ? taskDecision.reason : taskPreflight.blockedBy
                  }`;
            const error: TaskError = { code, message, retryable: false };
            const result = this.taskFailure(task, this.now(), error, 'blocked');
            task.status = 'blocked';
            task.updatedAt = this.now();
            results.push(result);
            blockedError ??= error;
            this.emit(
              'task.blocked',
              mission.id,
              correlationId,
              { code, gate: taskPreflight.blockedBy ?? null, verdict: taskDecision.verdict },
              task.id,
            );
            const observerError = await this.observeSettled(options, task, result);
            if (observerError) {
              terminalError = observerError;
              stopDispatch = true;
            }
            continue;
          }
        }

        task.status = 'running';
        task.updatedAt = this.now();
        try {
          options.observer?.taskStarted?.(task);
        } catch (error) {
          if (reservationHeld) {
            this.delegation?.cancel(delegationKey);
          }
          terminalError = this.observerFailure(error);
          stopDispatch = true;
          break;
        }

        if (delegated) {
          delegationStarted = true;
          this.delegation?.markStarted(delegationKey);
        }

        scheduled.push({
          task,
          delegationKey,
          reservationHeld,
          delegationStarted,
          promise: this.executeTask(task, options),
        });
      }

      // Await every scheduled branch, even when dispatch is stopping, so a
      // delegation reservation is always released exactly once.
      const settled = await Promise.all(
        scheduled.map(async (entry) => {
          let settledResult: TaskResult | undefined;
          try {
            settledResult = await entry.promise;
            return { entry, result: settledResult };
          } finally {
            if (entry.reservationHeld) {
              if (entry.delegationStarted) {
                this.delegation?.release(
                  entry.delegationKey,
                  settledResult?.status === 'completed',
                );
              } else {
                this.delegation?.cancel(entry.delegationKey);
              }
            }
          }
        }),
      );

      if (stopDispatch) break;

      for (const { entry, result: taskResult } of settled) {
        const task = entry.task;
        // Cache a completed result by idempotency key so a later duplicate
        // dispatch of the same logical operation reuses it instead of running
        // the adapter again. Only completed results are cached; failures stay
        // in the retry loop.
        if (task.idempotencyKey && taskResult.status === 'completed') {
          this.idempotencyByKey.set(task.idempotencyKey, structuredClone(taskResult));
        }

        task.status = taskResult.status;
        task.attempts = taskResult.attempts;
        task.updatedAt = this.now();
        results.push(taskResult);
        this.emit(
          taskResult.status === 'completed'
            ? 'task.completed'
            : taskResult.status === 'cancelled'
              ? 'task.cancelled'
              : taskResult.status === 'blocked'
                ? 'task.blocked'
                : 'task.failed',
          mission.id,
          correlationId,
          {
            attempts: taskResult.attempts,
            ...(taskResult.error ? { code: taskResult.error.code } : {}),
            ...(taskResult.exitCode !== undefined ? { exitCode: taskResult.exitCode } : {}),
          },
          task.id,
        );

        // Record evidence for every completed criterion. Failed tasks also
        // record their failed evidence, so the audit trail shows what ran.
        const evidence = taskResult.evidence;
        if (evidence.length > 0) {
          const recorded = this.behaviorOS.addMissionEvidence(task.missionId, evidence, {
            actor: task.agentId,
          });
          if (!recorded.ok) {
            terminalError = {
              code: 'PERSISTENCE_FAILED',
              message: recorded.message,
              retryable: false,
            };
            break;
          }
          mission = recorded.mission;
        }

        const observerError = await this.observeSettled(options, task, taskResult);
        if (observerError) {
          terminalError = observerError;
          break;
        }

        if (taskResult.status === 'blocked') {
          blockedError ??= taskResult.error ?? {
            code: 'APPROVAL_REQUIRED',
            message: `Task "${task.id}" is blocked pending approval or an external dependency`,
            retryable: false,
          };
          // Keep dispatching independent branches.
          continue;
        }
        if (taskResult.status !== 'completed') {
          // Record the failure but keep applying the rest of the settled batch:
          // an independent branch that already succeeded must not lose its
          // result because a sibling failed.
          terminalError ??= taskResult.error ?? {
            code: 'EXECUTION_FAILED',
            message: `Task "${task.id}" ended as ${taskResult.status}`,
            retryable: false,
          };
          if (taskResult.status === 'cancelled') cancelled = true;
        }
      }
    }

    let finalMission = mission;
    if (cancelled) {
      const cancelledTransition = this.behaviorOS.transitionMission(mission.id, 'cancelled', {
        actor: agentId,
        reason: terminalError?.message ?? 'cancelled',
      });
      if (cancelledTransition.ok) finalMission = cancelledTransition.mission;
      this.emit('mission.cancelled', mission.id, correlationId, {
        code: 'CANCELLED',
      });
      return this.result(
        finalMission,
        'cancelled',
        results,
        governance,
        correlationId,
        startedAt,
        terminalError,
        options,
      );
    }

    if (terminalError) {
      const failed = this.behaviorOS.transitionMission(mission.id, 'failed', {
        actor: agentId,
        reason: terminalError.message,
      });
      if (failed.ok) finalMission = failed.mission;
      this.emit('mission.failed', mission.id, correlationId, {
        code: terminalError.code,
        ...(terminalError.fingerprint ? { fingerprint: terminalError.fingerprint } : {}),
      });
      return this.result(
        finalMission,
        BLOCKED_CODES.has(terminalError.code) ? 'blocked' : 'failed',
        results,
        governance,
        correlationId,
        startedAt,
        terminalError,
        options,
      );
    }

    if (blockedError) {
      const paused = this.behaviorOS.transitionMission(mission.id, 'paused', {
        actor: agentId,
        reason: `Blocked task requires approval or an external dependency: ${blockedError.message}`,
      });
      if (paused.ok) finalMission = paused.mission;
      this.emit('mission.blocked', mission.id, correlationId, {
        code: blockedError.code,
        ...(blockedError.fingerprint ? { fingerprint: blockedError.fingerprint } : {}),
      });
      return this.result(
        finalMission,
        'blocked',
        results,
        governance,
        correlationId,
        startedAt,
        blockedError,
        options,
      );
    }

    const completed = this.behaviorOS.transitionMission(mission.id, 'completed', {
      actor: agentId,
      reason: 'all tasks completed with verified acceptance evidence',
    });
    if (!completed.ok) {
      const failed = this.behaviorOS.transitionMission(mission.id, 'failed', {
        actor: agentId,
        reason: completed.message,
      });
      if (failed.ok) finalMission = failed.mission;
      this.emit('mission.failed', mission.id, correlationId, {
        code: 'ACCEPTANCE_FAILED',
      });
      return this.result(
        finalMission,
        'failed',
        results,
        governance,
        correlationId,
        startedAt,
        {
          code: 'ACCEPTANCE_FAILED',
          message: completed.message,
          retryable: false,
        },
        options,
      );
    }

    finalMission = completed.mission;
    this.emit('mission.completed', mission.id, correlationId, {
      taskCount: results.length,
      verifiedGates: finalMission.requiredChecks ?? [],
    });
    return this.result(
      finalMission,
      'completed',
      results,
      governance,
      correlationId,
      startedAt,
      undefined,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

  private async executeTask(
    task: DelegatedTaskDefinition,
    options: ExecuteMissionOptions,
  ): Promise<TaskResult> {
    const startedAt = this.now();
    this.emit(
      'task.created',
      task.missionId,
      task.correlationId,
      { adapter: task.adapter, type: task.type },
      task.id,
    );

    const agent = this.agents.get(task.agentId);
    if (!agent) {
      return this.taskFailure(
        task,
        startedAt,
        {
          code: 'AGENT_NOT_FOUND',
          message: `Agent "${task.agentId}" is not registered`,
          retryable: false,
        },
        'blocked',
      );
    }

    const adapter = this.adapters.get(task.adapter);
    if (!adapter) {
      return this.taskFailure(
        task,
        startedAt,
        {
          code: 'ADAPTER_NOT_FOUND',
          message: `Adapter "${task.adapter}" is not registered`,
          retryable: false,
        },
        'blocked',
      );
    }

    const breaker = this.breakers.get(task.adapter) as CircuitBreaker;
    const fingerprints = new Map<string, number>();
    const loopThreshold = Math.max(2, options.loopThreshold ?? 2);
    let attempts = 0;
    let lastOutcome: AttemptOutcome | undefined;
    let lastError: TaskError | undefined;
    let lastStatus: TaskStatus = 'failed';

    if (task.idempotencyKey) {
      // Idempotency check. A key denotes one logical operation bound to one
      // task; reuse across a different task would claim that task's gates
      // passed without running it, so that is a fail-closed error.
      // This is at-least-once execution with deduplication — not exactly-once
      // — and only covers effects an adapter actually reported before the
      // result was persisted.
      const cached = this.idempotencyByKey.get(task.idempotencyKey);
      if (cached && cached.id !== task.id) {
        return this.taskFailure(
          task,
          startedAt,
          {
            code: 'INVALID_INPUT',
            message: `Idempotency key "${task.idempotencyKey}" is already bound to task "${cached.id}"; reusing it for a different task is not allowed`,
            retryable: false,
          },
          'blocked',
        );
      }
      if (cached?.status === 'completed') {
        // Same task, already completed: return a structural clone of the
        // original result so the caller sees the same evidence, acceptance and
        // provenance, and downstream code treats it identically. The clone
        // also stops callers mutating the cached snapshot.
        return structuredClone(cached);
      }
      if (cached && cached.status !== 'failed') {
        // A cached result exists in a non-terminal, non-failed state (e.g.
        // 'running', 'dispatched', 'blocked'). Safe recovery cannot be
        // established automatically, so fail closed and require human
        // reconciliation instead of masking or blindly retrying.
        return this.taskFailure(
          task,
          startedAt,
          {
            code: 'INVALID_INPUT',
            message: `Idempotency key "${task.idempotencyKey}" has a cached result in "${cached.status}" state, not completed. Requires human reconciliation.`,
            retryable: false,
          },
          'blocked',
        );
      }
      // No cached result, or a prior attempt failed: fall through to the retry
      // loop. An ordinary retry is not treated as proof the operation is safe
      // to repeat; adapters receive the same idempotencyKey to dedupe effects.
    }

    while (attempts < task.maxAttempts) {
      if (options.signal?.aborted) {
        lastError = {
          code: 'CANCELLED',
          message: 'Cancelled by the caller',
          retryable: false,
        };
        lastStatus = 'cancelled';
        break;
      }

      if (!breaker.canExecute()) {
        lastError = {
          code: 'CIRCUIT_OPEN',
          message: `Circuit for adapter "${task.adapter}" is open after repeated failures`,
          retryable: false,
        };
        lastStatus = 'blocked';
        break;
      }

      attempts += 1;
      this.emit(
        attempts === 1 ? 'task.dispatched' : 'task.retried',
        task.missionId,
        task.correlationId,
        { adapter: task.adapter, attempt: attempts },
        task.id,
      );
      this.emit('task.started', task.missionId, task.correlationId, { attempt: attempts }, task.id);

      const outcome = await this.runAttempt(task, adapter, attempts, options.signal);
      lastOutcome = outcome;

      if (outcome.error) {
        lastError = outcome.error;
        lastStatus = outcome.error.code === 'CANCELLED' ? 'cancelled' : 'failed';
        breaker.recordFailure();

        const fingerprint =
          outcome.error.fingerprint ??
          `${outcome.error.code}|${outcome.result?.exitCode ?? 'null'}|${(
            outcome.result?.stderr ?? ''
          )
            .trim()
            .slice(0, 200)}`;
        const seen = (fingerprints.get(fingerprint) ?? 0) + 1;
        fingerprints.set(fingerprint, seen);

        if (seen >= loopThreshold) {
          lastError = {
            code: 'LOOP_DETECTED',
            message: `Repeated identical failure ${seen} times: ${outcome.error.message}`,
            retryable: false,
            fingerprint,
          };
          lastStatus = 'failed';
          break;
        }
        if (!outcome.error.retryable) break;
        if (attempts >= task.maxAttempts) {
          // With no retry budget the proximate cause is the honest verdict
          // (TIMEOUT / EXECUTION_FAILED). RETRY_EXHAUSTED is used only when a
          // budget existed and was consumed.
          if (task.maxAttempts > 1) {
            lastError = {
              code: 'RETRY_EXHAUSTED',
              message: `Retry budget exhausted after ${attempts} attempt(s): ${outcome.error.message}`,
              retryable: false,
              fingerprint,
            };
          }
          lastStatus = 'failed';
          break;
        }
        continue;
      }

      // The process may have exited 0 but still fail the task's contract. This
      // is the distinction between "the command ran" and "the acceptance passed".
      const result = outcome.result;
      if (!result) {
        lastError = {
          code: 'INVALID_OUTPUT',
          message: 'Adapter produced no result',
          retryable: false,
        };
        lastStatus = 'failed';
        breaker.recordFailure();
        break;
      }

      const checks = this.evaluateAcceptance(task, result);
      const failedRequired = checks.filter((check) => check.required && !check.passed);
      if (failedRequired.length > 0) {
        lastError = {
          code: 'ACCEPTANCE_FAILED',
          message: `Acceptance failed for gate(s): ${failedRequired
            .map((check) => check.gate)
            .join(', ')}`,
          retryable: false,
          fingerprint: `ACCEPTANCE_FAILED|${failedRequired.map((check) => check.gate).join(',')}`,
        };
        lastStatus = 'failed';
        breaker.recordFailure();
        lastOutcome = { ...outcome, error: lastError };
        // Keep the checks on the task result: the command succeeded, the
        // acceptance did not, and the evidence records exactly that.
        return this.finishTask(task, startedAt, {
          status: 'failed',
          attempts,
          result,
          checks,
          executionId: outcome.executionId,
          error: lastError,
        });
      }

      breaker.recordSuccess();
      return this.finishTask(task, startedAt, {
        status: 'completed',
        attempts,
        result,
        checks,
        executionId: outcome.executionId,
      });
    }

    // Bounded loop ended without a completed task.
    if (!lastError) {
      lastError = {
        code: 'RETRY_EXHAUSTED',
        message: `No attempt completed after ${attempts} attempt(s)`,
        retryable: false,
      };
      lastStatus = 'failed';
    }
    return this.finishTask(task, startedAt, {
      status: lastStatus,
      attempts,
      ...(lastOutcome?.result ? { result: lastOutcome.result } : {}),
      ...(lastOutcome?.executionId ? { executionId: lastOutcome.executionId } : {}),
      checks: [],
      error: lastError,
    });
  }

  private async runAttempt(
    task: TaskDefinition,
    adapter: TaskAdapter,
    attempt: number,
    parentSignal?: AbortSignal,
  ): Promise<AttemptOutcome> {
    const startedAt = this.now();
    const controller = new AbortController();
    const executionId = `${task.id}:${attempt}:${randomUUID()}`;
    const timeoutMs = task.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000;

    const onParentAbort = (): void => controller.abort();
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const context: AdapterExecutionContext = {
      taskId: task.id,
      missionId: task.missionId,
      correlationId: task.correlationId,
      idempotencyKey: task.idempotencyKey,
      agentId: task.agentId,
      attempt,
      timeoutMs,
      signal: controller.signal,
    };

    try {
      const raw = await adapter.execute(task.input, context);
      const completedAt = this.now();
      const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));

      if (timedOut) {
        return {
          error: {
            code: 'TIMEOUT',
            message: `Task "${task.id}" exceeded ${timeoutMs}ms on attempt ${attempt}`,
            retryable: true,
          },
          executionId,
          startedAt,
          completedAt,
          durationMs,
        };
      }
      if (parentSignal?.aborted) {
        return {
          error: {
            code: 'CANCELLED',
            message: `Task "${task.id}" was cancelled during attempt ${attempt}`,
            retryable: false,
          },
          executionId,
          startedAt,
          completedAt,
          durationMs,
        };
      }

      const parsed = AdapterResultSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          error: {
            code: 'INVALID_OUTPUT',
            message: `Adapter "${adapter.name}" returned a result that does not match AdapterResultSchema: ${parsed.error.issues
              .map((issue) => issue.message)
              .join('; ')}`,
            retryable: false,
          },
          executionId,
          startedAt,
          completedAt,
          durationMs,
        };
      }

      if (parsed.data.exitCode !== 0) {
        const stderr = parsed.data.stderr.trim().slice(0, 200);
        return {
          result: parsed.data,
          error: {
            code: 'EXECUTION_FAILED',
            message: `Adapter "${adapter.name}" exited with code ${parsed.data.exitCode ?? 'null'}${
              stderr ? `: ${stderr}` : ''
            }`,
            retryable: true,
            fingerprint: `EXECUTION_FAILED|${parsed.data.exitCode ?? 'null'}|${stderr}`,
          },
          executionId,
          startedAt,
          completedAt,
          durationMs,
        };
      }

      return {
        result: parsed.data,
        executionId,
        startedAt,
        completedAt,
        durationMs,
      };
    } catch (error) {
      const completedAt = this.now();
      const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
      const message = error instanceof Error ? error.message : String(error);
      const code: TaskErrorCode = timedOut
        ? 'TIMEOUT'
        : parentSignal?.aborted
          ? 'CANCELLED'
          : 'EXECUTION_FAILED';
      return {
        error: {
          code,
          message: timedOut
            ? `Task "${task.id}" exceeded ${timeoutMs}ms on attempt ${attempt}`
            : parentSignal?.aborted
              ? `Task "${task.id}" was cancelled during attempt ${attempt}`
              : `Adapter "${adapter.name}" threw: ${message}`,
          retryable: code === 'EXECUTION_FAILED' && !/ENOENT|not found/i.test(message),
          fingerprint: `${code}|${message.slice(0, 200)}`,
        },
        executionId,
        startedAt,
        completedAt,
        durationMs,
      };
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }

  private finishTask(
    task: TaskDefinition,
    startedAt: string,
    input: {
      status: TaskStatus;
      attempts: number;
      result?: AdapterResult;
      checks: TaskCheckResult[];
      executionId?: string;
      error?: TaskError;
    },
  ): TaskResult {
    const completedAt = this.now();
    const executionId = input.executionId;

    const evidence: MissionEvidence[] = input.checks.map((check) => ({
      gate: check.gate,
      status: check.passed ? 'passed' : 'failed',
      source: `${task.adapter}:${task.objective}`.slice(0, 200),
      detail: check.detail,
      provenance: 'executed',
      ...(executionId ? { executionId } : {}),
      taskId: task.id,
      tool: task.adapter,
      ...(typeof task.input.command === 'string' ? { command: task.input.command } : {}),
      ...(input.result?.exitCode !== undefined && input.result.exitCode !== null
        ? { exitCode: input.result.exitCode }
        : {}),
      recordedAt: completedAt,
    }));

    // A terminal failure whose adapter produced no per-criterion checks (timeout,
    // retry exhaustion, circuit) still records *failed executed evidence* for the
    // gates it was supposed to prove. Evidence without an executionId is never
    // fabricated: a blocked task that never ran records none.
    if (evidence.length === 0 && input.status !== 'completed' && executionId && input.error) {
      for (const criterion of task.acceptance) {
        evidence.push({
          gate: criterion.gate,
          status: 'failed',
          source: `${task.adapter}:${task.objective}`.slice(0, 200),
          detail: input.error.message,
          provenance: 'executed',
          executionId,
          taskId: task.id,
          tool: task.adapter,
          ...(typeof task.input.command === 'string' ? { command: task.input.command } : {}),
          recordedAt: completedAt,
        });
      }
    }

    const result: TaskResult = {
      id: task.id,
      missionId: task.missionId,
      status: input.status,
      agentId: task.agentId,
      adapter: task.adapter,
      attempts: input.attempts,
      correlationId: task.correlationId,
      idempotencyKey: task.idempotencyKey,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      ...(input.result?.exitCode !== undefined ? { exitCode: input.result.exitCode } : {}),
      ...(input.result?.stdout !== undefined ? { stdout: input.result.stdout } : {}),
      ...(input.result?.stderr !== undefined ? { stderr: input.result.stderr } : {}),
      acceptance: input.checks,
      evidence,
      ...(input.error ? { error: input.error } : {}),
    };
    return result;
  }

  private taskFailure(
    task: TaskDefinition,
    startedAt: string,
    error: TaskError,
    status: TaskStatus,
  ): TaskResult {
    const completedAt = this.now();
    return {
      id: task.id,
      missionId: task.missionId,
      status,
      agentId: task.agentId,
      adapter: task.adapter,
      attempts: 0,
      correlationId: task.correlationId,
      idempotencyKey: task.idempotencyKey,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      acceptance: [],
      evidence: [],
      error,
    };
  }

  private evaluateAcceptance(task: TaskDefinition, result: AdapterResult): TaskCheckResult[] {
    return task.acceptance.map((criterion) => {
      const expected = criterion.expected ?? (criterion.type === 'exit-code' ? '0' : '');
      let passed = false;
      let detail = '';
      switch (criterion.type) {
        case 'exit-code':
          passed = String(result.exitCode) === expected;
          detail = `exit ${result.exitCode ?? 'null'}; expected ${expected}`;
          break;
        case 'stdout-contains':
          passed = result.stdout.includes(expected);
          detail = `stdout ${passed ? 'contains' : 'does not contain'} the expected text`;
          break;
        case 'stdout-matches':
          passed = new RegExp(expected).test(result.stdout);
          detail = `stdout ${passed ? 'matches' : 'does not match'} the expected pattern`;
          break;
        case 'stderr-not-contains':
          passed = !result.stderr.includes(expected);
          detail = `stderr ${passed ? 'does not contain' : 'contains'} the forbidden text`;
          break;
      }
      return {
        gate: criterion.gate,
        type: criterion.type,
        required: criterion.required,
        passed,
        detail,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Plan validation and helpers
  // -------------------------------------------------------------------------

  private normalizeTasks(
    plan: MissionPlan,
    defaultAgentId: string,
    existing: Mission | null,
  ): DelegatedTaskDefinition[] {
    if (!plan.title || plan.title.trim().length === 0) {
      throw new OrchestratorError('INVALID_INPUT', 'Mission plan requires a non-empty title');
    }
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      throw new OrchestratorError('INVALID_INPUT', 'Mission plan requires at least one task');
    }

    const now = this.now();
    const missionId = existing?.id ?? `pending:${plan.idempotencyKey ?? plan.title}`;
    const seenIds = new Set<string>();
    const tasks: DelegatedTaskDefinition[] = [];

    plan.tasks.forEach((task, index) => {
      const id = (task.id ?? `task-${index + 1}`).trim();
      if (id.length === 0) {
        throw new OrchestratorError('INVALID_INPUT', `Task ${index + 1} has an empty id`);
      }
      if (seenIds.has(id)) {
        throw new OrchestratorError('INVALID_INPUT', `Duplicate task id "${id}"`);
      }
      seenIds.add(id);

      const parsed = TaskAcceptanceSchema.array().min(1).safeParse(task.acceptance);
      if (!parsed.success) {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Task "${id}" has invalid acceptance criteria: ${parsed.error.issues
            .map((issue) => issue.message)
            .join('; ')}`,
        );
      }

      const gates = new Set<string>();
      for (const criterion of parsed.data) {
        if (gates.has(criterion.gate)) {
          throw new OrchestratorError(
            'INVALID_INPUT',
            `Task "${id}" declares gate "${criterion.gate}" more than once`,
          );
        }
        gates.add(criterion.gate);
        const expected = criterion.expected ?? (criterion.type === 'exit-code' ? '0' : '');
        if (criterion.type === 'exit-code' && !/^-?\d+$/.test(expected)) {
          throw new OrchestratorError(
            'INVALID_INPUT',
            `Task "${id}" gate "${criterion.gate}" expects a non-integer exit code "${expected}"`,
          );
        }
        if (criterion.type === 'stdout-matches') {
          try {
            new RegExp(expected);
          } catch {
            throw new OrchestratorError(
              'INVALID_INPUT',
              `Task "${id}" gate "${criterion.gate}" has an invalid regular expression`,
            );
          }
        }
        if (
          (criterion.type === 'stdout-contains' || criterion.type === 'stderr-not-contains') &&
          expected.length === 0
        ) {
          throw new OrchestratorError(
            'INVALID_INPUT',
            `Task "${id}" gate "${criterion.gate}" requires a non-empty expected text`,
          );
        }
      }

      if (!task.objective || task.objective.trim().length === 0) {
        throw new OrchestratorError('INVALID_INPUT', `Task "${id}" requires an objective`);
      }
      if (!task.adapter || task.adapter.trim().length === 0) {
        throw new OrchestratorError('INVALID_INPUT', `Task "${id}" requires an adapter`);
      }
      const agentId = task.agentId ?? defaultAgentId;
      if (!this.agents.has(agentId)) {
        throw new OrchestratorError(
          'AGENT_NOT_FOUND',
          `Task "${id}" is assigned to unregistered agent "${agentId}"`,
        );
      }

      const maxAttempts = Math.min(
        10,
        Math.max(1, Math.trunc(task.maxAttempts ?? this.options.defaultMaxAttempts ?? 1)),
      );
      const timeoutMs = Math.max(
        1,
        Math.trunc(task.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000),
      );

      if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Task "${id}" dependsOn must be an array of task ids`,
        );
      }
      const requiredSkills = normalizeRequiredSkills(id, task.requiredSkills);
      if (task.mutating !== undefined && typeof task.mutating !== 'boolean') {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Task "${id}" mutating must be a boolean when provided`,
        );
      }
      const dependsOn = [...new Set((task.dependsOn ?? []).map((dependency) => dependency.trim()))];
      if (dependsOn.some((dependency) => dependency.length === 0)) {
        throw new OrchestratorError('INVALID_INPUT', `Task "${id}" has an empty dependency id`);
      }
      if (dependsOn.includes(id)) {
        throw new OrchestratorError('INVALID_INPUT', `Task "${id}" cannot depend on itself`);
      }

      tasks.push({
        id,
        missionId,
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        correlationId: missionId,
        idempotencyKey: task.idempotencyKey ?? `${missionId}:${id}`,
        type: task.type ?? 'execute',
        objective: task.objective.trim(),
        input: task.input ?? {},
        acceptance: parsed.data,
        agentId,
        adapter: task.adapter,
        status: 'pending',
        attempts: 0,
        maxAttempts,
        timeoutMs,
        requiredSkills,
        mutating: task.mutating ?? true,
        createdAt: now,
        updatedAt: now,
      });
    });

    this.validateDependencies(tasks);
    return tasks;
  }

  private validateDependencies(tasks: TaskDefinition[]): void {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!byId.has(dependency)) {
          throw new OrchestratorError(
            'INVALID_INPUT',
            `Task "${task.id}" depends on unknown task "${dependency}"`,
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) {
        throw new OrchestratorError('INVALID_INPUT', `Task dependency cycle detected at "${id}"`);
      }
      if (visited.has(id)) return;
      visiting.add(id);
      const task = byId.get(id);
      for (const dependency of task?.dependsOn ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of tasks) visit(task.id);
  }

  private missionRequiredChecks(plan: MissionPlan, tasks: TaskDefinition[]): string[] {
    const produced = new Set(
      tasks.flatMap((task) => task.acceptance.map((criterion) => criterion.gate)),
    );
    const requested = [...(plan.requiredChecks ?? [])].map((gate) => gate.trim()).filter(Boolean);
    for (const gate of requested) {
      if (!produced.has(gate)) {
        throw new OrchestratorError(
          'INVALID_INPUT',
          `Mission requires gate "${gate}" but no task produces it`,
        );
      }
    }
    const required = tasks.flatMap((task) =>
      task.acceptance.filter((criterion) => criterion.required).map((criterion) => criterion.gate),
    );
    const checks = [...new Set([...requested, ...required])];
    if (checks.length === 0) {
      throw new OrchestratorError(
        'INVALID_INPUT',
        'Executed missions require at least one required acceptance gate',
      );
    }
    return checks;
  }

  private async loadDNA(pattern: string, provided?: DNA): Promise<DNA> {
    if (provided) {
      const current = this.behaviorOS.getDNA();
      if (current !== provided) await this.behaviorOS.loadDNA(provided);
      return provided;
    }

    const current = this.behaviorOS.getDNA();
    if (current?.name === pattern) return current;

    const path = isAbsolute(pattern)
      ? pattern
      : resolve(this.dnasDir, pattern.endsWith('.yaml') ? pattern : `${pattern}.yaml`);
    let dna: DNA;
    try {
      dna = new DNALoader().loadFile(path);
    } catch (error) {
      throw new OrchestratorError(
        'DNA_NOT_FOUND',
        `DNA pattern "${pattern}" could not be loaded from ${path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await this.behaviorOS.loadDNA(dna);
    return dna;
  }

  /** Evidence for a task whose required gates already have executed passes. */
  private completedEvidenceFor(task: TaskDefinition, mission: Mission): MissionEvidence[] | null {
    const required = task.acceptance
      .filter((criterion) => criterion.required !== false)
      .map((criterion) => criterion.gate);
    if (required.length === 0) return null;

    const evidence = mission.evidence ?? [];
    const matched: MissionEvidence[] = [];
    for (const gate of required) {
      const latest = [...evidence]
        .reverse()
        .find((entry) => entry.gate === gate && this.evidenceBelongsToTask(entry, task.id));
      if (
        latest?.status !== 'passed' ||
        latest?.provenance !== 'executed' ||
        latest?.simulated === true ||
        !latest?.executionId
      ) {
        return null;
      }
      matched.push(latest);
    }
    return matched;
  }

  /**
   * Evidence must identify the task that produced it. The execution id fallback
   * keeps old mission records resumable without allowing a gate with the same
   * name in another task to satisfy this task.
   */
  private evidenceBelongsToTask(entry: MissionEvidence, taskId: string): boolean {
    if (entry.taskId) return entry.taskId === taskId;
    return entry.executionId?.startsWith(`${taskId}:`) ?? false;
  }

  private observerFailure(error: unknown): TaskError {
    return {
      code: 'PERSISTENCE_FAILED',
      message: `Control-loop observer failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      retryable: false,
    };
  }

  private async observeSettled(
    options: ExecuteMissionOptions,
    task: TaskDefinition,
    result: TaskResult,
  ): Promise<TaskError | undefined> {
    try {
      options.observer?.taskSettled?.(task, result);
      return undefined;
    } catch (error) {
      return this.observerFailure(error);
    }
  }

  private emit(
    type: TaskEventType,
    missionId: string,
    correlationId: string,
    data: Record<string, unknown>,
    taskId?: string,
  ): void {
    const event: TaskEvent = {
      seq: this.eventSeq++,
      type,
      missionId,
      ...(taskId ? { taskId } : {}),
      correlationId,
      at: this.now(),
      data,
    };
    this.eventBuffers.get(missionId)?.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Observers must never break governance or execution.
      }
    }
  }

  private blockedBeforeDispatch(
    missionId: string,
    code: TaskErrorCode,
    message: string,
    startedAt: string,
    options: ExecuteMissionOptions,
  ): MissionExecutionResult {
    return this.result(
      this.behaviorOS.getMission(missionId),
      'blocked',
      [],
      null,
      missionId,
      startedAt,
      { code, message, retryable: false },
      options,
    );
  }

  private result(
    mission: Mission | null,
    outcome: MissionOutcome,
    tasks: TaskResult[],
    governance: MissionExecutionResult['governance'],
    correlationId: string,
    startedAt: string,
    error: TaskError | undefined,
    options: ExecuteMissionOptions,
    explicitError?: TaskError,
  ): MissionExecutionResult {
    return {
      missionId: mission?.id ?? correlationId,
      status: mission?.status ?? 'failed',
      outcome,
      tasks,
      events: [...(this.eventBuffers.get(correlationId) ?? [])],
      governance,
      correlationId,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      startedAt,
      completedAt: this.now(),
      ...((explicitError ?? error) ? { error: explicitError ?? error } : {}),
    };
  }
}

/** Type guard used by consumers that keep task results across restarts. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}
