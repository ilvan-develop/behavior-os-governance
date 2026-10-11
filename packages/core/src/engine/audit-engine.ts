import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AuditReport, AuditResult, AuditStage } from '@behavior-os/schemas';

export interface AuditOptions {
  missionId: string;
  agentId: string;
  stages?: AuditStage[];
  metadata?: Record<string, unknown>;
  simulate?: boolean;
}

export class AuditEngine {
  private reports: AuditReport[] = [];

  run(options: AuditOptions): AuditReport {
    if (options.simulate ?? false) {
      return this.runSimulated(options);
    }
    return this.runReal(options);
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

    const stages: AuditResult[] = stagesList.map((stage) => ({
      id: `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage,
      status: Math.random() > 0.15 ? 'passed' : Math.random() > 0.5 ? 'warning' : 'failed',
      details: { simulated: true, ...options.metadata },
      timestamp: new Date().toISOString(),
    }));

    const overall: 'pass' | 'fail' | 'warning' = this.determineOverall(stages);

    const report: AuditReport = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      missionId: options.missionId,
      agentId: options.agentId,
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
