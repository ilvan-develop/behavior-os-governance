import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  run(options: AuditOptions): AuditReport {
    if (options.simulate === false) {
      return this.runReal(options);
    }
    return this.runSimulated(options);
  }

  runReal(options: AuditOptions): AuditReport {
    const stagesList: AuditStage[] = options.stages?.length
      ? options.stages
      : (['lint', 'typecheck', 'security', 'coverage'] as AuditStage[]);

    const stages: AuditResult[] = stagesList.map((stage) => this.runStageReal(stage, options));

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

  private runStageReal(stage: AuditStage, options: AuditOptions): AuditResult {
    const base = {
      id: `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage,
      timestamp: new Date().toISOString(),
    };

    switch (stage) {
      case 'lint': {
        // Resolve the linter from the project root, not from the process cwd:
        // the engine runs from a package directory (and, in the plugin, from a
        // host process) where `node_modules/.bin` is not necessarily on PATH.
        const projectRoot = findProjectRoot();
        const linter = projectRoot ? detectLinter(projectRoot) : null;
        const hasLinter =
          linter !== null ||
          this.isToolAvailable('eslint') ||
          this.isToolAvailable('oxlint') ||
          this.isToolAvailable('biome');
        if (!hasLinter) {
          return { ...base, status: 'skipped', details: { reason: 'No linter tool found' } };
        }
        try {
          execSync('pnpm lint:check', {
            stdio: 'pipe',
            timeout: 60_000,
            cwd: projectRoot ?? undefined,
          });
          return {
            ...base,
            status: 'passed',
            details: { checked: true, linter: linter ?? 'binary', ...options.metadata },
          };
        } catch {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, linter: linter ?? 'binary', error: 'Lint checks failed' },
          };
        }
      }
      case 'typecheck': {
        try {
          execSync('pnpm typecheck', { stdio: 'pipe', timeout: 120_000 });
          return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
        } catch {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, error: 'Type checks failed' },
          };
        }
      }
      case 'security': {
        try {
          execSync('pnpm audit --audit-level=high', { stdio: 'pipe', timeout: 60_000 });
          return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
        } catch {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, error: 'Security audit found vulnerabilities' },
          };
        }
      }
      case 'coverage': {
        const hasCoverage = existsSync('coverage/lcov-report/index.html');
        if (!hasCoverage) {
          return {
            ...base,
            status: 'warning',
            details: { checked: true, reason: 'No coverage report found' },
          };
        }
        return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
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

  private isToolAvailable(tool: string): boolean {
    try {
      execSync(`${tool} --version`, { stdio: 'ignore' });
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
