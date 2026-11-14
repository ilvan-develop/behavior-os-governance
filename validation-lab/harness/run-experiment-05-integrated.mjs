/**
 * EXPERIMENT 05 — INTEGRATED END-TO-END AUTONOMOUS MISSION (PHASE 4)
 *
 * Demonstrates the complete integrated lifecycle of Behavior-OS:
 * 1. Reception of a high-complexity multi-tenant mission goal.
 * 2. ChiefOrchestrator cognitive planning: assessment, architectural decision
 *    with alternatives, phase derivation, and specialist delegation.
 * 3. AutonomousOrchestrator execution with zero-trust role verification,
 *    circuit breaker protection, and bounded concurrency.
 * 4. Tamper-evident cryptographic audit trail (SHA-256 hash chain).
 * 5. Complete governed learning cycle with test evidence gating and human approval.
 * 6. Cross-session persistence in SQLite relational store.
 */

import {
  BehaviorOS,
  LearningEngine,
  SqliteStore,
} from '../../packages/core/dist/index.js';
import {
  AutonomousOrchestrator,
  ChiefOrchestrator,
  CircuitBreaker,
} from '../../packages/orchestrator/dist/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  console.log('=== EXPERIMENT 05: INTEGRATED END-TO-END AUTONOMOUS MISSION ===\n');

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

  const tempDir = mkdtempSync(join(tmpdir(), 'bos-exp05-e2e-'));
  const dbPath = join(tempDir, 'mission-e2e.db');

  // =========================================================================
  // ETAPA 1: RECEPÇÃO E PLANEJAMENTO COGNITIVO COM CHIEFORCHESTRATOR
  // =========================================================================
  console.log('--- ETAPA 1: Planejamento Cognitivo e Seleção de Especialistas ---');

  const chief = new ChiefOrchestrator();
  const dnaConfig = {
    name: 'enterprise-governance',
    version: '1.0.0',
    description: 'Enterprise governance pattern',
    personas: [
      { name: 'Lead Architect', role: 'architect', skills: ['design', 'architecture'], authority: 'readonly' },
      { name: 'Senior Developer', role: 'developer', skills: ['backend', 'coding', 'remediation'], authority: 'write' },
      { name: 'Security Auditor', role: 'auditor', skills: ['audit', 'compliance'], authority: 'readonly' }
    ],
    governance: [
      {
        id: 'block-unverified-deploy',
        level: 'critical',
        action: 'block',
        description: 'Deploy without test evidence is blocked',
        conditions: [{ type: 'unverified-deploy', value: true }]
      }
    ],
    quality: []
  };

  const missionGoal = 'Investigate and remediate critical data race in multi-tenant ledger service';
  const plan = chief.plan({
    goal: missionGoal,
    dna: dnaConfig
  });

  assert(typeof plan.assessment.complexity === 'number', 'Chief avalia complexidade dimensional da missão');
  assert(typeof plan.decision.chosen === 'string' && plan.decision.alternatives.length >= 2, 'Chief formula decisão de arquitetura comparando alternativas');
  assert(plan.phases.length >= 4, `Chief estrutura missão em ${plan.phases.length} fases sequenciais`);
  assert(plan.delegation.length >= 4, `Chief delega tarefas entre os especialistas com base em competências e autoridade`);
  assert(plan.delegation.some(d => d.role === 'architect'), 'Fase de análise atribuída ao arquiteto');
  assert(plan.delegation.some(d => d.role === 'developer'), 'Fase de implementação atribuída ao desenvolvedor');
  assert(plan.delegation.some(d => d.role === 'auditor'), 'Fase de auditoria e conformidade atribuída ao auditor');

  // =========================================================================
  // ETAPA 2: CONFIGURAÇÃO DE AMBIENTE E GOVERNANÇA INTEGRADA
  // =========================================================================
  console.log('\n--- ETAPA 2: Governança Integrada & Persistência Relacional ---');

  const bos = new BehaviorOS();
  await bos.loadDNA(dnaConfig);
  assert(bos.getDNA()?.name === 'enterprise-governance', 'DNA enterprise-governance carregado no núcleo Behavior-OS');

  const store = new SqliteStore({ path: dbPath });

  const missionRecord = {
    id: 'mission-e2e-ledger-audit',
    title: missionGoal,
    type: 'audit',
    priority: 'critical',
    status: 'in-progress',
    updatedAt: new Date().toISOString()
  };
  store.saveMission(missionRecord);
  assert(store.getMission('mission-e2e-ledger-audit')?.id === 'mission-e2e-ledger-audit', 'Missão registrada no store relacional SQLite');

  // =========================================================================
  // ETAPA 3: EXECUÇÃO ORQUESTRADA COM AUTONOMOUSORCHESTRATOR & ADAPTER
  // =========================================================================
  console.log('\n--- ETAPA 3: Execução Coordenada com Zero-Trust & Circuit Breaker ---');

  const orchestrator = new AutonomousOrchestrator({
    cooldownMs: 50,
    maxRetries: 2,
    failureThreshold: 3
  });

  // Registra agentes com suas autoridades estritas
  orchestrator.registerAgent({
    id: 'persona:architect',
    name: 'Lead Architect',
    type: 'specialist',
    status: 'idle',
    dnaPattern: 'enterprise-governance',
    capabilities: ['design', 'architecture'],
    authority: 'readonly',
    currentMission: missionRecord.id,
    metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 }
  });

  orchestrator.registerAgent({
    id: 'persona:developer',
    name: 'Senior Developer',
    type: 'specialist',
    status: 'idle',
    dnaPattern: 'enterprise-governance',
    capabilities: ['backend', 'coding', 'remediation'],
    authority: 'write',
    currentMission: missionRecord.id,
    metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 }
  });

  orchestrator.registerAgent({
    id: 'persona:auditor',
    name: 'Security Auditor',
    type: 'specialist',
    status: 'idle',
    dnaPattern: 'enterprise-governance',
    capabilities: ['audit', 'compliance'],
    authority: 'readonly',
    currentMission: missionRecord.id,
    metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 }
  });

  // Mock adapter determinístico que executa passos simulados
  const executionLog = [];
  const mockAdapter = {
    name: 'mock',
    async execute(task, context) {
      executionLog.push({
        taskId: context.taskId,
        agentId: context.agentId,
        action: task.objective || task.command
      });
      return {
        exitCode: 0,
        stdout: `Success: ${task.objective} completed by ${context.agentId}`,
        stderr: ''
      };
    }
  };
  orchestrator.registerAdapter(mockAdapter);

  // Normalização do plano do Chief para o formato de tarefas aceito pelo AutonomousOrchestrator
  const defaultGate = [
    {
      gate: 'exit-code',
      description: 'Must exit with code 0',
      type: 'exit-code',
      expected: '0',
      required: true
    }
  ];

  const normalizedTasks = plan.tasks.map(t => ({
    id: t.id,
    objective: t.objective,
    description: t.objective,
    command: `execute ${t.objective}`,
    acceptance: defaultGate,
    dependencies: t.dependsOn || [],
    agentId: t.owner,
    adapter: 'mock',
    mutating: t.mutating
  }));

  const orchestratorPlan = {
    id: 'plan-e2e-ledger',
    title: missionGoal,
    goal: missionGoal,
    tasks: normalizedTasks
  };

  const missionExecution = await orchestrator.executeMission(orchestratorPlan, 'persona:architect');
  assert(missionExecution.status === 'completed', 'AutonomousOrchestrator executa plano em fases com sucesso total');
  assert(executionLog.length === plan.tasks.length, `Todas as ${plan.tasks.length} tarefas foram despachadas e registradas pelo adapter`);

  // Zero-Trust check: verificar atribuição de tarefas
  const architectActions = executionLog.filter(e => e.agentId === 'persona:architect');
  const developerActions = executionLog.filter(e => e.agentId === 'persona:developer');
  assert(architectActions.length > 0, 'Arquiteto executou tarefas de análise e decisão');
  assert(developerActions.length > 0, 'Desenvolvedor executou tarefas de implementação e testes');

  // =========================================================================
  // ETAPA 4: AUDITORIA CRIPTOGRÁFICA SHA-256 E AVALIAÇÃO DE GOVERNANÇA
  // =========================================================================
  console.log('\n--- ETAPA 4: Auditoria Criptográfica (SHA-256) & Quality Gates ---');

  // Realiza avaliações governadas no BehaviorOS para alimentar a trilha criptográfica
  bos.evaluateGovernance('audit-ledger-architecture', {
    agent: 'persona:architect',
    context: { file: 'src/ledger/concurrency.ts' }
  });
  bos.evaluateGovernance('audit-remediation-patch', {
    agent: 'persona:developer',
    context: { patch: 'apply-cas-lock', linesChanged: 42 }
  });
  bos.evaluateGovernance('audit-final-verification', {
    agent: 'persona:auditor',
    context: { testResults: '101/101 passed', coverage: 94.5 }
  });

  const auditVerification = bos.verifyAuditTrail();
  assert(auditVerification.valid === true, 'Trilha de auditoria criptográfica SHA-256 verificada e intacta');

  // Avaliação de qualidade
  const qualityResult = bos.checkQuality({
    coverage: 94.5,
    complexity: 12,
    rulesCount: 3
  });
  assert(qualityResult.passed === true, 'Quality gates aprovados com métricas da missão');

  // =========================================================================
  // ETAPA 5: REGISTRO DE APRENDIZAGEM PERSISTENTE COM PORTA HUMANA
  // =========================================================================
  console.log('\n--- ETAPA 5: Ciclo de Aprendizagem, Evidência e Aprovação Humana ---');

  const learningEngine = new LearningEngine();

  // 1. Observation
  const learnRec = learningEngine.createRecord({
    title: 'Multi-Tenant Ledger CAS Concurrency Pattern',
    content: 'Non-atomic balance update in multi-tenant ledger resolved using optimistic CAS version check.',
    source: 'ledger-concurrency-audit',
    impact: 'critical',
    relatedMission: missionRecord.id,
    actor: 'persona:auditor'
  });

  // 2. Advance to lesson
  learningEngine.advanceRecord(learnRec.id, 'lesson', {
    actor: 'persona:auditor',
    reason: 'Race condition reproduced in high-concurrency test suite'
  });

  // 3. Advance to candidate
  learningEngine.advanceRecord(learnRec.id, 'candidate', {
    actor: 'persona:auditor',
    reason: 'Proposed reusable policy: mandatory CAS version verification on ledger writes'
  });

  // 4. Advance to validated (with tangible evidence)
  const validationAdvance = learningEngine.advanceRecord(learnRec.id, 'validated', {
    actor: 'persona:auditor',
    reason: 'Verified through 101 passing unit tests and concurrency load simulations',
    evidence: [
      'test-run: tests/ledger.test.ts 31 passed',
      'audit-hash: valid sha256 contiguous chain'
    ]
  });
  assert(validationAdvance.ok === true && validationAdvance.record.stage === 'validated', 'Lição promovida para "validated" com evidências tangíveis');

  // 5. Create Policy Candidate
  const policyCandidate = learningEngine.createPolicyCandidate({
    policyId: 'policy:mandatory-ledger-cas',
    learningId: learnRec.id,
    content: 'All mutating operations on financial ledgers must include optimistic concurrency control (CAS version check)',
    source: 'ledger-concurrency-audit',
    actor: { id: 'persona:auditor', kind: 'agent' },
    enforcement: {
      action: 'block',
      match: 'ledger-write',
      severity: 'critical',
      description: 'Ledger write without CAS version parameter is forbidden'
    }
  });
  assert(policyCandidate.ok === true, 'Candidato a política criado com regra de bloqueio em falha de CAS');

  const version = policyCandidate.ok ? policyCandidate.version : null;

  // 6. Validar versão da política
  learningEngine.validatePolicyVersion(version.policyId, version.versionId, {
    actor: { id: 'persona:auditor', kind: 'agent' }
  });

  // 7. Aprovação e ativação humana
  const approved = learningEngine.approvePolicyVersion(version.policyId, version.versionId, {
    actor: { id: 'chief-financial-officer', kind: 'human' },
    rationale: 'Approved critical ledger concurrency protection policy'
  });
  assert(approved.ok === true, 'Política aprovada por autoridade humana');

  const activated = learningEngine.activatePolicyVersion(version.policyId, version.versionId, {
    actor: { id: 'chief-financial-officer', kind: 'human' }
  });
  assert(activated.ok === true, 'Política formalmente ativada no sistema');

  // 8. Persistência da missão e aprendizados no SQLite
  store.saveMission({
    ...missionRecord,
    status: 'completed',
    updatedAt: new Date().toISOString()
  });

  store.saveLearning({
    id: 'learn-event-ledger-cas-01',
    type: 'fix',
    source: 'ledger-concurrency-audit',
    content: 'Mandatory CAS on ledger writes policy activated',
    impact: 'critical',
    timestamp: new Date().toISOString()
  });

  const finalMission = store.getMission('mission-e2e-ledger-audit');
  assert(finalMission?.status === 'completed', 'Missão atualizada como "completed" persistida no SQLite');

  const learnings = store.listLearnings();
  assert(learnings.some(l => l.id === 'learn-event-ledger-cas-01'), 'Evento de aprendizado crítico persistido no SQLite');

  store.close();
  rmSync(tempDir, { recursive: true, force: true });

  // =========================================================================
  // SUMÁRIO DO EXPERIMENTO 05
  // =========================================================================
  console.log('\n============================================================');
  console.log(`TOTAL ASSERTIONS: ${totalAssertions} | PASSED: ${passedAssertions} | FAILED: ${totalAssertions - passedAssertions}`);
  console.log(`RESULT: ${passedAssertions === totalAssertions ? 'EXPERIMENT 05 PASS ✓ (EXPERIÊNCIA INTEGRADA COMPLETA)' : 'EXPERIMENT 05 FAIL ✗'}`);
  console.log('============================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in experiment 05:', err);
  process.exit(1);
});
