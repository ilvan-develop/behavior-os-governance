import { describe, expect, it } from 'vitest';
import { AuditEngine } from '../src/engine/audit-engine.js';

describe('AuditEngine', () => {
  const engine = new AuditEngine();

  it('should run audit with default stages', () => {
    const report = engine.run({
      missionId: 'mission-1',
      agentId: 'agent-1',
    });

    expect(report.id).toBeDefined();
    expect(report.missionId).toBe('mission-1');
    expect(report.agentId).toBe('agent-1');
    expect(report.stages).toHaveLength(4); // lint, typecheck, security, coverage
    expect(report.overall).toBe('pass');
  });

  it('should run audit with custom stages', () => {
    const report = engine.run({
      missionId: 'mission-2',
      agentId: 'agent-2',
      stages: ['lint', 'security'],
    });

    expect(report.stages).toHaveLength(2);
  });

  it('should generate summary', () => {
    const report = engine.run({
      missionId: 'mission-1',
      agentId: 'agent-1',
    });

    expect(report.summary).toContain('passed');
  });

  it('should store reports', () => {
    const testEngine = new AuditEngine();
    testEngine.run({ missionId: 'm1', agentId: 'a1' });
    testEngine.run({ missionId: 'm2', agentId: 'a2' });

    const reports = testEngine.getReports();
    expect(reports).toHaveLength(2);
  });

  it('should get report by id', () => {
    const report = engine.run({ missionId: 'm1', agentId: 'a1' });
    const found = engine.getReport(report.id);

    expect(found).toBeDefined();
    expect(found?.id).toBe(report.id);
  });

  it('should return undefined for non-existent report', () => {
    const found = engine.getReport('non-existent');
    expect(found).toBeUndefined();
  });
});
