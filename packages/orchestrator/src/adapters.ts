import { spawn } from 'node:child_process';
import type { AdapterResult } from '@behavior-os/schemas';

/**
 * Context handed to an execution adapter. `signal` is aborted on timeout, on
 * caller cancellation, and when the mission is cancelled. Adapters must stop
 * their work and resolve; an adapter that ignores the signal cannot make the
 * orchestrator report success, because the orchestrator classifies the attempt
 * from its own signal state.
 */
export interface AdapterExecutionContext {
  taskId: string;
  missionId: string;
  correlationId: string;
  idempotencyKey: string;
  agentId: string;
  /** 1-based attempt number. */
  attempt: number;
  timeoutMs?: number;
  signal: AbortSignal;
}

/**
 * A real execution adapter. Its output is untrusted: the orchestrator validates
 * it against `AdapterResultSchema` before it can affect task or mission state.
 */
export interface TaskAdapter {
  readonly name: string;
  execute(input: Record<string, unknown>, context: AdapterExecutionContext): Promise<AdapterResult>;
}

export interface ShellAdapterOptions {
  /** Default working directory; `input.cwd` overrides it per task. */
  cwd?: string;
  /** Use a shell for the command (needed for `pnpm`, pipes, etc.). Default false. */
  shell?: boolean;
  /** Cap per stream, in bytes/characters. Default 1 MiB. */
  maxOutputChars?: number;
}

function stringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Executes a real child process. This is the local execution path used to prove
 * the orchestration loop is not a stub: it spawns a process, captures its exit
 * status and output, honours cancellation, and never invents an exit code.
 *
 * Security boundary: the command comes from the caller/plan and must be gated
 * by governance before dispatch. The adapter itself does not sandbox the child;
 * it deliberately has no implicit shell and no inherited secret injection beyond
 * the process environment.
 */
export class ShellAdapter implements TaskAdapter {
  readonly name = 'shell';
  private readonly options: ShellAdapterOptions;

  constructor(options: ShellAdapterOptions = {}) {
    this.options = options;
  }

  async execute(
    input: Record<string, unknown>,
    context: AdapterExecutionContext,
  ): Promise<AdapterResult> {
    const command = stringInput(input, 'command');
    if (!command || command.trim().length === 0) {
      throw new Error('ShellAdapter requires a non-empty "command" input');
    }

    const rawArgs = input.args;
    const args = Array.isArray(rawArgs) ? rawArgs.map((value) => String(value)) : [];
    const cwd = stringInput(input, 'cwd') ?? this.options.cwd ?? process.cwd();
    const shell = typeof input.shell === 'boolean' ? input.shell : (this.options.shell ?? false);
    const maxOutputChars = this.options.maxOutputChars ?? 1024 * 1024;

    const envOverrides = input.env;
    const env =
      envOverrides && typeof envOverrides === 'object' && !Array.isArray(envOverrides)
        ? {
            ...process.env,
            ...Object.fromEntries(
              Object.entries(envOverrides as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ),
          }
        : process.env;

    if (context.signal.aborted) {
      return { exitCode: null, stdout: '', stderr: 'aborted before execution' };
    }

    return await new Promise<AdapterResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;
      let forceKill: NodeJS.Timeout | undefined;

      const append = (current: string, chunk: string, truncated: boolean): [string, boolean] => {
        if (truncated) return [current, true];
        const remaining = maxOutputChars - current.length;
        if (chunk.length <= remaining) return [current + chunk, false];
        return [current + chunk.slice(0, remaining), true];
      };

      const finish = (exitCode: number | null, extraStderr?: string): void => {
        if (settled) return;
        settled = true;
        if (forceKill) clearTimeout(forceKill);
        context.signal.removeEventListener('abort', onAbort);
        const stdoutSuffix = stdoutTruncated ? '\n[stdout truncated]' : '';
        const stderrSuffix = stderrTruncated ? '\n[stderr truncated]' : '';
        resolve({
          exitCode,
          stdout: `${stdout}${stdoutSuffix}`,
          stderr: `${stderr}${extraStderr ?? ''}${stderrSuffix}`,
        });
      };

      const child = spawn(command, args, {
        cwd,
        env,
        shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const onAbort = (): void => {
        // Ask politely, then guarantee termination so a timed-out task cannot
        // leak a process into the rest of the test/CI run. Resolution happens on
        // `close`, so the adapter never reports before the child is gone.
        child.kill('SIGTERM');
        forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
        forceKill.unref?.();
      };
      context.signal.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer | string) => {
        [stdout, stdoutTruncated] = append(stdout, chunk.toString(), stdoutTruncated);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        [stderr, stderrTruncated] = append(stderr, chunk.toString(), stderrTruncated);
      });

      child.on('error', (error: Error) => {
        finish(null, `\n[spawn error] ${error.message}`);
      });
      child.on('close', (code: number | null) => {
        finish(code);
      });
    });
  }
}
