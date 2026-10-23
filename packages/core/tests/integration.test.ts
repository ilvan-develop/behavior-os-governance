import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

describe('BehaviorOS Integration', () => {
  it('should complete full governance flow', async () => {
    const bos = new BehaviorOS();

    // Step 1: Load DNA
    const dna: DNA = {
      name: 'Surgical Team',
      version: '2.0.0',
      description: 'Zero-defect governance',
      personas: [
        {
          role: 'architect',
          name: 'Lead Surgeon',
          authority: 'architect',
          skills: ['surgical-procedure', 'team-leadership'],
        },
      ],
      governance: [
        {
          id: 'sterile-field',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'production', value: true }],
          description: 'Block unapproved production changes',
        },
      ],
      quality: [{ id: 'zero-defect', type: 'test_coverage', threshold: 100 }],
    };

    await bos.loadDNA(dna);
    expect(bos.getDNA()?.name).toBe('Surgical Team');

    // Step 2: Evaluate governance
    const decision = bos.evaluateGovernance('deploy-production', {
      agent: 'devops-agent',
      context: { production: true },
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.reason).toContain('sterile-field');

    // Step 3: Create mission
    const mission = bos.createMission({
      title: 'Fix deployment pipeline',
      type: 'bugfix',
      priority: 'critical',
    });
    expect(mission.status).toBe('pending');

    // Step 4: Start mission
    const started = bos.startMission(mission.id);
    expect(started?.status).toBe('active');

    // Step 5: Run audit
    const report = await bos.runAudit({
      missionId: mission.id,
      agentId: 'devops-agent',
    });
    expect(report.overall).toBe('warning');
    expect(report.simulated).toBe(true);

    // Step 6: Record learning
    const event = bos.recordLearning({
      type: 'insight',
      source: 'post-mortem',
      content: 'Deployment blocked by sterile field rule',
      impact: 'high',
      relatedMission: mission.id,
    });
    expect(event.content).toBe('Deployment blocked by sterile field rule');

    // Step 7: Get insights
    const insights = bos.getInsights(10);
    expect(insights.length).toBeGreaterThan(0);

    // Verify final state
    const status = bos.getStatus();
    expect(status.engine).toBe(true);
    expect(status.dna).toBe('Surgical Team');
    expect(status.missions).toBe(1);
  });

  it('should handle quality gate failures', async () => {
    const bos = new BehaviorOS();

    await bos.loadDNA({
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [
        { id: 'coverage', type: 'test_coverage', threshold: 90 },
        { id: 'lint', type: 'lint', threshold: 0 },
      ],
    });

    const result = bos.checkQuality({
      test_coverage: 50,
      lint_errors: 5,
    });

    expect(result.passed).toBe(false);
  });

  it('should persist protocol state', async () => {
    const bos = new BehaviorOS();

    bos.updateState({
      currentStep: 3,
      selectedDna: 'surgical-team',
      activeMission: 'mission-123',
    });

    const state = bos.getState();
    expect(state.currentStep).toBe(3);
    expect(state.selectedDna).toBe('surgical-team');
    expect(state.activeMission).toBe('mission-123');
  });

  it('should track agent metrics', async () => {
    const bos = new BehaviorOS();

    // Create multiple missions
    bos.createMission({ title: 'M1', type: 'feature', priority: 'high' });
    bos.createMission({ title: 'M2', type: 'bugfix', priority: 'critical' });
    bos.createMission({ title: 'M3', type: 'deployment', priority: 'high' });

    const status = bos.getStatus();
    expect(status.missions).toBe(3);
  });
});
