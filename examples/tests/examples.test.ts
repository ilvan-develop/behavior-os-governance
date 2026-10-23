import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../../packages/core/src/engine/behavior-os';

describe('Examples - Real World Usage', () => {
  it('should demonstrate healthcare workflow', async () => {
    const bos = new BehaviorOS();
    const dna: DNA = {
      name: 'Healthcare',
      version: '2.0.0',
      description: 'HIPAA compliant healthcare',
      personas: [
        { role: 'doctor', name: 'Dr. Smith', authority: 'admin', skills: ['patient-care'] },
        { role: 'nurse', name: 'Nurse Johnson', authority: 'operator', skills: ['patient-care'] },
      ],
      governance: [
        {
          id: 'patient-data-access',
          level: 'critical',
          action: 'block',
          conditions: [
            { type: 'patient_data', value: true },
            { type: 'authorized', value: false },
          ],
          description: 'Block unauthorized patient data access',
        },
      ],
      quality: [{ id: 'q1', type: 'test_coverage', threshold: 90 }],
    };

    await bos.loadDNA(dna);

    // Doctor with authorization - allowed
    const doctorAccess = bos.evaluateGovernance('view_patient_records', {
      agent: 'doctor',
      context: { patient_data: true, authorized: true },
    });
    expect(doctorAccess.verdict).toBe('allow');

    // Nurse without authorization - blocked
    const nurseAccess = bos.evaluateGovernance('view_patient_records', {
      agent: 'nurse',
      context: { patient_data: true, authorized: false },
    });
    expect(nurseAccess.verdict).toBe('deny');

    // Create patient record mission
    const mission = bos.createMission({
      title: 'Update patient records',
      type: 'feature',
      priority: 'high',
    });
    expect(mission.type).toBe('feature');
  });

  it('should demonstrate financial workflow', async () => {
    const bos = new BehaviorOS();
    const dna: DNA = {
      name: 'Financial Services',
      version: '2.0.0',
      description: 'SOX compliant financial system',
      personas: [
        { role: 'cfo', name: 'CFO', authority: 'executive', skills: ['finance'] },
        { role: 'auditor', name: 'Auditor', authority: 'compliance', skills: ['audit'] },
      ],
      governance: [
        {
          id: 'large-transaction',
          level: 'critical',
          action: 'escalate',
          conditions: [
            { type: 'transaction_amount', value: 10000 },
            { type: 'currency', value: 'USD' },
          ],
          description: 'Escalate transactions over $10k',
        },
      ],
      quality: [{ id: 'q1', type: 'test_coverage', threshold: 85 }],
    };

    await bos.loadDNA(dna);

    // Small transaction - allow
    const smallTx = bos.evaluateGovernance('process_payment', {
      agent: 'accountant',
      context: { transaction_amount: 500, currency: 'USD' },
    });
    expect(smallTx.verdict).toBe('allow');

    // Large transaction - escalate
    const largeTx = bos.evaluateGovernance('process_payment', {
      agent: 'accountant',
      context: { transaction_amount: 15000, currency: 'USD' },
    });
    expect(largeTx.verdict).toBe('escalate');

    // Record audit event
    const learning = bos.recordLearning({
      type: 'pattern',
      source: 'financial-system',
      content: 'Large transaction flagged for review',
      impact: 'high',
    });
    expect(learning.impact).toBe('high');
  });

  it('should demonstrate devops workflow', async () => {
    const bos = new BehaviorOS();
    const dna: DNA = {
      name: 'DevOps Pipeline',
      version: '2.0.0',
      description: 'CI/CD governance',
      personas: [{ role: 'developer', name: 'Dev', authority: 'developer', skills: ['coding'] }],
      governance: [
        {
          id: 'code-review',
          level: 'high',
          action: 'block',
          conditions: [
            { type: 'deploy_production', value: true },
            { type: 'code_review_approved', value: false },
          ],
          description: 'Require code review for production',
        },
      ],
      quality: [
        { id: 'lint', type: 'lint', threshold: 0 },
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
      ],
    };

    await bos.loadDNA(dna);

    // Deploy without review - blocked
    const noReview = bos.evaluateGovernance('deploy_to_prod', {
      agent: 'ci-bot',
      context: { deploy_production: true, code_review_approved: false },
    });
    expect(noReview.verdict).toBe('deny');

    // Deploy with review - allowed
    const withReview = bos.evaluateGovernance('deploy_to_prod', {
      agent: 'ci-bot',
      context: { deploy_production: true, code_review_approved: true },
    });
    expect(withReview.verdict).toBe('allow');

    // Run audit
    const mission = bos.createMission({
      title: 'Deploy v2.0',
      type: 'deployment',
      priority: 'critical',
    });
    const report = await bos.runAudit({ missionId: mission.id, agentId: 'ci-bot' });
    expect(report.overall).toBeDefined();
  });

  it('should demonstrate blockchain workflow', async () => {
    const bos = new BehaviorOS();
    const dna: DNA = {
      name: 'Blockchain Governance',
      version: '2.0.0',
      description: 'Smart contract safety',
      personas: [
        {
          role: 'developer',
          name: 'Smart Contract Dev',
          authority: 'technical',
          skills: ['solidity'],
        },
        { role: 'auditor', name: 'Security Team', authority: 'compliance', skills: ['audit'] },
      ],
      governance: [
        {
          id: 'contract-audit',
          level: 'critical',
          action: 'block',
          conditions: [
            { type: 'deploy_contract', value: true },
            { type: 'audit_completed', value: false },
          ],
          description: 'Require audit before deployment',
        },
      ],
      quality: [{ id: 'coverage', type: 'test_coverage', threshold: 95 }],
    };

    await bos.loadDNA(dna);

    // Deploy un-audited contract - blocked
    const unAudited = bos.evaluateGovernance('deploy_contract', {
      agent: 'developer',
      context: { deploy_contract: true, audit_completed: false },
    });
    expect(unAudited.verdict).toBe('deny');

    // Deploy audited contract - allowed
    const audited = bos.evaluateGovernance('deploy_contract', {
      agent: 'developer',
      context: { deploy_contract: true, audit_completed: true },
    });
    expect(audited.verdict).toBe('allow');
  });
});
