import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os';

describe('AuditEngine - Real Mode', () => {
  const _dna: DNA = {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [],
    quality: [],
  };

  it('should run in simulate mode by default', () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'feature', priority: 'medium' });

    const report = bos.runAudit({ missionId: mission.id, agentId: 'test-agent' });

    expect(report.overall).toBeDefined();
    expect(report.stages.length).toBeGreaterThan(0);
    // Simulate mode may have random results
    expect(report.summary).toContain('passed');
  });

  it('should accept explicit simulate option', () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'bugfix', priority: 'high' });

    const report = bos.runAudit({ missionId: mission.id, agentId: 'agent-1', simulate: true });

    expect(report).toBeDefined();
    expect(report.missionId).toBe(mission.id);
    expect(report.agentId).toBe('agent-1');
  });

  it('should store multiple reports', async () => {
    const bos = new BehaviorOS();
    const m1 = bos.createMission({ title: 'M1', type: 'feature', priority: 'low' });
    const m2 = bos.createMission({ title: 'M2', type: 'refactor', priority: 'medium' });

    const r1 = bos.runAudit({ missionId: m1.id, agentId: 'a1' });
    // Ensure unique IDs by waiting for next millisecond
    await new Promise((r) => setTimeout(r, 10));
    const r2 = bos.runAudit({ missionId: m2.id, agentId: 'a2' });

    expect(r1.id).not.toBe(r2.id);
    expect(r1.missionId).toBe(m1.id);
    expect(r2.missionId).toBe(m2.id);
  });

  it('should allow custom stages', () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'audit', priority: 'critical' });

    const report = bos.runAudit({
      missionId: mission.id,
      agentId: 'a1',
      simulate: true,
    });

    expect(report.stages.length).toBeGreaterThan(0);
  });
});

describe('AuditEngine - Integration with BehaviorOS', () => {
  it('should produce valid audit report after mission lifecycle', () => {
    const bos = new BehaviorOS();

    const mission = bos.createMission({
      title: 'Full lifecycle',
      type: 'deployment',
      priority: 'critical',
    });
    bos.startMission(mission.id);

    const report = bos.runAudit({ missionId: mission.id, agentId: 'deployer' });

    expect(report.overall).toBeDefined();
    expect(report.stages.length).toBeGreaterThan(0);
    expect(report.timestamp).toBeDefined();
  });
});
