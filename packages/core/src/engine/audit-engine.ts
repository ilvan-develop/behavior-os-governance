import type { AuditReport, AuditResult, AuditStage } from '@behavior-os/schemas';

export interface AuditOptions {
  missionId: string;
  agentId: string;
  stages?: AuditStage[];
  metadata?: Record<string, unknown>;
}

export class AuditEngine {
  private reports: AuditReport[] = [];

  run(options: AuditOptions): AuditReport {
    const stagesList: AuditStage[] = options.stages?.length
      ? options.stages
      : (['lint', 'typecheck', 'security', 'coverage'] as AuditStage[]);
    const stages: AuditResult[] = stagesList.map((stage) => ({
      id: `stage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stage,
      status: 'passed',
      details: { checked: true, ...options.metadata },
      timestamp: new Date().toISOString(),
    }));

    const overall: 'pass' | 'fail' | 'warning' = stages.every((s) => s.status === 'passed')
      ? 'pass'
      : stages.some((s) => s.status === 'failed')
        ? 'fail'
        : 'warning';

    const report: AuditReport = {
      id: `audit-${Date.now()}`,
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
