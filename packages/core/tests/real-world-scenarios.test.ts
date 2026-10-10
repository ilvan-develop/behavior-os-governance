import { describe, it, expect } from "vitest";
import { BehaviorOS } from "../src/engine/behavior-os";
import type { DNA } from "@behavior-os/schemas";

describe("Real-World Scenarios", () => {
  describe("Healthcare (HIPAA Compliance)", () => {
    it("should block unauthorized patient data access", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Healthcare HIPAA",
        version: "2.0.0",
        description: "Healthcare compliance",
        personas: [{ role: "doctor", name: "Dr. Smith", authority: "admin", skills: ["patient-care"] }],
        governance: [
          {
            id: "hipaa-access",
            level: "critical",
            action: "block",
            conditions: [{ type: "patient_data_access", value: true }, { type: "authorization", value: false }],
            description: "Block unauthorized patient data access",
          },
        ],
        quality: [{ id: "q1", type: "test_coverage", threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Unauthorized access should be blocked
      const decision = bos.evaluateGovernance("access_patient_data", {
        agent: "nurse",
        context: { patient_data_access: true, authorization: false },
      });
      expect(decision.verdict).toBe("deny");
      expect(decision.rulesEvaluated).toContain("hipaa-access");

      // Authorized access should be allowed
      const authorizedDecision = bos.evaluateGovernance("access_patient_data", {
        agent: "doctor",
        context: { patient_data_access: true, authorization: true },
      });
      expect(authorizedDecision.verdict).toBe("allow");
    });

    it("should enforce audit trail for patient records", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Healthcare Audit",
        version: "2.0.0",
        description: "Audit requirements",
        personas: [],
        governance: [
          {
            id: "audit-log",
            level: "high",
            action: "log",
            conditions: [{ type: "patient_record_modification", value: true }],
            description: "Log all patient record modifications",
          },
        ],
        quality: [],
      };

      await bos.loadDNA(dna);

      const decision = bos.evaluateGovernance("modify_patient_record", {
        agent: "admin",
        context: { patient_record_modification: true },
      });

      expect(decision.verdict).toBe("allow");
      expect(decision.rulesEvaluated).toContain("audit-log");

      // Record learning event
      const learning = bos.recordLearning({
        type: "insight",
        source: "healthcare-audit",
        content: "Patient record modified by admin",
        impact: "high",
      });
      expect(learning.type).toBe("insight");
    });
  });

  describe("Financial Services (SOX Compliance)", () => {
    it("should require dual approval for financial transactions", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Financial SOX",
        version: "2.0.0",
        description: "Financial compliance",
        personas: [
          { role: "controller", name: "CFO", authority: "executive", skills: ["finance"] },
          { role: "auditor", name: "Auditor", authority: "compliance", skills: ["audit"] },
        ],
        governance: [
          {
            id: "dual-approval",
            level: "critical",
            action: "escalate",
            conditions: [
              { type: "transaction_above_threshold", value: true },
              { type: "currency", value: "USD" },
            ],
            description: "Transactions over $10k require dual approval",
          },
        ],
        quality: [{ id: "q1", type: "test_coverage", threshold: 85 }],
      };

      await bos.loadDNA(dna);

      // Small transaction - allow
      const smallTx = bos.evaluateGovernance("process_transaction", {
        agent: "accountant",
        context: { transaction_above_threshold: false, currency: "USD" },
      });
      expect(smallTx.verdict).toBe("allow");

      // Large transaction - escalate
      const largeTx = bos.evaluateGovernance("process_transaction", {
        agent: "accountant",
        context: { transaction_above_threshold: true, currency: "USD" },
      });
      expect(largeTx.verdict).toBe("escalate");
    });

    it("should track all financial audit events", async () => {
      const bos = new BehaviorOS();
      const mission = bos.createMission({ title: "Financial Audit Q4", type: "audit", priority: "critical" });

      const report = bos.runAudit({ missionId: mission.id, agentId: "auditor-1" });
      expect(report.overall).toBeDefined();
      expect(report.stages.length).toBeGreaterThanOrEqual(4);

      const learning = bos.recordLearning({
        type: "pattern",
        source: "financial-audit",
        content: "Quarterly audit completed with zero findings",
        impact: "medium",
        relatedMission: mission.id,
      });
      expect(learning.relatedMission).toBe(mission.id);
    });
  });

  describe("DevOps Pipeline", () => {
    it("should enforce code review before deployment", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "DevOps Pipeline",
        version: "2.0.0",
        description: "CI/CD governance",
        personas: [{ role: "developer", name: "Dev", authority: "developer", skills: ["coding"] }],
        governance: [
          {
            id: "code-review-required",
            level: "high",
            action: "block",
            conditions: [
              { type: "deploy_to_production", value: true },
              { type: "code_review_approved", value: false },
            ],
            description: "Production deployment requires code review",
          },
        ],
        quality: [{ id: "lint", type: "lint", threshold: 0 }],
      };

      await bos.loadDNA(dna);

      // Deploy without review - blocked
      const noReview = bos.evaluateGovernance("deploy_to_production", {
        agent: "ci-bot",
        context: { deploy_to_production: true, code_review_approved: false },
      });
      expect(noReview.verdict).toBe("deny");

      // Deploy with review - allowed
      const withReview = bos.evaluateGovernance("deploy_to_production", {
        agent: "ci-bot",
        context: { deploy_to_production: true, code_review_approved: true },
      });
      expect(withReview.verdict).toBe("allow");
    });
  });

  describe("Startup Agile", () => {
    it("should allow rapid iteration with lightweight governance", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Startup Agile",
        version: "2.0.0",
        description: "Fast-paced development",
        personas: [{ role: "founder", name: "CEO", authority: "owner", skills: ["strategy"] }],
        governance: [
          {
            id: "security-check",
            level: "medium",
            action: "warn",
            conditions: [
              { type: "production_deploy", value: true },
              { type: "security_scan", value: false },
            ],
            description: "Warn when deploying without security scan",
          },
        ],
        quality: [{ id: "coverage", type: "test_coverage", threshold: 60 }],
      };

      await bos.loadDNA(dna);

      // Deploy without security scan - warn but allow
      const decision = bos.evaluateGovernance("production_deploy", {
        agent: "developer",
        context: { production_deploy: true, security_scan: false },
      });
      expect(decision.verdict).toBe("allow");
      expect(decision.reason).toContain("Warning");
    });

    it("should support fast mission cycles", async () => {
      const bos = new BehaviorOS();
      const iterations = 20;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const mission = bos.createMission({ title: `Feature ${i}`, type: "feature", priority: "high" });
        bos.startMission(mission.id);
        bos.completeMission(mission.id);
      }
      const duration = performance.now() - start;

      const missions = bos.listMissions();
      expect(missions).toHaveLength(iterations);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe("Blockchain/Web3", () => {
    it("should enforce smart contract audit requirements", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Blockchain Governance",
        version: "2.0.0",
        description: "Smart contract safety",
        personas: [{ role: "auditor", name: "Security Team", authority: "compliance", skills: ["audit"] }],
        governance: [
          {
            id: "contract-audit",
            level: "critical",
            action: "block",
            conditions: [
              { type: "deploy_smart_contract", value: true },
              { type: "audit_completed", value: false },
            ],
            description: "Smart contracts must be audited before deployment",
          },
          {
            id: "multi-sig",
            level: "high",
            action: "escalate",
            conditions: [
              { type: "large_transaction", value: true },
              { type: "currency", value: "ETH" },
            ],
            description: "Large ETH transactions require multi-sig",
          },
        ],
        quality: [{ id: "coverage", type: "test_coverage", threshold: 95 }],
      };

      await bos.loadDNA(dna);

      // Deploy un-audited contract - blocked
      const unAudited = bos.evaluateGovernance("deploy_contract", {
        agent: "developer",
        context: { deploy_smart_contract: true, audit_completed: false },
      });
      expect(unAudited.verdict).toBe("deny");

      // Deploy audited contract - allowed
      const audited = bos.evaluateGovernance("deploy_contract", {
        agent: "developer",
        context: { deploy_smart_contract: true, audit_completed: true },
      });
      expect(audited.verdict).toBe("allow");

      // Large ETH transaction - escalate
      const largeTx = bos.evaluateGovernance("transfer_eth", {
        agent: "treasurer",
        context: { large_transaction: true, currency: "ETH" },
      });
      expect(largeTx.verdict).toBe("escalate");
    });
  });

  describe("IoT/Embedded Systems", () => {
    it("should enforce safety certifications", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "IoT Safety",
        version: "2.0.0",
        description: "Embedded system safety",
        personas: [{ role: "engineer", name: "Firmware Dev", authority: "technical", skills: ["embedded"] }],
        governance: [
          {
            id: "safety-cert",
            level: "critical",
            action: "block",
            conditions: [
              { type: "firmware_update", value: true },
              { type: "safety_certified", value: false },
            ],
            description: "Firmware must be safety certified",
          },
        ],
        quality: [{ id: "coverage", type: "test_coverage", threshold: 90 }],
      };

      await bos.loadDNA(dna);

      // Deploy un-certified firmware - blocked
      const unsafe = bos.evaluateGovernance("firmware_update", {
        agent: "engineer",
        context: { firmware_update: true, safety_certified: false },
      });
      expect(unsafe.verdict).toBe("deny");
    });
  });

  describe("AI/ML Pipeline", () => {
    it("should enforce model validation requirements", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "AI/ML Governance",
        version: "2.0.0",
        description: "ML pipeline safety",
        personas: [{ role: "data_scientist", name: "ML Engineer", authority: "technical", skills: ["ml"] }],
        governance: [
          {
            id: "model-validation",
            level: "high",
            action: "block",
            conditions: [
              { type: "deploy_model", value: true },
              { type: "model_validated", value: false },
            ],
            description: "Model must be validated before deployment",
          },
          {
            id: "bias-audit",
            level: "critical",
            action: "escalate",
            conditions: [
              { type: "model_decision", value: true },
              { type: "bias_checked", value: false },
            ],
            description: "Bias audit required for production models",
          },
        ],
        quality: [{ id: "performance", type: "test_coverage", threshold: 85 }],
      };

      await bos.loadDNA(dna);

      // Deploy unvalidated model - blocked
      const unvalidated = bos.evaluateGovernance("deploy_model", {
        agent: "ml-engineer",
        context: { deploy_model: true, model_validated: false },
      });
      expect(unvalidated.verdict).toBe("deny");

      // Deploy without bias check - escalate
      const noBiasCheck = bos.evaluateGovernance("model_decision", {
        agent: "ml-engineer",
        context: { model_decision: true, bias_checked: false },
      });
      expect(noBiasCheck.verdict).toBe("escalate");
    });
  });

  describe("Gaming Studio", () => {
    it("should enforce content review for game releases", async () => {
      const bos = new BehaviorOS();
      const dna: DNA = {
        name: "Gaming Studio",
        version: "2.0.0",
        description: "Game development governance",
        personas: [{ role: "game_director", name: "Creative Lead", authority: "creative", skills: ["game-design"] }],
        governance: [
          {
            id: "content-review",
            level: "high",
            action: "block",
            conditions: [
              { type: "game_release", value: true },
              { type: "content_review", value: false },
            ],
            description: "Game content must be reviewed before release",
          },
        ],
        quality: [{ id: "performance", type: "test_coverage", threshold: 70 }],
      };

      await bos.loadDNA(dna);

      // Release without content review - blocked
      const unreviewed = bos.evaluateGovernance("game_release", {
        agent: "producer",
        context: { game_release: true, content_review: false },
      });
      expect(unreviewed.verdict).toBe("deny");
    });
  });
});
