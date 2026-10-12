import type { GateResult, GateStatus, PipelinePhase, PipelineRun } from '@behavior-os/schemas';

/**
 * Context passed to every gate. Gates are synchronous by design: a `pre` gate
 * must be able to veto an action *before* it runs, so the pipeline never awaits
 * I/O in the decision path.
 */
export interface GateContext {
  action?: string;
  agentId?: string;
  missionId?: string;
  metrics?: Record<string, number>;
  context?: Record<string, unknown>;
}

export interface GateOutcome {
  status: GateStatus;
  details?: Record<string, unknown>;
}

/**
 * A single stage of the pipeline. `blocking` + a `failed` status is what turns a
 * gate into a hard stop; a non-blocking failure is recorded but lets the run
 * continue.
 */
export interface PipelineGate {
  id: string;
  name: string;
  phase: PipelinePhase;
  blocking: boolean;
  evaluate(context: GateContext): GateOutcome;
}

export interface PipelineRunOptions {
  /** Which phases to execute. Defaults to both `pre` and `post`. */
  phases?: PipelinePhase[];
}

export interface PreflightResult {
  /** `true` when no blocking `pre` gate failed. */
  allowed: boolean;
  /** Id of the gate that blocked the action, when `allowed` is false. */
  blockedBy?: string;
  run: PipelineRun;
}

/**
 * Runs an ordered, extensible set of gates over an action.
 *
 * The engine itself is generic: `BehaviorOS` seeds it with the DNA-derived
 * governance/quality gates, but any host can register its own gates. Unlike the
 * OpenCode plugin's permission hook, `run()`/`preflight()` live in core, so any
 * host (MCP server, SDK, CLI) can block an action synchronously before it runs.
 */
export class PipelineEngine {
  private gates: PipelineGate[] = [];

  constructor(gates: PipelineGate[] = []) {
    for (const gate of gates) this.addGate(gate);
  }

  /** Add a gate, or replace an existing gate with the same id. */
  addGate(gate: PipelineGate): void {
    const index = this.gates.findIndex((g) => g.id === gate.id);
    if (index >= 0) this.gates[index] = gate;
    else this.gates.push(gate);
  }

  removeGate(id: string): boolean {
    const before = this.gates.length;
    this.gates = this.gates.filter((gate) => gate.id !== id);
    return this.gates.length !== before;
  }

  getGates(phase?: PipelinePhase): PipelineGate[] {
    return phase ? this.gates.filter((gate) => gate.phase === phase) : [...this.gates];
  }

  getGate(id: string): PipelineGate | undefined {
    return this.gates.find((gate) => gate.id === id);
  }

  /**
   * Run the pipeline. Gates execute in insertion order; the first *blocking*
   * failure halts the run (later gates do not execute) and marks it blocked.
   */
  run(context: GateContext = {}, options: PipelineRunOptions = {}): PipelineRun {
    const phases = options.phases ?? (['pre', 'post'] as PipelinePhase[]);
    const startedAt = Date.now();
    const results: GateResult[] = [];
    let blocked = false;
    let blockedBy: string | undefined;

    for (const gate of this.gates) {
      if (!phases.includes(gate.phase)) continue;

      const gateStartedAt = Date.now();
      let outcome: GateOutcome;
      try {
        outcome = gate.evaluate(context);
      } catch (error) {
        // A gate that throws is treated as a failure rather than crashing the
        // caller — this is the pre-execution safety path.
        outcome = {
          status: 'failed',
          details: { error: error instanceof Error ? error.message : String(error) },
        };
      }

      results.push({
        id: gate.id,
        name: gate.name,
        phase: gate.phase,
        blocking: gate.blocking,
        status: outcome.status,
        details: outcome.details ?? {},
        durationMs: Date.now() - gateStartedAt,
        timestamp: new Date().toISOString(),
      });

      if (gate.blocking && outcome.status === 'failed') {
        blocked = true;
        blockedBy = gate.id;
        break;
      }
    }

    return {
      id: `pipe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      overall: this.determineOverall(results),
      blocked,
      ...(blockedBy ? { blockedBy } : {}),
      phases,
      gates: results,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      ...(context.missionId ? { missionId: context.missionId } : {}),
      ...(context.agentId ? { agentId: context.agentId } : {}),
    };
  }

  /**
   * Synchronous pre-execution check: runs only the `pre` gates and reports
   * whether the action may proceed. This is the core-level equivalent of the
   * OpenCode plugin's permission hook, usable by any host.
   */
  preflight(context: GateContext = {}): PreflightResult {
    const run = this.run(context, { phases: ['pre'] });
    return {
      allowed: !run.blocked,
      ...(run.blockedBy ? { blockedBy: run.blockedBy } : {}),
      run,
    };
  }

  private determineOverall(results: GateResult[]): PipelineRun['overall'] {
    if (results.some((result) => result.status === 'failed')) return 'fail';
    if (results.some((result) => result.status === 'warning')) return 'warning';
    return 'pass';
  }
}
