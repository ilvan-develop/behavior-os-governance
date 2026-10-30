import type { GovernanceDecision } from '@behavior-os/schemas';

/**
 * G-018: Explainable Report Generator.
 *
 * Produces plain-language summaries of governance activity for
 * non-technical stakeholders.
 */

interface ExplainableReport {
  id: string;
  title: string;
  agentId: string;
  from: string;
  to: string;
  decisionsAnalyzed: number;
  summary: string;
  findings: string[];
  recommendations: string[];
  severity: 'healthy' | 'attention' | 'critical';
  timestamp: string;
}

export class ExplainableReportEngine {
  private reports: ExplainableReport[] = [];

  generateReport(
    agentId: string,
    decisions: GovernanceDecision[],
    from: string,
    to: string,
  ): ExplainableReport {
    const denyCount = decisions.filter((d) => d.verdict === 'deny').length;
    const escalateCount = decisions.filter((d) => d.verdict === 'escalate').length;
    const allowCount = decisions.filter((d) => d.verdict === 'allow').length;

    const severity: ExplainableReport['severity'] =
      decisions.length > 0 && denyCount / decisions.length > 0.3
        ? 'critical'
        : denyCount > 0 || escalateCount > 0
          ? 'attention'
          : 'healthy';

    const findings: string[] = [];
    if (allowCount > 0) findings.push(`${allowCount} action(s) were allowed.`);
    if (denyCount > 0) {
      const denyReasons = [
        ...new Set(decisions.filter((d) => d.verdict === 'deny').map((d) => d.reason)),
      ];
      findings.push(
        `${denyCount} action(s) were blocked: ${denyReasons.slice(0, 5).join('; ') || 'no reason recorded'}.`,
      );
    }
    if (escalateCount > 0) findings.push(`${escalateCount} action(s) required human escalation.`);

    const recommendations: string[] = [];
    if (severity === 'critical') {
      recommendations.push(
        'Review blocked actions — high block rate suggests policy misalignment.',
      );
    }
    if (escalateCount > 0) {
      recommendations.push('Triage pending escalations before they block agent progress.');
    }
    if (decisions.length === 0) {
      recommendations.push('No governance activity in this window — no action needed.');
    }

    const summary =
      severity === 'healthy'
        ? `Agent ${agentId} operated normally between ${from} and ${to}.`
        : `Agent ${agentId} had ${denyCount} block(s) and ${escalateCount} escalation(s) between ${from} and ${to}.`;

    const report: ExplainableReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: `Governance Summary — ${agentId}`,
      agentId,
      from,
      to,
      decisionsAnalyzed: decisions.length,
      summary,
      findings,
      recommendations,
      severity,
      timestamp: new Date().toISOString(),
    };

    this.reports.push(report);
    return report;
  }

  getReports(): ExplainableReport[] {
    return [...this.reports];
  }
}

export type { ExplainableReport };
