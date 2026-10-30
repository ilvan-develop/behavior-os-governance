import type { GovernanceDecision } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { ExplainableReportEngine } from '../src/engine/explainable-report-engine.js';

function makeDecision(verdict: 'allow' | 'deny' | 'escalate', reason: string): GovernanceDecision {
  return {
    id: `dec-${verdict}`,
    action: 'test-action',
    agentId: 'agent-1',
    verdict,
    reason,
    rulesEvaluated: ['r1'],
    firedRules: verdict === 'allow' ? [] : ['r1'],
    timestamp: new Date().toISOString(),
  };
}

describe('ExplainableReportEngine (G-018)', () => {
  it('generates a healthy report when all decisions are allow', () => {
    const engine = new ExplainableReportEngine();
    const decisions = [makeDecision('allow', 'ok'), makeDecision('allow', 'ok')];

    const report = engine.generateReport('agent-1', decisions, '2026-01-01', '2026-01-31');
    expect(report.severity).toBe('healthy');
    expect(report.decisionsAnalyzed).toBe(2);
    expect(report.findings).toContain('2 action(s) were allowed.');
    expect(report.summary).toContain('operated normally');
  });

  it('flags attention when there are blocks or escalations', () => {
    const engine = new ExplainableReportEngine();
    const decisions = [
      makeDecision('allow', 'ok'),
      makeDecision('allow', 'ok'),
      makeDecision('allow', 'ok'),
      makeDecision('allow', 'ok'),
      makeDecision('deny', 'block rule fired'),
      makeDecision('escalate', 'requires approval'),
    ];

    const report = engine.generateReport('agent-1', decisions, '2026-01-01', '2026-01-31');
    expect(report.severity).toBe('attention');
    expect(report.findings.some((f) => f.includes('1 action(s) were blocked'))).toBe(true);
    expect(report.findings.some((f) => f.includes('1 action(s) required human escalation'))).toBe(
      true,
    );
  });

  it('flags critical when the block rate is above 30%', () => {
    const engine = new ExplainableReportEngine();
    const decisions = [
      makeDecision('deny', 'reason 1'),
      makeDecision('deny', 'reason 2'),
      makeDecision('allow', 'ok'),
    ];

    const report = engine.generateReport('agent-1', decisions, '2026-01-01', '2026-01-31');
    expect(report.severity).toBe('critical');
    expect(report.recommendations.some((r) => r.toLowerCase().includes('block rate'))).toBe(true);
  });

  it('handles an empty decision set gracefully', () => {
    const engine = new ExplainableReportEngine();
    const report = engine.generateReport('agent-1', [], '2026-01-01', '2026-01-31');
    expect(report.decisionsAnalyzed).toBe(0);
    expect(report.severity).toBe('healthy');
    expect(report.recommendations).toContain(
      'No governance activity in this window — no action needed.',
    );
  });

  it('deduplicates deny reasons in findings', () => {
    const engine = new ExplainableReportEngine();
    const decisions = [
      makeDecision('deny', 'rule X fired'),
      makeDecision('deny', 'rule X fired'),
      makeDecision('deny', 'rule Y fired'),
    ];

    const report = engine.generateReport('agent-1', decisions, '2026-01-01', '2026-01-31');
    const blockedFinding = report.findings.find((f) => f.includes('blocked'));
    expect(blockedFinding?.includes('rule X fired')).toBe(true);
    expect(blockedFinding?.includes('rule Y fired')).toBe(true);
  });

  it('stores all generated reports', () => {
    const engine = new ExplainableReportEngine();
    engine.generateReport('agent-1', [makeDecision('allow', 'ok')], '2026-01-01', '2026-01-31');
    engine.generateReport('agent-2', [makeDecision('deny', 'blocked')], '2026-01-01', '2026-01-31');
    expect(engine.getReports()).toHaveLength(2);
  });
});
