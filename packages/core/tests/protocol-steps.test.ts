import type { DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';

const testDna: DNA = {
  name: 'Protocol DNA',
  version: '1.0.0',
  description: 'Step progression test DNA',
  personas: [],
  governance: [],
  quality: [],
};

describe('BehaviorOS protocol step progression', () => {
  let bos: BehaviorOS;

  beforeEach(() => {
    bos = new BehaviorOS();
  });

  it('starts at step 0 with empty history', () => {
    const state = bos.getState();
    expect(state.currentStep).toBe(0);
    expect(state.stepHistory).toHaveLength(0);
  });

  it('ignores tools that are not part of the protocol', async () => {
    await bos.loadDNA(testDna);
    bos.advanceProtocolStep('bos_complete_mission');
    bos.advanceProtocolStep('bos_evaluate_governance');
    expect(bos.getState().currentStep).toBe(1);
    expect(bos.getState().stepHistory).toHaveLength(1);
  });

  it('requires an active DNA before advancing past selection', () => {
    bos.advanceProtocolStep('bos_list_dna');
    bos.advanceProtocolStep('bos_create_mission');
    bos.advanceProtocolStep('bos_run_audit');
    expect(bos.getState().currentStep).toBe(0);
    expect(bos.getState().stepHistory).toHaveLength(0);
  });

  it('walks the full 7-step protocol in order', async () => {
    await bos.loadDNA(testDna); // completes step 1
    expect(bos.getState().currentStep).toBe(1);

    bos.advanceProtocolStep('bos_list_dna'); // step 2
    expect(bos.getState().currentStep).toBe(2);

    bos.advanceProtocolStep('bos_get_state'); // step 3
    expect(bos.getState().currentStep).toBe(3);

    const mission = bos.createMission({ title: 't', type: 'feature', priority: 'high' }); // step 4
    expect(bos.getState().currentStep).toBe(4);
    expect(mission.dnaPattern).toBe('Protocol DNA');

    const started = bos.startMission(mission.id); // step 5
    expect(started).not.toBeNull();
    expect(bos.getState().currentStep).toBe(5);

    bos.runAudit({ missionId: mission.id, agentId: 'agent-1' }); // step 6
    expect(bos.getState().currentStep).toBe(6);

    bos.recordLearning({
      type: 'insight',
      source: 'protocol-test',
      content: 'full walk-through',
      impact: 'low',
    }); // step 7
    expect(bos.getState().currentStep).toBe(7);

    const history = bos.getState().stepHistory;
    expect(history).toHaveLength(7);
    expect(history[0]).toMatchObject({ step: 1, tool: 'bos_select_dna' });
    expect(history[1]).toMatchObject({ step: 2, tool: 'bos_list_dna' });
    expect(history[2]).toMatchObject({ step: 3, tool: 'bos_get_state' });
    expect(history[3]).toMatchObject({ step: 4, tool: 'bos_create_mission' });
    expect(history[4]).toMatchObject({ step: 5, tool: 'bos_start_mission' });
    expect(history[5]).toMatchObject({ step: 6, tool: 'bos_run_audit' });
    expect(history[6]).toMatchObject({ step: 7, tool: 'bos_record_learning' });
  });

  it('is monotonic: later steps never rewind the protocol', async () => {
    await bos.loadDNA(testDna);
    bos.advanceProtocolStep('bos_list_dna');
    // Calling earlier steps again must not move the pointer back.
    bos.advanceProtocolStep('bos_select_dna');
    expect(bos.getState().currentStep).toBe(2);

    // Skipping ahead is allowed and lands on the explicit target.
    bos.advanceProtocolStep('bos_get_state');
    const mission = bos.createMission({ title: 't', type: 'bugfix', priority: 'medium' });
    bos.advanceProtocolStep('bos_list_dna');
    expect(bos.getState().currentStep).toBe(4);

    // The history only records steps the agent actually completed.
    const steps = bos.getState().stepHistory.map((entry) => entry.step);
    expect(steps).toEqual([1, 2, 3, 4]);
    expect(mission).toBeDefined();
  });

  it('caps at the final step and idles once complete', async () => {
    await bos.loadDNA(testDna);
    const mission = bos.createMission({ title: 't', type: 'deployment', priority: 'critical' });
    bos.startMission(mission.id);
    bos.runAudit({ missionId: mission.id, agentId: 'agent-1' });
    bos.recordLearning({ type: 'fix', source: 'protocol-test', content: 'done', impact: 'high' });

    expect(bos.getState().currentStep).toBe(7);

    const historyLength = bos.getState().stepHistory.length;
    bos.recordLearning({ type: 'fix', source: 'protocol-test', content: 'again', impact: 'high' });
    bos.advanceProtocolStep('bos_run_audit');
    expect(bos.getState().currentStep).toBe(7);
    expect(bos.getState().stepHistory).toHaveLength(historyLength);
  });

  it('does not advance when starting an unknown mission', async () => {
    await bos.loadDNA(testDna);
    expect(bos.startMission('missing-mission')).toBeNull();
    expect(bos.getState().currentStep).toBe(1);
  });
});
