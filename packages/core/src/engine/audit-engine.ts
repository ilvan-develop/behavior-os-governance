import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AuditReport, AuditResult, AuditStage } from '@behavior-os/schemas';

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
        const hasLinter = this.isToolAvailable('eslint') || this.isToolAvailable('oxlint');
        if (!hasLinter) {
          return { ...base, status: 'skipped', details: { reason: 'No linter tool found' } };
        }
        try {
          execSync('pnpm lint:check', { stdio: 'pipe', timeout: 60_000 });
          return { ...base, status: 'passed', details: { checked: true, ...options.metadata } };
        } catch {
          return {
            ...base,
            status: 'failed',
            details: { checked: true, error: 'Lint checks failed' },
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
