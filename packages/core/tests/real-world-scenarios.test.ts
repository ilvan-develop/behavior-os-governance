import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os';

describe('Real-World Scenarios', () => {
  describe('Healthcare (HIPAA Compliance)', () => {
    it('should block unauthorized patient data access', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Healthcare HIPAA',
        version: '2.0.0',
        description: 'Healthcare compliance',
        personas: [
          { role: 'doctor', name: 'Dr. Smith', authority: 'admin', skills: ['patient-care'] },
        ],
        governance: [
          {
            id: 'hipaa-access',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'patient_data_access', value: true },
              { type: 'authorization', value: false },
            ],
            description: 'Block unauthorized patient data access',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Unauthorized access should be blocked
      const decision = bos.evaluateGovernance('access_patient_data', {
        agent: 'nurse',
        context: { patient_data_access: true, authorization: false },
      });
      expect(decision.verdict).toBe('deny');
      expect(decision.rulesEvaluated).toContain('hipaa-access');

      // Authorized access should be allowed
      const authorizedDecision = bos.evaluateGovernance('access_patient_data', {
        agent: 'doctor',
        context: { patient_data_access: true, authorization: true },
      });
      expect(authorizedDecision.verdict).toBe('allow');
    });

    it('should enforce audit trail for patient records', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Healthcare Audit',
        version: '2.0.0',
        description: 'Audit requirements',
        personas: [],
        governance: [
          {
            id: 'audit-log',
            level: 'high',
            action: 'log',
            conditions: [{ type: 'patient_record_modification', value: true }],
            description: 'Log all patient record modifications',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('modify_patient_record', {
        agent: 'admin',
        context: { patient_record_modification: true },
      });

      expect(decision.verdict).toBe('allow');
      expect(decision.rulesEvaluated).toContain('audit-log');

      // Record learning event
      const learning = bos.recordLearning({
        type: 'insight',
        source: 'healthcare-audit',
        content: 'Patient record modified by admin',
        impact: 'high',
      });
      expect(learning.type).toBe('insight');
    });
  });

  describe('Financial Services (SOX Compliance)', () => {
    it('should require dual approval for financial transactions', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Financial SOX',
        version: '2.0.0',
        description: 'Financial compliance',
        personas: [
          { role: 'controller', name: 'CFO', authority: 'executive', skills: ['finance'] },
          { role: 'auditor', name: 'Auditor', authority: 'compliance', skills: ['audit'] },
        ],
        governance: [
          {
            id: 'dual-approval',
            level: 'critical',
            action: 'escalate',
            conditions: [
              { type: 'transaction_above_threshold', value: true },
              { type: 'currency', value: 'USD' },
            ],
            description: 'Transactions over $10k require dual approval',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 85 }],
      };

      await bos.loadDNA(dna);

      // Small transaction - allow
      const smallTx = bos.evaluateGovernance('process_transaction', {
        agent: 'accountant',
        context: { transaction_above_threshold: false, currency: 'USD' },
      });
      expect(smallTx.verdict).toBe('allow');

      // Large transaction - escalate
      const largeTx = bos.evaluateGovernance('process_transaction', {
        agent: 'accountant',
        context: { transaction_above_threshold: true, currency: 'USD' },
      });
      expect(largeTx.verdict).toBe('escalate');
    });

    it('should track all financial audit events', async () => {
      const bos = new BehaviorOS();
      const mission = bos.createMission({
        title: 'Financial Audit Q4',
        type: 'audit',
        priority: 'critical',
      });

      const report = await bos.runAudit({ missionId: mission.id, agentId: 'auditor-1' });
      expect(report.overall).toBeDefined();
      expect(report.stages.length).toBeGreaterThanOrEqual(4);

      const learning = bos.recordLearning({
        type: 'pattern',
        source: 'financial-audit',
        content: 'Quarterly audit completed with zero findings',
        impact: 'medium',
        relatedMission: mission.id,
      });
      expect(learning.relatedMission).toBe(mission.id);
    });
  });

  describe('DevOps Pipeline', () => {
    it('should enforce code review before deployment', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'DevOps Pipeline',
        version: '2.0.0',
        description: 'CI/CD governance',
        personas: [{ role: 'developer', name: 'Dev', authority: 'developer', skills: ['coding'] }],
        governance: [
          {
            id: 'code-review-required',
            level: 'high',
            action: 'block',
            conditions: [
              { type: 'deploy_to_production', value: true },
              { type: 'code_review_approved', value: false },
            ],
            description: 'Production deployment requires code review',
          },
        ],
        quality: [{ id: 'lint', type: 'lint', threshold: 0 }],
      };

      await bos.loadDNA(dna);

      // Deploy without review - blocked
      const noReview = bos.evaluateGovernance('deploy_to_production', {
        agent: 'ci-bot',
        context: { deploy_to_production: true, code_review_approved: false },
      });
      expect(noReview.verdict).toBe('deny');

      // Deploy with review - allowed
      const withReview = bos.evaluateGovernance('deploy_to_production', {
        agent: 'ci-bot',
        context: { deploy_to_production: true, code_review_approved: true },
      });
      expect(withReview.verdict).toBe('allow');
    });
  });

  describe('Startup Agile', () => {
    it('should allow rapid iteration with lightweight governance', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Startup Agile',
        version: '2.0.0',
        description: 'Fast-paced development',
        personas: [{ role: 'founder', name: 'CEO', authority: 'owner', skills: ['strategy'] }],
        governance: [
          {
            id: 'security-check',
            level: 'medium',
            action: 'warn',
            conditions: [
              { type: 'production_deploy', value: true },
              { type: 'security_scan', value: false },
            ],
            description: 'Warn when deploying without security scan',
          },
        ],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 60 }],
      };

      await bos.loadDNA(dna);

      // Deploy without security scan - warn but allow
      const decision = bos.evaluateGovernance('production_deploy', {
        agent: 'developer',
        context: { production_deploy: true, security_scan: false },
      });
      expect(decision.verdict).toBe('allow');
      expect(decision.reason).toContain('Warning');
    });

    it('should support fast mission cycles', async () => {
      const bos = new BehaviorOS();
      const iterations = 20;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const mission = bos.createMission({
          title: `Feature ${i}`,
          type: 'feature',
          priority: 'high',
        });
        bos.startMission(mission.id);
        bos.completeMission(mission.id);
      }
      const duration = performance.now() - start;

      const missions = bos.listMissions();
      expect(missions).toHaveLength(iterations);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Blockchain/Web3', () => {
    it('should enforce smart contract audit requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Blockchain Governance',
        version: '2.0.0',
        description: 'Smart contract safety',
        personas: [
          { role: 'auditor', name: 'Security Team', authority: 'compliance', skills: ['audit'] },
        ],
        governance: [
          {
            id: 'contract-audit',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'deploy_smart_contract', value: true },
              { type: 'audit_completed', value: false },
            ],
            description: 'Smart contracts must be audited before deployment',
          },
          {
            id: 'multi-sig',
            level: 'high',
            action: 'escalate',
            conditions: [
              { type: 'large_transaction', value: true },
              { type: 'currency', value: 'ETH' },
            ],
            description: 'Large ETH transactions require multi-sig',
          },
        ],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 95 }],
      };

      await bos.loadDNA(dna);

      // Deploy un-audited contract - blocked
      const unAudited = bos.evaluateGovernance('deploy_contract', {
        agent: 'developer',
        context: { deploy_smart_contract: true, audit_completed: false },
      });
      expect(unAudited.verdict).toBe('deny');

      // Deploy audited contract - allowed
      const audited = bos.evaluateGovernance('deploy_contract', {
        agent: 'developer',
        context: { deploy_smart_contract: true, audit_completed: true },
      });
      expect(audited.verdict).toBe('allow');

      // Large ETH transaction - escalate
      const largeTx = bos.evaluateGovernance('transfer_eth', {
        agent: 'treasurer',
        context: { large_transaction: true, currency: 'ETH' },
      });
      expect(largeTx.verdict).toBe('escalate');
    });
  });

  describe('IoT/Embedded Systems', () => {
    it('should enforce safety certifications', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'IoT Safety',
        version: '2.0.0',
        description: 'Embedded system safety',
        personas: [
          { role: 'engineer', name: 'Firmware Dev', authority: 'technical', skills: ['embedded'] },
        ],
        governance: [
          {
            id: 'safety-cert',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'firmware_update', value: true },
              { type: 'safety_certified', value: false },
            ],
            description: 'Firmware must be safety certified',
          },
        ],
        quality: [{ id: 'coverage', type: 'test_coverage', threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Deploy un-certified firmware - blocked
      const unsafe = bos.evaluateGovernance('firmware_update', {
        agent: 'engineer',
        context: { firmware_update: true, safety_certified: false },
      });
      expect(unsafe.verdict).toBe('deny');
    });
  });

  describe('AI/ML Pipeline', () => {
    it('should enforce model validation requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'AI/ML Governance',
        version: '2.0.0',
        description: 'ML pipeline safety',
        personas: [
          { role: 'data_scientist', name: 'ML Engineer', authority: 'technical', skills: ['ml'] },
        ],
        governance: [
          {
            id: 'model-validation',
            level: 'high',
            action: 'block',
            conditions: [
              { type: 'deploy_model', value: true },
              { type: 'model_validated', value: false },
            ],
            description: 'Model must be validated before deployment',
          },
          {
            id: 'bias-audit',
            level: 'critical',
            action: 'escalate',
            conditions: [
              { type: 'model_decision', value: true },
              { type: 'bias_checked', value: false },
            ],
            description: 'Bias audit required for production models',
          },
        ],
        quality: [{ id: 'performance', type: 'test_coverage', threshold: 85 }],
      };

      await bos.loadDNA(dna);

      // Deploy unvalidated model - blocked
      const unvalidated = bos.evaluateGovernance('deploy_model', {
        agent: 'ml-engineer',
        context: { deploy_model: true, model_validated: false },
      });
      expect(unvalidated.verdict).toBe('deny');

      // Deploy without bias check - escalate
      const noBiasCheck = bos.evaluateGovernance('model_decision', {
        agent: 'ml-engineer',
        context: { model_decision: true, bias_checked: false },
      });
      expect(noBiasCheck.verdict).toBe('escalate');
    });
  });

  describe('Gaming Studio', () => {
    it('should enforce content review for game releases', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Gaming Studio',
        version: '2.0.0',
        description: 'Game development governance',
        personas: [
          {
            role: 'game_director',
            name: 'Creative Lead',
            authority: 'creative',
            skills: ['game-design'],
          },
        ],
        governance: [
          {
            id: 'content-review',
            level: 'high',
            action: 'block',
            conditions: [
              { type: 'game_release', value: true },
              { type: 'content_review', value: false },
            ],
            description: 'Game content must be reviewed before release',
          },
        ],
        quality: [{ id: 'performance', type: 'test_coverage', threshold: 70 }],
      };

      await bos.loadDNA(dna);

      // Release without content review - blocked
      const unreviewed = bos.evaluateGovernance('game_release', {
        agent: 'producer',
        context: { game_release: true, content_review: false },
      });
      expect(unreviewed.verdict).toBe('deny');
    });
  });

  // ==========================================
  // NEW: Enterprise Governance
  // ==========================================
  describe('Enterprise Governance (SOX)', () => {
    it('should enforce change management controls', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Enterprise Governance',
        version: '2.0.0',
        description: 'Enterprise compliance',
        personas: [
          {
            role: 'manager',
            name: 'Ops Manager',
            authority: 'manager',
            skills: ['change-management'],
          },
        ],
        governance: [
          {
            id: 'change-management',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'production_change', value: true },
              { type: 'approval_granted', value: false },
            ],
            description: 'Production changes require approval',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 80 }],
      };

      await bos.loadDNA(dna);

      // Unapproved production change - blocked
      const unapproved = bos.evaluateGovernance('production_change', {
        agent: 'operator',
        context: { production_change: true, approval_granted: false },
      });
      expect(unapproved.verdict).toBe('deny');
      expect(unapproved.rulesEvaluated).toContain('change-management');

      // Approved change - allowed
      const approved = bos.evaluateGovernance('production_change', {
        agent: 'operator',
        context: { production_change: true, approval_granted: true },
      });
      expect(approved.verdict).toBe('allow');
    });

    it('should escalate unauthorized data access', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Enterprise Governance',
        version: '2.0.0',
        description: 'Enterprise compliance',
        personas: [
          {
            role: 'security',
            name: 'Sec Officer',
            authority: 'security',
            skills: ['data-protection'],
          },
        ],
        governance: [
          {
            id: 'data-protection',
            level: 'high',
            action: 'escalate',
            conditions: [
              { type: 'unauthorized_access', value: true },
              { type: 'sensitivity', value: 'confidential' },
            ],
            description: 'Escalate unauthorized confidential access',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('access_sensitive_data', {
        agent: 'intern',
        context: { unauthorized_access: true, sensitivity: 'confidential' },
      });
      expect(decision.verdict).toBe('escalate');
      expect(decision.rulesEvaluated).toContain('data-protection');
    });
  });

  // ==========================================
  // NEW: Financial Compliance (KYC/AML)
  // ==========================================
  describe('Financial Compliance (KYC/AML)', () => {
    it('should block transactions without KYC verification', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Financial Compliance',
        version: '2.0.0',
        description: 'KYC/AML compliance',
        personas: [
          {
            role: 'compliance-officer',
            name: 'Compliance Officer',
            authority: 'compliance',
            skills: ['kyc'],
          },
        ],
        governance: [
          {
            id: 'kyc-required',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'transaction_initiated', value: true },
              { type: 'kyc_verified', value: false },
            ],
            description: 'Transactions require KYC verification',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Transaction without KYC - blocked
      const noKyc = bos.evaluateGovernance('transaction_initiated', {
        agent: 'customer',
        context: { transaction_initiated: true, kyc_verified: false },
      });
      expect(noKyc.verdict).toBe('deny');
      expect(noKyc.rulesEvaluated).toContain('kyc-required');

      // Transaction with KYC - allowed
      const withKyc = bos.evaluateGovernance('transaction_initiated', {
        agent: 'customer',
        context: { transaction_initiated: true, kyc_verified: true },
      });
      expect(withKyc.verdict).toBe('allow');
    });

    it('should monitor large financial transactions', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Financial Compliance',
        version: '2.0.0',
        description: 'KYC/AML compliance',
        personas: [
          {
            role: 'analyst',
            name: 'Risk Analyst',
            authority: 'compliance',
            skills: ['monitoring'],
          },
        ],
        governance: [
          {
            id: 'large-transaction',
            level: 'high',
            action: 'escalate',
            conditions: [
              { type: 'transaction_above_threshold', value: true },
              { type: 'currency', value: 'USD' },
            ],
            description: 'Transactions over $10k require monitoring',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('transaction_above_threshold', {
        agent: 'analyst',
        context: { transaction_above_threshold: true, currency: 'USD' },
      });
      expect(decision.verdict).toBe('escalate');
      expect(decision.rulesEvaluated).toContain('large-transaction');
    });
  });

  // ==========================================
  // NEW: Lean Factory
  // ==========================================
  describe('Lean Factory (Kaizen)', () => {
    it('should enforce waste reduction procedures', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Lean Factory',
        version: '2.0.0',
        description: 'Kaizen compliance',
        personas: [
          { role: 'manager', name: 'Process Manager', authority: 'manager', skills: ['kaizen'] },
        ],
        governance: [
          {
            id: 'waste-reduction',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'process_optimization', value: true },
              { type: 'waste_identified', value: false },
            ],
            description: 'Process optimization requires waste identification',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 85 }],
      };

      await bos.loadDNA(dna);

      // Optimization without waste identification - blocked
      const noWaste = bos.evaluateGovernance('process_optimization', {
        agent: 'manager',
        context: { process_optimization: true, waste_identified: false },
      });
      expect(noWaste.verdict).toBe('deny');
      expect(noWaste.rulesEvaluated).toContain('waste-reduction');

      // Optimization with waste identification - allowed
      const withWaste = bos.evaluateGovernance('process_optimization', {
        agent: 'manager',
        context: { process_optimization: true, waste_identified: true },
      });
      expect(withWaste.verdict).toBe('allow');
    });

    it('should support continuous improvement cycles', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Lean Factory CI',
        version: '2.0.0',
        description: 'Kaizen continuous improvement',
        personas: [
          { role: 'manager', name: 'Process Manager', authority: 'manager', skills: ['kaizen'] },
        ],
        governance: [
          {
            id: 'waste-reduction',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'process_optimization', value: true },
              { type: 'waste_identified', value: false },
            ],
            description: 'Process optimization requires waste identification',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 85 }],
      };

      await bos.loadDNA(dna);

      const iterations = 10;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const decision = bos.evaluateGovernance('process_optimization', {
          agent: 'manager',
          context: { process_optimization: true, waste_identified: true },
        });
        expect(decision.verdict).toBe('allow');
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(2000);
    });
  });

  // ==========================================
  // NEW: Military Operations
  // ==========================================
  describe('Military Operations', () => {
    it('should enforce chain of command for orders', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Military Operations',
        version: '2.0.0',
        description: 'Chain of command compliance',
        personas: [
          {
            role: 'commander',
            name: 'Commander',
            authority: 'commander',
            skills: ['military-strategy'],
          },
          { role: 'officer', name: 'Officer', authority: 'officer', skills: ['tactics'] },
        ],
        governance: [
          {
            id: 'chain-of-command',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'direct_order', value: true },
              { type: 'proper_channel', value: false },
            ],
            description: 'Orders must go through proper chain of command',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Direct order without proper chain - blocked
      const badOrder = bos.evaluateGovernance('direct_order', {
        agent: 'soldier',
        context: { direct_order: true, proper_channel: false },
      });
      expect(badOrder.verdict).toBe('deny');
      expect(badOrder.rulesEvaluated).toContain('chain-of-command');

      // Order through proper chain - allowed
      const goodOrder = bos.evaluateGovernance('direct_order', {
        agent: 'soldier',
        context: { direct_order: true, proper_channel: true },
      });
      expect(goodOrder.verdict).toBe('allow');
    });

    it('should enforce OPSEC for sensitive information', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Military Operations',
        version: '2.0.0',
        description: 'OPSEC compliance',
        personas: [
          { role: 'operator', name: 'Special Ops', authority: 'operator', skills: ['opsec'] },
        ],
        governance: [
          {
            id: 'opsec-protocol',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'phi_disclosure', value: true },
              { type: 'authorized', value: false },
            ],
            description: 'PHI must not be disclosed without authorization',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('phi_disclosure', {
        agent: 'analyst',
        context: { phi_disclosure: true, authorized: false },
      });
      expect(decision.verdict).toBe('deny');
      expect(decision.rulesEvaluated).toContain('opsec-protocol');
    });
  });

  // ==========================================
  // NEW: Mobile App
  // ==========================================
  describe('Mobile App', () => {
    it('should enforce app store guidelines', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Mobile App',
        version: '2.0.0',
        description: 'App store compliance',
        personas: [
          {
            role: 'app-dev',
            name: 'App Developer',
            authority: 'developer',
            skills: ['mobile-dev'],
          },
        ],
        governance: [
          {
            id: 'app-store-compliance',
            level: 'high',
            action: 'block',
            conditions: [
              { type: 'app_submission', value: true },
              { type: 'guideline_compliant', value: false },
            ],
            description: 'App must comply with store guidelines',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 80 }],
      };

      await bos.loadDNA(dna);

      // Non-compliant app submission - blocked
      const nonCompliant = bos.evaluateGovernance('app_submission', {
        agent: 'developer',
        context: { app_submission: true, guideline_compliant: false },
      });
      expect(nonCompliant.verdict).toBe('deny');
      expect(nonCompliant.rulesEvaluated).toContain('app-store-compliance');

      // Compliant app submission - allowed
      const compliant = bos.evaluateGovernance('app_submission', {
        agent: 'developer',
        context: { app_submission: true, guideline_compliant: true },
      });
      expect(compliant.verdict).toBe('allow');
    });

    it('should enforce permission requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Mobile App',
        version: '2.0.0',
        description: 'App store compliance',
        personas: [
          {
            role: 'app-dev',
            name: 'App Developer',
            authority: 'developer',
            skills: ['mobile-dev'],
          },
        ],
        governance: [
          {
            id: 'permission-required',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'permission_request', value: true },
              { type: 'user_consent', value: false },
            ],
            description: 'Permission requests require user consent',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      // Permission without consent - blocked
      const noConsent = bos.evaluateGovernance('permission_request', {
        agent: 'developer',
        context: { permission_request: true, user_consent: false },
      });
      expect(noConsent.verdict).toBe('deny');
      expect(noConsent.rulesEvaluated).toContain('permission-required');

      // Permission with consent - allowed
      const withConsent = bos.evaluateGovernance('permission_request', {
        agent: 'developer',
        context: { permission_request: true, user_consent: true },
      });
      expect(withConsent.verdict).toBe('allow');
    });
  });

  // ==========================================
  // NEW: Open Source
  // ==========================================
  describe('Open Source', () => {
    it('should enforce DCO for contributions', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Open Source',
        version: '2.0.0',
        description: 'Open source compliance',
        personas: [
          {
            role: 'contributor',
            name: 'Contributor',
            authority: 'contributor',
            skills: ['coding'],
          },
        ],
        governance: [
          {
            id: 'dco-required',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'code_contribution', value: true },
              { type: 'dco_signed', value: false },
            ],
            description: 'Code contributions require DCO signature',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 70 }],
      };

      await bos.loadDNA(dna);

      // Contribution without DCO - blocked
      const noDco = bos.evaluateGovernance('code_contribution', {
        agent: 'contributor',
        context: { code_contribution: true, dco_signed: false },
      });
      expect(noDco.verdict).toBe('deny');
      expect(noDco.rulesEvaluated).toContain('dco-required');

      // Contribution with DCO - allowed
      const withDco = bos.evaluateGovernance('code_contribution', {
        agent: 'contributor',
        context: { code_contribution: true, dco_signed: true },
      });
      expect(withDco.verdict).toBe('allow');
    });

    it('should enforce license compliance', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Open Source',
        version: '2.0.0',
        description: 'Open source compliance',
        personas: [
          {
            role: 'maintainer',
            name: 'Project Maintainer',
            authority: 'maintainer',
            skills: ['maintenance'],
          },
        ],
        governance: [
          {
            id: 'license-compliance',
            level: 'high',
            action: 'escalate',
            conditions: [
              { type: 'license_violation', value: true },
              { type: 'project', value: 'open-source' },
            ],
            description: 'License violations must be escalated',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('license_violation', {
        agent: 'contributor',
        context: { license_violation: true, project: 'open-source' },
      });
      expect(decision.verdict).toBe('escalate');
      expect(decision.rulesEvaluated).toContain('license-compliance');
    });
  });

  // ==========================================
  // NEW: Quantum Computing
  // ==========================================
  describe('Quantum Computing', () => {
    it('should enforce qubit coherence requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Quantum Computing',
        version: '2.0.0',
        description: 'Quantum pipeline safety',
        personas: [
          {
            role: 'quantum-engineer',
            name: 'Q Engineer',
            authority: 'technical',
            skills: ['quantum'],
          },
        ],
        governance: [
          {
            id: 'coherence-required',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'deploy_quantum', value: true },
              { type: 'coherence_time', value: '< 1ms' },
            ],
            description: 'Quantum operations require minimum coherence time',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 95 }],
      };

      await bos.loadDNA(dna);

      // Deploy with insufficient coherence - blocked
      const lowCoherence = bos.evaluateGovernance('deploy_quantum', {
        agent: 'q-engineer',
        context: { deploy_quantum: true, coherence_time: '< 1ms' },
      });
      expect(lowCoherence.verdict).toBe('deny');
      expect(lowCoherence.rulesEvaluated).toContain('coherence-required');

      // Deploy with sufficient coherence - allowed
      const goodCoherence = bos.evaluateGovernance('deploy_quantum', {
        agent: 'q-engineer',
        context: { deploy_quantum: true, coherence_time: '>= 1ms' },
      });
      expect(goodCoherence.verdict).toBe('allow');
    });

    it('should enforce error correction requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Quantum Computing',
        version: '2.0.0',
        description: 'Quantum pipeline safety',
        personas: [
          {
            role: 'quantum-engineer',
            name: 'Q Engineer',
            authority: 'technical',
            skills: ['quantum'],
          },
        ],
        governance: [
          {
            id: 'error-correction',
            level: 'high',
            action: 'escalate',
            conditions: [
              { type: 'quantum_error_rate', value: '> 1%' },
              { type: 'code_distance', value: '< 5' },
            ],
            description: 'High error rate requires error correction',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('quantum_error_rate', {
        agent: 'q-engineer',
        context: { quantum_error_rate: '> 1%', code_distance: '< 5' },
      });
      expect(decision.verdict).toBe('escalate');
      expect(decision.rulesEvaluated).toContain('error-correction');
    });
  });

  // ==========================================
  // NEW: Research Lab
  // ==========================================
  describe('Research Lab', () => {
    it('should enforce reproducibility requirements', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Research Lab',
        version: '2.0.0',
        description: 'Research reproducibility',
        personas: [
          {
            role: 'researcher',
            name: 'Lead Researcher',
            authority: 'admin',
            skills: ['experimentation'],
          },
        ],
        governance: [
          {
            id: 'reproducibility',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'experiment_publish', value: true },
              { type: 'data_available', value: false },
            ],
            description: ' Experiments must have data available for reproducibility',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Publish without data - blocked
      const noData = bos.evaluateGovernance('experiment_publish', {
        agent: 'researcher',
        context: { experiment_publish: true, data_available: false },
      });
      expect(noData.verdict).toBe('deny');
      expect(noData.rulesEvaluated).toContain('reproducibility');

      // Publish with data - allowed
      const withData = bos.evaluateGovernance('experiment_publish', {
        agent: 'researcher',
        context: { experiment_publish: true, data_available: true },
      });
      expect(withData.verdict).toBe('allow');
    });

    it('should enforce ethics review', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Research Lab',
        version: '2.0.0',
        description: 'Research reproducibility',
        personas: [
          { role: 'ethicist', name: 'Ethics Reviewer', authority: 'admin', skills: ['ethics'] },
        ],
        governance: [
          {
            id: 'ethics-review',
            level: 'critical',
            action: 'block',
            conditions: [
              { type: 'human_subjects', value: true },
              { type: 'irb_approved', value: false },
            ],
            description: 'Human subjects research requires IRB approval',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      // Human subjects without IRB - blocked
      const noIRB = bos.evaluateGovernance('human_subjects', {
        agent: 'researcher',
        context: { human_subjects: true, irb_approved: false },
      });
      expect(noIRB.verdict).toBe('deny');
      expect(noIRB.rulesEvaluated).toContain('ethics-review');
    });
  });

  // ==========================================
  // NEW: Startup Agile (additional tests)
  // ==========================================
  describe('Startup Agile - Advanced', () => {
    it('should support mission lifecycle management', async () => {
      const bos = new BehaviorOS();
      const missions: string[] = [];

      for (let i = 0; i < 30; i++) {
        const mission = bos.createMission({
          title: `Feature ${i}`,
          type: 'feature',
          priority: 'high',
        });
        bos.startMission(mission.id);
        bos.completeMission(mission.id);
        missions.push(mission.id);
      }

      const listed = bos.listMissions();
      expect(listed).toHaveLength(30);
    });

    it('should learning record promotion sequences', async () => {
      const bos = new BehaviorOS();

      // Create a mission
      const mission = bos.createMission({
        title: 'Test Learning',
        type: 'research',
        priority: 'medium',
      });

      // Record observation
      const obs = bos.recordLearning({
        type: 'observation',
        source: 'test',
        content: 'Test observation',
        impact: 'low',
        relatedMission: mission.id,
      });
      expect(obs.type).toBe('observation');

      // Promote to lesson
      const lesson = await bos.recordLearning({
        type: 'lesson',
        source: 'test',
        content: 'Test lesson',
        impact: 'medium',
        relatedMission: mission.id,
      });
      expect(lesson.type).toBe('lesson');

      // Promote to candidate
      const candidate = await bos.recordLearning({
        type: 'pattern',
        source: 'test',
        content: 'Test pattern',
        impact: 'high',
        relatedMission: mission.id,
      });
      expect(candidate.type).toBe('pattern');
    });
  });

  // ==========================================
  // NEW: Surgical Team
  // ==========================================
  describe('Surgical Team', () => {
    it('should block production changes (sterile-field)', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Surgical Team',
        version: '2.0.0',
        description: 'Zero-defect governance',
        personas: [
          {
            role: 'surgeon',
            name: 'Lead Surgeon',
            authority: 'surgeon',
            skills: ['surgical-procedure'],
          },
        ],
        governance: [
          {
            id: 'sterile-field',
            level: 'critical',
            action: 'block',
            conditions: [{ type: 'production_change', value: true }],
            description: 'Block any non-approved production changes',
          },
        ],
        quality: [{ id: 'q1', type: 'test_coverage', threshold: 100 }],
      };

      await bos.loadDNA(dna);

      // Production change without approval - blocked
      const change = bos.evaluateGovernance('production_change', {
        agent: 'surgeon',
        context: { production_change: true },
      });
      expect(change.verdict).toBe('deny');
      expect(change.rulesEvaluated).toContain('sterile-field');
    });

    it('should enforce sterile procedure compliance', async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: 'Surgical Team',
        version: '2.0.0',
        description: 'Zero-defect governance',
        personas: [
          {
            role: 'surgeon',
            name: 'Lead Surgeon',
            authority: 'surgeon',
            skills: ['surgical-procedure'],
          },
        ],
        governance: [
          {
            id: 'sterile-procedure',
            level: 'critical',
            action: 'block',
            conditions: [{ type: 'instrument_handling', value: true }],
            description: 'Block non-sterile instrument handling',
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance('instrument_handling', {
        agent: 'nurse',
        context: { instrument_handling: true },
      });
      expect(decision.verdict).toBe('deny');
      expect(decision.rulesEvaluated).toContain('sterile-procedure');
    });
  });
});
