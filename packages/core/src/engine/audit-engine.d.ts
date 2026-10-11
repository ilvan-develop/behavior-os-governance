import type { AuditReport, AuditStage } from '@behavior-os/schemas';
export interface AuditOptions {
  missionId: string;
  agentId: string;
  stages?: AuditStage[];
  metadata?: Record<string, unknown>;
}
export declare class AuditEngine {
  private reports;
  run(options: AuditOptions): AuditReport;
  getReports(): AuditReport[];
  getReport(id: string): AuditReport | undefined;
  private generateSummary;
}
//# sourceMappingURL=audit-engine.d.ts.map
