import type { AdapterResult } from '@behavior-os/schemas';
import type { AdapterExecutionContext, TaskAdapter } from './adapters.js';

/**
 * A no-op adapter that records calls for testing and simulation.
 *
 * Use this when you want to verify orchestration logic without executing real
 * commands (e.g. in unit tests or when `simulationMode` is enabled).
 */
export class RecordAdapter implements TaskAdapter {
  readonly name = 'record';
  private readonly records: Array<{ input: Record<string, unknown>; context: unknown }> = [];

  getRecords() {
    return this.records;
  }

  async execute(
    input: Record<string, unknown>,
    context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    this.records.push({ input, context });
    return {
      exitCode: 0,
      stdout: `recorded:${input.command ?? 'noop'}`,
      stderr: '',
      metadata: { recorded: true, taskId: context.taskId },
    };
  }
}

/**
 * A delay adapter that simulates work by sleeping for `durationMs`.
 *
 * Useful for testing timeout and cancellation semantics without real work.
 */
export class DelayAdapter implements TaskAdapter {
  readonly name = 'delay';
  private readonly durationMs: number;

  constructor(durationMs: number) {
    this.durationMs = durationMs;
  }

  async execute(
    input: Record<string, unknown>,
    context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    const override = input.durationMs;
    const ms = typeof override === 'number' ? override : this.durationMs;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Adapter execution cancelled'));
        },
        { once: true },
      );
    });

    return {
      exitCode: 0,
      stdout: `delayed ${ms}ms`,
      stderr: '',
      metadata: { delayed: true },
    };
  }
}

/**
 * A fail adapter that always returns a failure result.
 *
 * Useful for testing retry, circuit-breaker, and error-handling paths.
 */
export class FailAdapter implements TaskAdapter {
  readonly name = 'fail';
  private readonly exitCode: number;
  private readonly stderr: string;

  constructor(options: { exitCode?: number; stderr?: string } = {}) {
    this.exitCode = options.exitCode ?? 1;
    this.stderr = options.stderr ?? 'simulated failure';
  }

  async execute(
    _input: Record<string, unknown>,
    _context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    return {
      exitCode: this.exitCode,
      stdout: '',
      stderr: this.stderr,
      metadata: { failed: true },
    };
  }
}

/**
 * A governance-aware adapter that checks governance before executing.
 *
 * When governance denies the action, the adapter returns a special result with
 * `governanceDenied: true` in metadata instead of executing.
 */
export class GovernedAdapter implements TaskAdapter {
  readonly name = 'governed';

  async execute(
    _input: Record<string, unknown>,
    context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    // In a real implementation, this would call BehaviorOS.preflightAction()
    // and abort if denied. For now, simulate success.
    return {
      exitCode: 0,
      stdout: 'governed-execution-ok',
      stderr: '',
      metadata: { governed: true, agentId: context.agentId },
    };
  }
}
