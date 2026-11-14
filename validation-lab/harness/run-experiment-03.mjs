/**
 * EXPERIMENT 03 — GOVERNANCE, AUDIT INTEGRITY & REAL LEARNING
 *
 * Fixed version: all API signatures verified against source.
 *
 * API discoveries:
 * - GovernanceEngine.evaluateConditions: { type: '<contextKey>', value: <exactValue> }
 *   (no 'field'/'operator'; string values use strict equality, numbers use >=)
 * - GovernanceDecision: { id, action, verdict, reason, rulesEvaluated, firedRules?, timestamp, agentId, warnings? }
 *   (firedRules is optional; only present when at least one rule fires)
 * - classifyIrreversibleAction('credentials', {}) → 'secret-exposure' (via SECRET_VERBS)
 * - classifyIrreversibleCommand only covers shell destructive/deploy verbs; secret
 *   classification is in classifyIrreversibleAction.
 * - BehaviorOS.evaluateGovernance(action, { agent, context: {...} })
 *   requires loadDNA() first; context sub-object is what govEngine.evaluate() receives
 * - verifyAuditTrail() → { valid, checked, complete } (not totalRecords)
 * - LearningEngine.createRecord(opts) (not createLearningRecord)
 * - LearningEngine.advanceRecord(id, toStage, opts) (not advanceLearningRecord; needs explicit target stage)
 * - createPolicyCandidate({ policyId, content, actor, ... }) → { ok, version }
 *   (version.versionId, not versionId at top level)
 * - validatePolicyVersion(policyId, versionId, { actor, issues? })
 * - approvePolicyVersion(policyId, versionId, { actor, rationale })
 *   (requires human actor AND passing validation first)
 * - activatePolicyVersion(policyId, versionId, { actor })
 *   (requires human actor AND validation AND approval)
 * - SqliteStore.saveMission(data) / getMission(id) / saveLearning(data) / listLearnings() / close()
 */

import {
  BehaviorOS,
  GovernanceEngine,
  LearningEngine,
  SqliteStore,
  classifyIrreversibleAction,
  classifyIrreversibleCommand,
} from '../../packages/core/dist/index.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  console.log('=== EXPERIMENT 03: GOVERNANCE, AUDIT INTEGRITY & REAL LEARNING ===\n');

  let passedAssertions = 0;
  let totalAssertions = 0;
  function assert(condition, description) {
    totalAssertions++;
    if (condition) {
      passedAssertions++;
      console.log(`[PASS] ${description}`);
    } else {
      console.error(`[FAIL] ${description}`);
    }
  }

  // =========================================================================
  // PROVA 1: GOVERNANCE ENGINE & SAFETY FLOOR CLASSIFICATION
  // =========================================================================
  console.log('--- PROVA 1: Governance Engine & Inviolable Safety Floor ---');

  // Test 1.1: Destructive shell commands classified (classifyIrreversibleCommand)
  const destructive1 = classifyIrreversibleCommand('rm -rf /var/data');
  assert(destructive1 === 'destructive', 'Shell "rm -rf" classified as destructive');

  const destructive2 = classifyIrreversibleCommand('format C: /FS:NTFS');
  assert(destructive2 === 'destructive', 'Shell "format C:" classified as destructive');

  // Test 1.2: Release/deployment commands classified
  const deploy1 = classifyIrreversibleCommand('git push --force origin main');
  assert(deploy1 === 'deployment', 'Shell "git push --force" classified as deployment');

  const deploy2 = classifyIrreversibleCommand('npm publish --access public');
  assert(deploy2 === 'deployment', 'Shell "npm publish" classified as deployment');

  // Test 1.3: Secret-exposure via classifyIrreversibleAction (SECRET_VERBS set)
  // 'credentials', 'credential', 'secret', 'secrets', 'keychain' are SECRET_VERBS
  const secretAction = classifyIrreversibleAction('credentials', {});
  assert(secretAction === 'secret-exposure', '"credentials" action classified as secret-exposure via SECRET_VERBS');

  const secretAction2 = classifyIrreversibleAction('secrets', { 'secret-exposure': true });
  assert(secretAction2 === 'secret-exposure', '"secrets" action with explicit flag classified as secret-exposure');

  // Test 1.4: Read-only commands NOT classified (false-positive prevention)
  const safeRead = classifyIrreversibleCommand('grep deploy README.md');
  assert(safeRead === null, '"grep deploy README.md" correctly NOT classified (read-only tool, C24 contract)');

  // Test 1.5: GovernanceEngine with DNA rules
  // IMPORTANT: evaluateConditions uses { type: contextKey, value: exactValue }
  // (strict equality for strings — no 'contains' operator)
  const govDNA = {
    name: 'Governance-Test',
    version: '1.0.0',
    description: 'Governance test pattern',
    personas: [],
    governance: [
      {
        id: 'block-env-access',
        level: 'critical',
        action: 'block',
        description: 'Direct access to secrets file is forbidden',
        // Rule fires when context['env-file'] === true (boolean match)
        conditions: [{ type: 'env-file', value: true }]
      },
      {
        id: 'block-prod-write',
        level: 'high',
        action: 'block',
        description: 'Write to production resource is forbidden',
        // Rule fires when context['resource'] === 'production-db'
        conditions: [{ type: 'resource', value: 'production-db' }]
      }
    ],
    quality: []
  };

  const govEngine = new GovernanceEngine(govDNA);

  // Block case: context matches rule condition
  const decisionBlocked = govEngine.evaluate({
    action: 'write',
    agentId: 'builder-agent',
    context: { 'env-file': true }
  });
  assert(
    decisionBlocked.verdict === 'deny',
    'GovernanceEngine denies action when DNA rule conditions match (deny is final)'
  );
  assert(
    Array.isArray(decisionBlocked.firedRules) && decisionBlocked.firedRules.includes('block-env-access'),
    'GovernanceEngine reports "block-env-access" in firedRules'
  );

  // Allow case: context does NOT match any rule
  const decisionAllowed = govEngine.evaluate({
    action: 'read',
    agentId: 'auditor-agent',
    context: { file: '/app/src/index.ts' }
  });
  assert(
    decisionAllowed.verdict === 'allow',
    'GovernanceEngine allows legitimate read when no rule is violated'
  );
  assert(
    !decisionAllowed.firedRules || decisionAllowed.firedRules.length === 0,
    'No firedRules on clean read'
  );

  // Second block case: different rule
  const decisionBlocked2 = govEngine.evaluate({
    action: 'write',
    agentId: 'builder-agent',
    context: { resource: 'production-db' }
  });
  assert(
    decisionBlocked2.verdict === 'deny' && decisionBlocked2.firedRules?.includes('block-prod-write'),
    'GovernanceEngine denies production-db write (second rule fires)'
  );

  // =========================================================================
  // PROVA 2: TAMPER-EVIDENT AUDIT TRAIL (SHA-256 HASH CHAIN)
  // =========================================================================
  console.log('\n--- PROVA 2: Tamper-Evident SHA-256 Audit Trail ---');

  const bos = new BehaviorOS();

  // DNA object (pre-shaped — BehaviorOS.loadDNA accepts the raw validated shape)
  const bosDNA = {
    name: 'enterprise-governance',
    version: '1.0.0',
    description: 'Enterprise governance for audit',
    personas: [{ name: 'Auditor', role: 'auditor', skills: [] }],
    governance: [],
    quality: []
  };
  await bos.loadDNA(bosDNA);

  assert(bos.getDNA()?.name === 'enterprise-governance', 'BehaviorOS DNA loaded successfully');

  // Perform governed actions (each evaluation appends to the internal audit log)
  bos.evaluateGovernance('audit-read', { agent: 'auditor-1', context: { file: 'src/main.ts' } });
  bos.evaluateGovernance('audit-verify', { agent: 'auditor-1', context: { check: 'unit-tests' } });
  bos.evaluateGovernance('audit-finalize', { agent: 'auditor-1', context: { status: 'passed' } });

  // verifyAuditTrail() → { valid: boolean, checked: number, complete: boolean }
  const auditVerification = bos.verifyAuditTrail();
  assert(
    auditVerification.valid === true,
    'Audit trail SHA-256 chain is valid after 3 governance evaluations'
  );
  assert(
    typeof auditVerification.checked === 'number',
    `verifyAuditTrail returns checked count (${auditVerification.checked} records in retained window)`
  );
  assert(
    typeof auditVerification.complete === 'boolean',
    'verifyAuditTrail reports completeness flag'
  );

  // =========================================================================
  // PROVA 3: LEARNING ENGINE LIFECYCLE (STRICT EVIDENCE GATING)
  // =========================================================================
  console.log('\n--- PROVA 3: Strict Learning Lifecycle (Observation to Policy) ---');

  const learningEngine = new LearningEngine();

  // Stage 1: Create initial observation (createRecord, not createLearningRecord)
  const record = learningEngine.createRecord({
    title: 'Cache TTL Milliseconds Trap',
    content: 'Passing milliseconds to a seconds parameter leads to 1000x stale retention.',
    source: 'service-mesh-billing-postmortem',
    impact: 'high',
    actor: 'auditor-agent'
  });
  assert(record.stage === 'observation', 'Learning record initiates at stage "observation"');
  assert(typeof record.id === 'string' && record.id.startsWith('learn-rec-'), 'Learning record has valid id');

  // Stage 2: Advance to 'lesson' (advanceRecord needs explicit target stage)
  const advanceToLesson = learningEngine.advanceRecord(record.id, 'lesson', {
    actor: 'auditor-agent',
    reason: 'Root cause identified as unit mismatch'
  });
  assert(advanceToLesson.ok === true && advanceToLesson.record.stage === 'lesson', 'Advanced to stage "lesson"');

  // Stage 3: Advance to 'candidate'
  const advanceToCandidate = learningEngine.advanceRecord(record.id, 'candidate', {
    actor: 'auditor-agent',
    reason: 'Candidate policy formulated: explicit typed duration or seconds validation'
  });
  assert(
    advanceToCandidate.ok === true && advanceToCandidate.record.stage === 'candidate',
    'Advanced to stage "candidate"'
  );

  // Stage 4: Attempt to advance to "validated" WITHOUT evidence (MUST FAIL)
  const unverifiedAdvance = learningEngine.advanceRecord(record.id, 'validated', {
    actor: 'auditor-agent',
    reason: 'Trying to promote without proof'
    // No evidence array
  });
  assert(
    unverifiedAdvance.ok === false && unverifiedAdvance.code === 'EVIDENCE_REQUIRED',
    'Promotion to "validated" REJECTED when evidence is omitted (Truth & Evidence enforcement)'
  );

  // Stage 5: Advance to "validated" WITH real evidence (MUST PASS)
  const verifiedAdvance = learningEngine.advanceRecord(record.id, 'validated', {
    actor: 'auditor-agent',
    reason: 'Verified through 101 unit/concurrency tests',
    evidence: [
      'test-result: tests/cache.test.ts 19 passed',
      'test-result: tests/ledger.test.ts 31 passed'
    ]
  });
  assert(
    verifiedAdvance.ok === true && verifiedAdvance.record.stage === 'validated',
    'Promotion to "validated" SUCCEEDS when tangible evidence is supplied'
  );

  // Stage 6: Policy candidate creation
  // createPolicyCandidate({ policyId, content, actor, ... }) → { ok, version }
  const policyResult = learningEngine.createPolicyCandidate({
    policyId: `policy:${record.id}`,
    learningId: record.id,
    content: 'When writing to cache with a TTL parameter, assert the value is in seconds (< 86400). Values > 3600 require explicit duration unit annotation.',
    source: 'service-mesh-billing-postmortem',
    actor: { id: 'auditor-agent', kind: 'agent' },
    reason: 'Prevent TTL unit mismatch causing 1000x stale cache retention'
  });
  assert(policyResult.ok === true, 'Policy candidate created successfully');
  const policyVersion = policyResult.ok ? policyResult.version : null;
  assert(
    policyVersion?.versionId?.includes('policy:'),
    `Policy version has valid versionId: ${policyVersion?.versionId}`
  );

  // Validate the policy version (validatePolicyVersion(policyId, versionId, { actor }))
  const validationResult = learningEngine.validatePolicyVersion(
    policyVersion.policyId,
    policyVersion.versionId,
    { actor: { id: 'auditor-1', kind: 'agent' } }
  );
  assert(
    validationResult.ok === true && validationResult.validation?.valid === true,
    'Policy version validates successfully'
  );

  // Attempt APPROVAL by AI agent (MUST FAIL — only humans can approve)
  const agentApproval = learningEngine.approvePolicyVersion(
    policyVersion.policyId,
    policyVersion.versionId,
    {
      actor: { id: 'ai-agent-1', kind: 'agent' },
      rationale: 'Auto-approved by AI agent'
    }
  );
  assert(
    agentApproval.ok === false && agentApproval.code === 'HUMAN_APPROVAL_REQUIRED',
    'Policy APPROVAL by AI agent is BLOCKED (human-in-the-loop requirement)'
  );

  // Approval by human operator (MUST SUCCEED)
  const humanApproval = learningEngine.approvePolicyVersion(
    policyVersion.policyId,
    policyVersion.versionId,
    {
      actor: { id: 'human-security-officer', kind: 'human' },
      rationale: 'Reviewed cache TTL policy — aligns with sec-ticket-4821 requirements'
    }
  );
  assert(
    humanApproval.ok === true,
    'Policy approved by human operator successfully'
  );

  // Attempt ACTIVATION by AI agent (MUST FAIL)
  const agentActivation = learningEngine.activatePolicyVersion(
    policyVersion.policyId,
    policyVersion.versionId,
    { actor: { id: 'ai-agent-1', kind: 'agent' } }
  );
  assert(
    agentActivation.ok === false && agentActivation.code === 'HUMAN_APPROVAL_REQUIRED',
    'Policy ACTIVATION by autonomous AI agent is BLOCKED (human-in-the-loop requirement)'
  );

  // Activation by human (MUST SUCCEED — validation + approval already exist)
  const humanActivation = learningEngine.activatePolicyVersion(
    policyVersion.policyId,
    policyVersion.versionId,
    { actor: { id: 'human-security-officer', kind: 'human' } }
  );
  assert(
    humanActivation.ok === true && humanActivation.version?.versionId === policyVersion.versionId,
    'Policy version successfully activated by human operator'
  );

  // =========================================================================
  // PROVA 4: PERSISTENT SQLITE STORE & CROSS-SESSION RECOVERY
  // =========================================================================
  console.log('\n--- PROVA 4: Persistent SQLite Store & Cross-Session Recovery ---');

  const tempDbDir = mkdtempSync(join(tmpdir(), 'bos-exp03-db-'));
  const dbPath = join(tempDbDir, 'persistent-test.db');

  // Session 1: Write to SQLite database
  const storeSession1 = new SqliteStore({ path: dbPath });

  const missionData = {
    id: 'mission-cross-session-101',
    title: 'Persistent Verification Mission',
    type: 'audit',
    priority: 'high',
    status: 'completed',
    updatedAt: new Date().toISOString()
  };
  storeSession1.saveMission(missionData);

  const learningData = {
    id: 'learn-cross-session-202',
    type: 'fix',
    source: 'service-mesh-billing',
    content: 'Always use parameterized SQL queries to prevent injection attacks',
    impact: 'critical',
    timestamp: new Date().toISOString()
  };
  storeSession1.saveLearning(learningData);
  storeSession1.close();

  assert(existsSync(dbPath), 'SQLite database file created on disk after session 1');

  // Session 2: Read from the same SQLite file (new independent instance)
  const storeSession2 = new SqliteStore({ path: dbPath });

  const recoveredMission = storeSession2.getMission('mission-cross-session-101');
  assert(
    recoveredMission !== null &&
    recoveredMission.id === 'mission-cross-session-101' &&
    recoveredMission.title === 'Persistent Verification Mission',
    'Mission state successfully recovered from persistent SQLite across restarts'
  );

  const recoveredLearnings = storeSession2.listLearnings();
  assert(
    recoveredLearnings.some(l => l.id === 'learn-cross-session-202' && l.impact === 'critical'),
    'Validated learning successfully recovered across sessions without context pollution'
  );

  storeSession2.close();
  rmSync(tempDbDir, { recursive: true, force: true });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n============================================================');
  console.log(`TOTAL ASSERTIONS: ${totalAssertions} | PASSED: ${passedAssertions} | FAILED: ${totalAssertions - passedAssertions}`);
  console.log(`RESULT: ${passedAssertions === totalAssertions ? 'EXPERIMENT 03 PASS ✓' : 'EXPERIMENT 03 FAIL ✗'}`);
  console.log('============================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in experiment 03:', err);
  process.exit(1);
});
