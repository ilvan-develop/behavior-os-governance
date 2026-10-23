// BehaviorOS v2.0 - Example Usage

import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';

async function main() {
  console.log('🚀 BehaviorOS v2.0 - Example Application\n');

  // Initialize BehaviorOS
  const bos = new BehaviorOS();

  // Load DNA pattern
  const dna: DNA = {
    name: 'Surgical Team',
    version: '2.0.0',
    description: 'Zero-defect governance for critical systems',
    personas: [
      {
        role: 'surgeon',
        name: 'Lead Surgeon',
        authority: 'architect',
        skills: ['surgery', 'diagnosis'],
      },
      {
        role: 'anesthesiologist',
        name: 'Anesthesia Specialist',
        authority: 'operator',
        skills: ['anesthesia'],
      },
    ],
    governance: [
      {
        id: 'sterile-field',
        level: 'critical',
        action: 'block',
        conditions: [
          { type: 'surgery_start', value: true },
          { type: 'sterile_field_established', value: false },
        ],
        description: 'Block surgery if sterile field not established',
      },
      {
        id: 'medication-check',
        level: 'high',
        action: 'escalate',
        conditions: [
          { type: 'medication_administer', value: true },
          { type: 'dosage_verified', value: false },
        ],
        description: 'Escalate if dosage not verified',
      },
    ],
    quality: [
      { id: 'q1', type: 'test_coverage', threshold: 99 },
      { id: 'q2', type: 'lint', threshold: 0 },
    ],
  };

  console.log('📋 Loading DNA:', dna.name);
  await bos.loadDNA(dna);

  // Evaluate governance
  console.log('\n🔒 Evaluating governance...');

  const surgeryDecision = bos.evaluateGovernance('start_surgery', {
    agent: 'surgeon',
    context: { surgery_start: true, sterile_field_established: true },
  });
  console.log('  Surgery decision:', surgeryDecision.verdict);

  const medicationDecision = bos.evaluateGovernance('administer_medication', {
    agent: 'nurse',
    context: { medication_administer: true, dosage_verified: false },
  });
  console.log('  Medication decision:', medicationDecision.verdict);

  // Create mission
  console.log('\n📝 Creating mission...');
  const mission = bos.createMission({
    title: 'Emergency Surgery',
    type: 'incident',
    priority: 'critical',
  });
  console.log('  Mission created:', mission.id);

  // Start mission
  bos.startMission(mission.id);
  console.log('  Mission started');

  // Run audit
  console.log('\n🔍 Running audit...');
  const report = await bos.runAudit({ missionId: mission.id, agentId: 'system' });
  console.log('  Audit overall:', report.overall);
  console.log('  Stages:', report.stages.length);

  // Record learning
  console.log('\n🧠 Recording learning...');
  const learning = bos.recordLearning({
    type: 'insight',
    source: 'surgery',
    content: 'Critical governance rule prevented unsafe surgery',
    impact: 'high',
    relatedMission: mission.id,
  });
  console.log('  Learning recorded:', learning.id);

  // Get state
  console.log('\n📊 System state:');
  const state = bos.getState();
  console.log('  Current step:', state.currentStep);
  console.log('  Selected DNA:', state.selectedDna);

  // Agent metrics (aggregated across registered agents)
  const agents = bos.listAgents();
  const tasksCompleted = agents.reduce((sum, agent) => sum + agent.metrics.tasksCompleted, 0);
  const governanceViolations = agents.reduce(
    (sum, agent) => sum + agent.metrics.governanceViolations,
    0,
  );
  console.log('\n📈 Agent metrics:');
  console.log('  Agents registered:', agents.length);
  console.log('  Tasks completed:', tasksCompleted);
  console.log('  Governance violations:', governanceViolations);

  console.log('\n✅ Example completed successfully!');
}

main().catch(console.error);
