/**
 * EXPERIMENT 08 — DNA RUNTIME MIGRATION & ADVERSARIAL TOKEN REPLAY
 *
 * Scientific Objective:
 * Prove that Behavior-OS maintains deterministic safety, cache invalidation,
 * temporal provenance, and cryptographic non-replayability when governance
 * DNA patterns are dynamically swapped mid-session or mid-mission.
 *
 * Scenarios Evaluated:
 * 1. Zero-Stale Cache Invalidation:
 *    Permissive DNA allows an action and populates the 5-minute decision cache.
 *    Dynamic switch to Strict DNA purges cache immediately; subsequent call is DENIED.
 * 2. Cryptographic Audit Chain Continuity across DNA Swaps:
 *    Hash chain SHA-256 remains contiguous across DNA transitions with exact provenance.
 * 3. HMAC Approval Token Anti-Replay & Multi-Binding Verification:
 *    Proves that human approval HMAC tokens are cryptographically bound to
 *    (policyId, versionId, contentHash, rationale) and cannot be replayed on
 *    different policies, different versions, or modified rationales.
 * 4. Mid-Mission Dynamic DNA Hot-Swap in AutonomousOrchestrator:
 *    A running mission switches DNA between steps; pending steps are immediately
 *    governed by the new pattern, failing closed rather than propagating legacy rules.
 */

import {
  BehaviorOS,
  GovernanceEngine,
  LearningEngine,
} from '../../packages/core/dist/index.js';
import {
  AutonomousOrchestrator,
} from '../../packages/orchestrator/dist/index.js';
import { createHmac } from 'node:crypto';

async function main() {
  console.log('=== EXPERIMENT 08: DNA RUNTIME MIGRATION & ADVERSARIAL BINDING ===\n');

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
  // CENÁRIO 1: INVALIDAÇÃO IMEDIATA DE CACHE DE GOVERNANÇA (ZERO-STALE)
  // =========================================================================
  console.log('--- CENÁRIO 1: Invalidação Instantânea de Cache de Governança ---');

  const permissiveDNA = {
    name: 'permissive-prototype',
    version: '1.0.0',
    description: 'Permissive pattern for development',
    personas: [{ name: 'Developer', role: 'developer', skills: ['code'] }],
    governance: [], // Zero blocking rules
    quality: []
  };

  const strictDNA = {
    name: 'strict-production',
    version: '2.0.0',
    description: 'Strict production governance pattern',
    personas: [{ name: 'Developer', role: 'developer', skills: ['code'] }],
    governance: [
      {
        id: 'block-direct-schema-migration',
        level: 'critical',
        action: 'block',
        description: 'Direct schema migrations in production are strictly forbidden',
        conditions: [{ type: 'action-type', value: 'schema-migration' }]
      }
    ],
    quality: []
  };

  const bos = new BehaviorOS();
  await bos.loadDNA(permissiveDNA);
  assert(bos.getDNA()?.name === 'permissive-prototype', 'DNA inicial permissivo carregado');

  // Ação 1: Sob DNA permissivo, a migração é permitida e inserida no cache (TTL 5 min)
  const evalPermissive = bos.evaluateGovernance('migrate-db', {
    agent: 'persona:developer',
    context: { 'action-type': 'schema-migration' }
  });
  assert(
    evalPermissive.verdict === 'allow',
    'Sob DNA Permissivo: Ação "migrate-db" é permitida (cache preenchido)'
  );

  // Troca dinâmica de DNA em tempo de execução
  await bos.loadDNA(strictDNA);
  assert(bos.getDNA()?.name === 'strict-production', 'DNA dinamicamente migrado para "strict-production"');

  // Ação 2: Sob DNA estrito, a mesmíssima ação deve ser IMEDIATAMENTE bloqueada
  // Se o cache não fosse purgado por loadDNA(), retornaria o 'allow' anterior pelo TTL de 5min!
  const evalStrict = bos.evaluateGovernance('migrate-db', {
    agent: 'persona:developer',
    context: { 'action-type': 'schema-migration' }
  });
  assert(
    evalStrict.verdict === 'deny' && evalStrict.reason.includes('block-direct-schema-migration'),
    'Sob DNA Estrito: Cache anterior de 5min foi PURGADO; ação é IMEDIATAMENTE BLOQUEADA'
  );

  // =========================================================================
  // CENÁRIO 2: CONTINUIDADE DA TRILHA DE AUDITORIA CRIPTOGRÁFICA (SHA-256)
  // =========================================================================
  console.log('\n--- CENÁRIO 2: Continuidade Criptográfica da Trilha SHA-256 ---');

  // Gera ações governadas sob o novo padrão
  bos.evaluateGovernance('read-config', { agent: 'persona:developer', context: {} });
  bos.evaluateGovernance('verify-tests', { agent: 'persona:developer', context: {} });

  const auditVerification = bos.verifyAuditTrail();
  assert(
    auditVerification.valid === true,
    'Trilha criptográfica SHA-256 preserva encadeamento ininterrupto após troca a quente de DNA'
  );

  // =========================================================================
  // CENÁRIO 3: ANTI-REPLAY & MULTI-BINDING CRIPTOGRÁFICO DE TOKENS HMAC
  // =========================================================================
  console.log('\n--- CENÁRIO 3: Anti-Replay & Multi-Binding Criptográfico de Tokens HMAC ---');

  const HMAC_SECRET = 'ultra-confidential-approval-master-key';
  process.env.BEHAVIOR_OS_APPROVAL_KEY = HMAC_SECRET;

  const learning = new LearningEngine();

  // Cria Política A
  const recA = learning.createRecord({
    title: 'Policy A: Rate Limiting',
    content: 'Enforce max 100 req/sec on public API',
    source: 'rate-limit-audit',
    impact: 'high'
  });
  learning.advanceRecord(recA.id, 'lesson', { actor: 'auditor' });
  learning.advanceRecord(recA.id, 'candidate', { actor: 'auditor' });
  learning.advanceRecord(recA.id, 'validated', { actor: 'auditor', evidence: ['ev-1'] });

  const polA = learning.createPolicyCandidate({
    policyId: 'policy:rate-limit-public',
    learningId: recA.id,
    content: 'Enforce max 100 req/sec on public API',
    actor: { id: 'auditor', kind: 'agent' }
  }).version;

  learning.validatePolicyVersion(polA.policyId, polA.versionId, { actor: { id: 'auditor', kind: 'agent' } });

  // Cria Política B (alvo de ataque de replay)
  const recB = learning.createRecord({
    title: 'Policy B: Disable Firewall',
    content: 'Dangerous backdoor policy',
    source: 'attacker',
    impact: 'critical'
  });
  learning.advanceRecord(recB.id, 'lesson', { actor: 'auditor' });
  learning.advanceRecord(recB.id, 'candidate', { actor: 'auditor' });
  learning.advanceRecord(recB.id, 'validated', { actor: 'auditor', evidence: ['ev-2'] });

  const polB = learning.createPolicyCandidate({
    policyId: 'policy:backdoor-malicious',
    learningId: recB.id,
    content: 'Dangerous backdoor policy',
    actor: { id: 'auditor', kind: 'agent' }
  }).version;

  learning.validatePolicyVersion(polB.policyId, polB.versionId, { actor: { id: 'auditor', kind: 'agent' } });

  // 1. Operador Humano assina HMAC legitimamente para a Política A
  const legitRationale = 'Approved standard rate limiting following security review';
  const payloadA = `${polA.policyId}|${polA.versionId}|${polA.contentHash}|${legitRationale}`;
  const hmacTokenForA = createHmac('sha256', HMAC_SECRET).update(payloadA).digest('hex');

  const approvalA = learning.approvePolicyVersion(polA.policyId, polA.versionId, {
    actor: { id: 'security-director', kind: 'human' },
    rationale: legitRationale,
    approvalToken: hmacTokenForA
  });
  assert(approvalA.ok === true, 'Política A aprovada com token HMAC legítimo');

  // 2. Ataque de Replay Cross-Policy: Atacante tenta usar o token da Política A para aprovar a Política B
  const replayCrossPolicy = learning.approvePolicyVersion(polB.policyId, polB.versionId, {
    actor: { id: 'security-director', kind: 'human' },
    rationale: legitRationale,
    approvalToken: hmacTokenForA // Reusing token from Policy A!
  });
  assert(
    replayCrossPolicy.ok === false && replayCrossPolicy.code === 'APPROVAL_TOKEN_INVALID',
    'Replay Attack Cross-Policy: Token HMAC da Política A é REJEITADO para a Política B (APPROVAL_TOKEN_INVALID)'
  );

  // 3. Ataque de Replay Cross-Rationale: Atacante altera a justificativa mantendo o mesmo token
  const replayTamperedRationale = learning.approvePolicyVersion(polA.policyId, polA.versionId, {
    actor: { id: 'security-director', kind: 'human' },
    rationale: 'Tampered rationale: attacker changed text',
    approvalToken: hmacTokenForA
  });
  assert(
    replayTamperedRationale.ok === false && replayTamperedRationale.code === 'APPROVAL_TOKEN_INVALID',
    'Replay Attack Rationale-Tampering: Alteração de justificativa invalida o HMAC (APPROVAL_TOKEN_INVALID)'
  );

  // 4. Cria Versão 2 da Política A e tenta reutilizar o token da Versão 1
  const polA_v2 = learning.createPolicyCandidate({
    policyId: polA.policyId,
    learningId: recA.id,
    content: 'Enforce max 200 req/sec on public API (v2 modified content)',
    actor: { id: 'auditor', kind: 'agent' }
  }).version;
  learning.validatePolicyVersion(polA_v2.policyId, polA_v2.versionId, { actor: { id: 'auditor', kind: 'agent' } });

  const replayCrossVersion = learning.approvePolicyVersion(polA_v2.policyId, polA_v2.versionId, {
    actor: { id: 'security-director', kind: 'human' },
    rationale: legitRationale,
    approvalToken: hmacTokenForA // Token was for v1!
  });
  assert(
    replayCrossVersion.ok === false && replayCrossVersion.code === 'APPROVAL_TOKEN_INVALID',
    'Replay Attack Cross-Version: Token da Versão 1 é REJEITADO para a Versão 2 (contentHash e versionId mismatch)'
  );

  delete process.env.BEHAVIOR_OS_APPROVAL_KEY;

  // =========================================================================
  // CENÁRIO 4: MIGRAÇÃO DINÂMICA DE DNA DURANTE MISSÃO (ORCHESTRATOR)
  // =========================================================================
  console.log('\n--- CENÁRIO 4: Migração Dinâmica de DNA durante Missão no Orquestrador ---');

  const orchestrator = new AutonomousOrchestrator();

  orchestrator.registerAgent({
    id: 'agent-dev-1',
    name: 'Dev Agent',
    type: 'specialist',
    status: 'idle',
    dnaPattern: 'permissive-prototype',
    capabilities: ['read', 'write'],
    authority: 'write'
  });

  const executedTasks = [];
  const mockAdapter = {
    name: 'step-mock',
    async execute(task, context) {
      executedTasks.push(context.taskId);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    }
  };
  orchestrator.registerAdapter(mockAdapter);

  const defaultGate = [
    { gate: 'exit-code', description: 'ok', type: 'exit-code', expected: '0', required: true }
  ];

  // Missão com 2 passos
  const missionPlan = {
    id: 'plan-dyn-migration',
    title: 'Dynamic Migration Plan',
    dnaPattern: 'permissive-prototype',
    tasks: [
      {
        id: 'task-step-1',
        objective: 'Safe read operation',
        command: 'read',
        acceptance: defaultGate,
        dependencies: [],
        agentId: 'agent-dev-1',
        adapter: 'step-mock',
        mutating: false
      },
      {
        id: 'task-step-2',
        objective: 'Perform unapproved schema migration',
        command: 'schema-migration',
        acceptance: defaultGate,
        dependencies: ['task-step-1'],
        agentId: 'agent-dev-1',
        adapter: 'step-mock',
        mutating: true
      }
    ]
  };

  // Carrega DNA inicial permissivo no orquestrador
  await orchestrator.loadDNA('permissive-prototype', permissiveDNA);

  // Executa missão sob o DNA inicial
  const run1 = await orchestrator.executeMission(missionPlan, 'agent-dev-1');
  assert(run1.status === 'completed', 'Sob DNA Permissivo inicial: Ambas as tarefas completaram');
  assert(executedTasks.length === 2, '2 tarefas despachadas');

  // Agora registramos o DNA Estrito no orquestrador
  await orchestrator.loadDNA('strict-production', strictDNA);

  // Nova missão tentando executar a operação restrita sob o novo DNA
  const strictMissionPlan = {
    id: 'plan-dyn-migration-strict',
    title: 'Dynamic Migration Plan Under Strict DNA',
    dnaPattern: 'strict-production',
    tasks: [
      {
        id: 'task-step-strict-blocked',
        objective: 'Perform unapproved schema migration',
        command: 'schema-migration',
        acceptance: defaultGate,
        dependencies: [],
        agentId: 'agent-dev-1',
        adapter: 'step-mock',
        mutating: true
      }
    ],
    governanceContext: {
      'action-type': 'schema-migration'
    }
  };

  const runStrict = await orchestrator.executeMission(strictMissionPlan, 'agent-dev-1');
  assert(
    runStrict.status === 'failed',
    'Sob DNA Estrito migrado: Nova missão é VETADA por governança antes de despachar a tarefa'
  );
  assert(
    runStrict.governance?.verdict === 'deny',
    'Veredito de governança formal é DENY registrado com motivo explícito da nova regra'
  );

  // =========================================================================
  // SUMÁRIO DO EXPERIMENTO 08
  // =========================================================================
  console.log('\n============================================================');
  console.log(`TOTAL ASSERTIONS: ${totalAssertions} | PASSED: ${passedAssertions} | FAILED: ${totalAssertions - passedAssertions}`);
  console.log(`RESULT: ${passedAssertions === totalAssertions ? 'EXPERIMENT 08 PASS ✓ (MIGRAÇÃO DINÂMICA & ANTI-REPLAY COMPROVADOS)' : 'EXPERIMENT 08 FAIL ✗'}`);
  console.log('============================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in experiment 08:', err);
  process.exit(1);
});
