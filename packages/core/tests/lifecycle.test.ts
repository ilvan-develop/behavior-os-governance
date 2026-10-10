import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

describe('BehaviorOS Full Integration', () => {
  it('should handle complete lifecycle', async () => {
    const bos = new BehaviorOS();

    // Initialize with DNA
    await bos.loadDNA({
      name: 'Complete Test',
      version: '1.0.0',
      description: 'Full lifecycle test',
      personas: [],
      governance: [],
      quality: [],
    });

    // Create and manage mission
    const mission = bos.createMission({
      title: 'Full Lifecycle',
      type: 'feature',
      priority: 'high',
    });
    expect(mission.status).toBe('pending');

    // Start mission
    const started = bos.startMission(mission.id);
    expect(started?.status).toBe('active');

    // Evaluate governance during mission
    const decision = bos.evaluateGovernance('task', {
      agent: 'test-agent',
      context: {},
    });
    expect(decision.action).toBe('task');

    // Run audit
    const audit = bos.runAudit({
      missionId: mission.id,
      agentId: 'test-agent',
    });
    expect(audit.overall).toBe('pass');

    // Record learning
    const learning = bos.recordLearning({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'high',
    });
    expect(learning.type).toBe('insight');

    // Complete mission
    const completed = bos.completeMission(mission.id);
    expect(completed?.status).toBe('completed');

    // Verify final state
    const status = bos.getStatus();
    expect(status.engine).toBe(true);
    expect(status.dna).toBe('Complete Test');
  });

  it('should persist state across operations', () => {
    const bos = new BehaviorOS();

    // Set up state
    bos.updateState({
      currentStep: 5,
      selectedDna: 'surgical-team',
      activeMission: 'mission-abc',
    });

    // Verify persistence
    const state = bos.getState();
    expect(state.currentStep).toBe(5);
    expect(state.selectedDna).toBe('surgical-team');
    expect(state.activeMission).toBe('mission-abc');
  });

  it('should handle error cases gracefully', () => {
    const bos = new BehaviorOS();

    // Create a mission first so the engine is initialized
    bos.createMission({ title: 'Test', type: 'feature', priority: 'high' });

    // Non-existent mission
    const result = bos.failMission('non-existent', 'Test error');
    expect(result).toBeNull();

    // Invalid operation sequence
    const alreadyPending = bos.completeMission('non-existent');
    expect(alreadyPending).toBeNull();
  });
});
