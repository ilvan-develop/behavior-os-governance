import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { AuditReport, AuditResult, AuditStage } from '@behavior-os/schemas';

/**
 * Linter markers, in preference order. The real `lint` stage must recognise the
 * project's actual linter; probing only for an `eslint`/`oxlint` binary reported
 * `skipped` in this repository, whose linter is Biome (G-017).
 */
const LINTER_MARKERS = [
  { name: 'biome', configs: ['biome.json', 'biome.jsonc'] },
  {
    name: 'eslint',
    configs: [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
    ],
  },
  { name: 'oxlint', configs: ['.oxlintrc.json'] },
] as const;

/** True when `dir` declares a lint script in its `package.json`. */
function hasLintScript(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    return Boolean(scripts['lint:check'] ?? scripts.lint);
  } catch {
    return false;
  }
}

/**
 * Best-effort audit root for hosts that know the workspace only through
 * environment variables (the MCP stdio server).
 *
 * `BEHAVIOROS_DNA_PATH` points at a patterns directory (`<root>/dnas`) or at a
 * single pattern (`<root>/dnas/<name>.yaml`); both mean `<root>`. An absolute
 * value is used directly. A relative value (the shipped `.mcp.json` uses
 * `./dnas/...`) is resolved against `startDir` and then by walking up, so the
 * result does not depend on the process cwd: the server passes its own module
 * directory, and the walk finds the checkout that actually holds the pattern.
 * Returns `undefined` when nothing matches, so the engine keeps its discovery.
 *
 * Deliberately does **not** introduce a new variable: the old project-root
 * variable is recorded in `docs/CLAIMS.md` as withdrawn (no code reads it), and
 * the docs-consistency guard fails if its name reappears in the source.
 */
export function resolveAuditRoot(
  env: NodeJS.ProcessEnv = process.env,
  startDir: string = process.cwd(),
): string | undefined {
  const raw = env.BEHAVIOROS_DNA_PATH?.trim();
  if (!raw) return undefined;
  const isFile = /\.ya?ml$/i.test(raw);

  if (isAbsolute(raw)) {
    const absolute = resolve(raw);
    return isFile ? dirname(dirname(absolute)) : dirname(absolute);
  }

  let current = resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = resolve(current, raw);
    if (existsSync(candidate)) {
      return isFile ? dirname(dirname(candidate)) : dirname(candidate);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Nearest ancestor of `start` that can run the project lint command: it must
 * declare a lint script and, preferably, a linter config. Walking up matters
 * because the engine runs from a package directory (`packages/core`) while the
 * linter is configured at the workspace root.
 */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let current = resolve(start);
  let scriptRoot: string | null = null;
  for (let depth = 0; depth < 12; depth += 1) {
    if (hasLintScript(current)) {
      if (detectLinter(current) !== null) return current;
      scriptRoot ??= current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return scriptRoot;
}

/**
 * Detect the linter configured in `root` by its config file. Returns null when
 * no known linter is configured; the stage then falls back to a binary probe.
 */
export function detectLinter(root: string): string | null {
  for (const marker of LINTER_MARKERS) {
    if (marker.configs.some((file) => existsSync(join(root, file)))) {
      return marker.name;
    }
  }
  return null;
}

/**
 * Coverage layouts written by the reporters configured in this workspace.
 * The root config uses `text`, `json` and `html`, which write
 * `coverage/index.html` and `coverage/coverage-final.json`; the previous probe
 * only knew the `lcov` layout, so a real report was reported as missing.
 */
const COVERAGE_REPORT_MARKERS = [
  'coverage/index.html',
  'coverage/lcov-report/index.html',
  'coverage/coverage-final.json',
  'coverage/coverage-summary.json',
] as const;

/**
 * Absolute path of the first coverage report found under the workspace root.
 * Resolution starts at the project root (not the process cwd) so an audit run
 * from `packages/core` still finds the report written at the root.
 */
export function findCoverageReport(start: string = process.cwd()): string | null {
  const root = findProjectRoot(start) ?? resolve(start);
  for (const marker of COVERAGE_REPORT_MARKERS) {
    const candidate = join(root, marker);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Compact, actionable reason for a failed child command. The previous stages
 * discarded the error entirely, so a real audit reported `failed` with no way
 * to tell a vulnerability from a missing script or a registry timeout.
 */
function describeCommandFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = (error as { status?: number | null }).status;
  const signal = (error as { signal?: string | null }).signal;
  const exit = status !== undefined && status !== null ? ` (exit ${status})` : '';
  const killed = signal ? ` (signal ${signal})` : '';
  const message = error.message.length > 800 ? `${error.message.slice(0, 800)}…` : error.message;
  return `${message}${exit}${killed}`;
}

export interface AuditOptions {
  missionId: string;
  /**
   * Governed agent id (`persona:<role>` when no agent is registered). Resolved
   * by {@link BehaviorOS.runAudit} from the active DNA, never from a model name.
   */
  agentId: string;
  /** DNA pattern active when the audit ran. */
  dnaPattern?: string | null;
  /** Persona that authorized the audit, when the DNA defines one. */
  persona?: string | null;
  stages?: AuditStage[];
  metadata?: Record<string, unknown>;
  simulate?: boolean;
  /**
   * Project root the real stages shell out from. Callers that know the
   * workspace (the OpenCode plugin gets it as `ctx.location.directory`) must
   * pass it: the host process cwd is not guaranteed to be inside the project,
   * and `findProjectRoot()` only walks up from cwd. Without this, a green
   * project reports `typecheck`/`security` failures ("no script", "no lockfile")
   * while `lint` silently degrades to `skipped` — a false red audit.
   */
  root?: string;
}

/**
 * Execute a command silently in the background — no visible CMD window on Windows.
 * Uses `spawn` with `windowsHide: true` (and `shell: true`, required on Windows
 * to resolve `pnpm`/`pnpm.cmd` shims) so the console window stays hidden while
 * the command runs. stdout is ignored; stderr is captured for failure details.
 */
function execSilently(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Node DEP0190: passing `args` alongside `shell: true` is deprecated.
    // Build a single command line instead.
    const child = spawn([command, ...args].join(' '), {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = stderr.length + text.length > 800 ? stderr : stderr + text;
    });

    const timeoutMs = options.timeout ?? 0;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Command exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
    });
  });
}

export class AuditEngine {
  private reports: AuditReport[] = [];

  /**
   * Runs an audit.
   *
   * Simulated audits are the default because they are fast and
   * environment-independent. Real audits shell out to the project's
   * lint/typecheck/security/coverage commands, so they must be opted into
   * explicitly with `simulate: false`.
   */
  async run(options: AuditOptions): Promise<AuditReport> {
    if (options.simulate === false) {
      return this.runReal(options);
    }
    return this.runSimulated(options);
  }

  async runReal(options: AuditOptions): Promise<AuditReport> {
    const stagesList: AuditStage[] = options.stages?.length
      ? options.stages
      : (['lint', 'typecheck', 'security', 'coverage'] as AuditStage[]);

    // Stages run sequentially: each stage shells out to `pnpm` (typecheck and
    // lint are heavyweight Node/tsc processes); running them side by side
    // causes memory/contention flakiness — a green project reporting a false
    // `failed` stage.
    const stages: AuditResult[] = [];
    for (const stage of stagesList) {
      stages.push(await this.runStageReal(stage, options));
    }

    const overall: 'pass' | 'fail' | 'warning' = this.determineOverall(stages);

    const report: AuditReport = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      missionId: options.missionId,
      agentId: options.agentId,
      dnaPattern: options.dnaPattern ?? null,
      persona: options.persona ?? null,
      stages,
      overall,
      summary: this.generateSummary(stages, overall),
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    return report;
  }

  private async runStageReal(stage: AuditStage, options: AuditOptions): Promise<AuditResult> {
    const base = {
      id: `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage,
      timestamp: new Date().toISOString(),
    };

    // Every real stage runs in the workspace root. The plugin host's cwd is not
    // guaranteed to be the project (it can be its config directory), and only
    // the lint stage used to pin a cwd; typecheck/security/coverage then ran in
    // the host's directory and failed with "no script" even on a green project.
    // `options.root` is the authoritative answer when the caller knows it.
    const projectRoot = options.root ?? findProjectRoot() ?? process.cwd();

    switch (stage) {
      case 'lint': {
        // Resolve the linter from the project root, not from the process cwd:
        // the engine runs from a package directory (and, in the plugin, from a
        // host process) where `node_modules/.bin` is not necessarily on PATH.
        const linter = detectLinter(projectRoot);
        const hasLinter =
          linter !== null ||
          (await this.isToolAvailable('eslint')) ||
          (await this.isToolAvailable('oxlint')) ||
          (await this.isToolAvailable('biome'));
        if (!hasLinter) {
          return { ...base, status: 'skipped', details: { reason: 'No linter tool found' } };
        }
        try {
          // Use spawn (async) with windowsHide:true to run silently in background —
          // no visible CMD window on Windows. This is the UX-correct approach.
          await execSilently('pnpm', ['lint:check'], { cwd: projectRoot, timeout: 120_000 });
          return {
            ...base,
            status: 'passed',
            details: { checked: true, linter: linter ?? 'binary', ...options.metadata },
          };
        } catch (error) {
          return {
            ...base,
            status: 'failed',
            details: {
              checked: true,
              linter: linter ?? 'binary',
              error: describeCommandFailure(error),
            },
          };
        }
      }
      case 'typecheck': {
        try {
          await execSilently('pnpm', ['typecheck'], { cwd: projectRoot, timeout: 240_000 });
          return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
        } catch (error) {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, error: describeCommandFailure(error) },
          };
        }
      }
      case 'security': {
        try {
          await execSilently('pnpm', ['audit', '--audit-level=high'], {
            cwd: projectRoot,
            timeout: 180_000,
          });
          return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
        } catch (error) {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, error: describeCommandFailure(error) },
          };
        }
      }
      case 'coverage': {
        const coverageReport = findCoverageReport(projectRoot);
        if (!coverageReport) {
          return {
            ...base,
            status: 'warning',
            details: { checked: true, reason: 'No coverage report found' },
          };
        }
        return {
          ...base,
          status: 'passed',
          details: {
            checked: true,
            report: relative(projectRoot, coverageReport),
            ...options.metadata,
          },
        };
      }
      default:
        return { ...base, status: 'skipped', details: { reason: `Unknown stage: ${stage}` } };
    }
  }

  private runSimulated(options: AuditOptions): AuditReport {
    const stagesList: AuditStage[] = options.stages?.length
      ? options.stages
      : (['lint', 'typecheck', 'security', 'coverage'] as AuditStage[]);

    // Deterministic by design: a simulated audit is a dry run that reports
    // the pipeline shape without executing anything, so it always passes.
    // (The previous implementation used Math.random(), which made both the
    // result and dependent tests flaky.)
    const stages: AuditResult[] = stagesList.map((stage) => ({
      id: `stage-sim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage,
      status: 'passed',
      details: { simulated: true, ...options.metadata },
      timestamp: new Date().toISOString(),
    }));

    const overall: 'pass' | 'fail' | 'warning' = this.determineOverall(stages);

    const report: AuditReport = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      missionId: options.missionId,
      agentId: options.agentId,
      dnaPattern: options.dnaPattern ?? null,
      persona: options.persona ?? null,
      stages,
      overall,
      summary: this.generateSummary(stages, overall),
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    return report;
  }

  private determineOverall(stages: AuditResult[]): 'pass' | 'fail' | 'warning' {
    if (stages.some((s) => s.status === 'failed')) return 'fail';
    if (stages.some((s) => s.status === 'warning')) return 'warning';
    return 'pass';
  }

  private async isToolAvailable(tool: string): Promise<boolean> {
    try {
      // Use execSilently (spawn-based, windowsHide:true) to run silently in background
      await execSilently(tool, ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getReports(): AuditReport[] {
    return this.reports;
  }

  getReport(id: string): AuditReport | undefined {
    return this.reports.find((r) => r.id === id);
  }

  private generateSummary(stages: AuditResult[], _overall: string): string {
    const passed = stages.filter((s) => s.status === 'passed').length;
    const failed = stages.filter((s) => s.status === 'failed').length;
    const warnings = stages.filter((s) => s.status === 'warning').length;
    return `${passed} passed, ${failed} failed, ${warnings} warnings`;
  }
}
