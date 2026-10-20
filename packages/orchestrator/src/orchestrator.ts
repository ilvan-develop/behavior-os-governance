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

export interface ExecuteMissionOptions {
  signal?: AbortSignal;
  /** Default `executed`: completion requires executed evidence + executionId. */
  verificationMode?: 'any' | 'executed';
  idempotencyKey?: string;
  /** Resume an existing active/paused mission instead of creating a new one. */
  resumeMissionId?: string;
  /** Repeated identical failures that abort a task. Default 2. */
  loopThreshold?: number;
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
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();
  private readonly completedByKey = new Map<string, MissionExecutionResult>();
  private readonly inflightByKey = new Map<string, Promise<MissionExecutionResult>>();
  private readonly eventBuffers = new Map<string, TaskEvent[]>();
  private readonly options: OrchestratorOptions;
  private readonly dnasDir: string;
  private readonly now: () => string;
  private eventSeq = 0;

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
    this.behaviorOS = options.behaviorOS ?? new BehaviorOS();
    this.dnasDir = options.dnasDir ?? resolve(process.cwd(), 'dnas');
    this.now = options.now ?? (() => new Date().toISOString());
    this.registerAdapter(new ShellAdapter());
  }

  /** Register an agent identity. The adapter does the executing; the agent is governance provenance. */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
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

    // -----------------------------------------------------------------------
    // Task dispatch (sequential, fail-fast, resumable from executed evidence)
    // -----------------------------------------------------------------------
    const results: TaskResult[] = [];
    let terminalError: TaskError | undefined;
    let cancelled = false;

    for (const task of tasks) {
      if (options.signal?.aborted) {
        cancelled = true;
        terminalError = {
          code: 'CANCELLED',
          message: 'Mission cancelled by the caller before the next task',
          retryable: false,
        };
        break;
      }

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
        continue;
      }

      const taskResult = await this.executeTask(task, options);
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

      // Record evidence for every completed criterion. Failed tasks also record
      // their failed evidence, so the audit trail shows what actually ran.
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
      }

      if (taskResult.status !== 'completed') {
        terminalError = taskResult.error ?? {
          code: 'EXECUTION_FAILED',
          message: `Task "${task.id}" ended as ${taskResult.status}`,
          retryable: false,
        };
        if (taskResult.status === 'cancelled') cancelled = true;
        break;
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
    task: TaskDefinition,
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
  ): TaskDefinition[] {
    if (!plan.title || plan.title.trim().length === 0) {
      throw new OrchestratorError('INVALID_INPUT', 'Mission plan requires a non-empty title');
    }
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
      throw new OrchestratorError('INVALID_INPUT', 'Mission plan requires at least one task');
    }

    const now = this.now();
    const missionId = existing?.id ?? `pending:${plan.idempotencyKey ?? plan.title}`;
    const seenIds = new Set<string>();
    const tasks: TaskDefinition[] = [];

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

      tasks.push({
        id,
        missionId,
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
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
        createdAt: now,
        updatedAt: now,
      });
    });

    return tasks;
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
      .filter((criterion) => criterion.required)
      .map((criterion) => criterion.gate);
    if (required.length === 0) return null;

    const evidence = mission.evidence ?? [];
    const matched: MissionEvidence[] = [];
    for (const gate of required) {
      const latest = [...evidence].reverse().find((entry) => entry.gate === gate);
      if (
        latest?.status !== 'passed' ||
        latest?.provenance !== 'executed' ||
        !latest?.executionId
      ) {
        return null;
      }
      matched.push(latest);
    }
    return matched;
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
