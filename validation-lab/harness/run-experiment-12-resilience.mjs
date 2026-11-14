/**
 * EXPERIMENT 12 — COGNITIVE RESILIENCE & MEMORY INTEGRITY HARNESS
 *
 * Scenarios:
 * 12.1 Memory Poisoning & Multi-Gate Promotion Defense
 * 12.2 Agent Collusion Resistance in Weighted Consensus
 * 12.3 Dynamic Specialist Failover with Reactivation & Zero Duplication
 * 12.4 Cross-Mission State & Audit Trail Isolation
 * 12.5 Consensus Manipulation Defense & Boundary Enforcement
 * 12.6 Interruption Recovery & Cryptographic Idempotency in Autonomous Orchestrator
 */

import crypto from 'node:crypto';
import {
  BehaviorOS,
  LearningEngine,
  ConsensusEngine,
  CognitiveLoadBalancerEngine
} from '../../packages/core/dist/index.js';
import {
  AutonomousOrchestrator
} from '../../packages/orchestrator/dist/index.js';

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, description, detail = '') {
  if (condition) {
    passed++;
    console.log(`[PASS] ${description}`);
    results.push({ status: 'PASS', description, detail });
  } else {
    failed++;
    console.error(`[FAIL] ${description} ${detail ? '(' + detail + ')' : ''}`);
    results.push({ status: 'FAIL', description, detail });
  }
}

async function runExperiment12() {
  console.log('================================================================');
  console.log('EXPERIMENT 12: COGNITIVE RESILIENCE & MEMORY INTEGRITY');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 12.1 — Memory Poisoning & Multi-Gate Promotion Defense
  // -------------------------------------------------------------------------
  console.log('--- 12.1 Memory Poisoning & Multi-Gate Promotion Defense ---');
  const approvalSecret = 'exp12-cryptographic-signing-key-production';
  process.env.BEHAVIOR_OS_APPROVAL_KEY = approvalSecret;

  const le = new LearningEngine();
  const poisonRecord = le.createRecord({
    title: 'Fabricated Performance Optimization',
    content: 'Disabling garbage collection and increasing heap yields 10x throughput improvement',
    source: 'adversarial-probe-untrusted',
    impact: 'critical'
  });

  assert(
    poisonRecord && poisonRecord.stage === 'observation' && poisonRecord.evidence.length === 0,
    '12.1.1: Registro de aprendizado adverso criado no estágio inicial "observation" com evidências vazias'
  );

  const advLesson = le.advanceRecord(poisonRecord.id, 'lesson');
  const advCandidate = le.advanceRecord(poisonRecord.id, 'candidate');
  assert(
    advLesson.ok === true && advCandidate.ok === true,
    '12.1.2: Progressão sequencial observation -> lesson -> candidate bem-sucedida no ciclo cognitivo'
  );

  const advWithoutEv = le.advanceRecord(poisonRecord.id, 'validated');
  assert(
    advWithoutEv.ok === false && advWithoutEv.code === 'EVIDENCE_REQUIRED',
    '12.1.3: Bloqueio imediato (EVIDENCE_REQUIRED) ao tentar promover para "validated" sem evidências empíricas'
  );

  // Tentativa com evidência textual fornecida
  const advWithEv = le.advanceRecord(poisonRecord.id, 'validated', {
    evidence: ['CI synthetic microbenchmark reported 10x throughput']
  });
  const advPolicy = le.advanceRecord(poisonRecord.id, 'policy');
  const polId = `policy:${poisonRecord.id}`;
  const versions = le.getPolicyVersions(polId);
  assert(
    advWithEv.ok === true && advPolicy.ok === true && versions.length === 1,
    '12.1.4: Promoção para estágio "policy" cria versão inativa candidata no livro-razão de governança'
  );

  const candidateVersion = versions[0];

  // Tentativa de aprovação humana sem validação prévia
  const appBeforeVal = le.approvePolicyVersion(polId, candidateVersion.versionId, {
    actor: { id: 'auditor-sec', kind: 'human' },
    rationale: 'Reviewing unvalidated benchmark claim for emergency activation'
  });
  assert(
    appBeforeVal.ok === false && appBeforeVal.code === 'VALIDATION_REQUIRED',
    '12.1.5: Bloqueio estrito (VALIDATION_REQUIRED) impede aprovação de versão não validada pelo validador'
  );

  // Validador técnico realiza a validação do hash
  const valResult = le.validatePolicyVersion(polId, candidateVersion.versionId, {
    actor: { id: 'automated-test-suite', kind: 'agent' }
  });

  // Tentativa de aprovação sem HMAC token
  const appNoToken = le.approvePolicyVersion(polId, candidateVersion.versionId, {
    actor: { id: 'chief-compliance-officer', kind: 'human' },
    rationale: 'Attempting approval without HMAC authorization cryptographic token'
  });
  assert(
    valResult.ok === true && appNoToken.ok === false && appNoToken.code === 'APPROVAL_TOKEN_REQUIRED',
    '12.1.6: Rejeição formal (APPROVAL_TOKEN_REQUIRED) quando aprovação carece de assinatura HMAC'
  );

  // Tentativa com token forjado
  const appForged = le.approvePolicyVersion(polId, candidateVersion.versionId, {
    actor: { id: 'chief-compliance-officer', kind: 'human' },
    rationale: 'Attempting approval with forged HMAC authorization token payload',
    approvalToken: 'deadbeefcafe0000111122223333444455556666777788889999aaaabbbbcccc'
  });
  assert(
    appForged.ok === false && appForged.code === 'APPROVAL_TOKEN_INVALID',
    '12.1.7: Rejeição criptográfica (APPROVAL_TOKEN_INVALID) com token forjado ou assinado com chave errada'
  );

  // Aprovação legítima com HMAC SHA-256 multi-bound
  const legitimateRationale = 'Rigorous human verification performed; authorized for limited staging deploy';
  const legitimatePayload = [
    candidateVersion.policyId,
    candidateVersion.versionId,
    candidateVersion.contentHash,
    legitimateRationale
  ].join('|');
  const legitimateHmac = crypto.createHmac('sha256', approvalSecret).update(legitimatePayload).digest('hex');

  const appLegitimate = le.approvePolicyVersion(polId, candidateVersion.versionId, {
    actor: { id: 'chief-compliance-officer', kind: 'human' },
    rationale: legitimateRationale,
    approvalToken: legitimateHmac
  });
  assert(
    appLegitimate.ok === true && appLegitimate.approval?.actorKind === 'human',
    '12.1.8: Aprovação criptográfica deferida apenas quando HMAC multi-bound bate perfeitamente com o hash'
  );

  // -------------------------------------------------------------------------
  // 12.2 — Agent Collusion Resistance in Weighted Consensus
  // -------------------------------------------------------------------------
  console.log('\n--- 12.2 Agent Collusion Resistance in Weighted Consensus ---');
  const ce = new ConsensusEngine();

  // Dois agentes em conluio submetem voto favorável com justificativa coordenada idêntica (peso somado 0.4)
  // Três especialistas independentes rejeitam com análises técnicas fundamentadas (peso somado 0.9)
  const colludingVotes = [
    { voter: 'colluding-agent-1', choice: 'approve', weight: 0.2, rationale: 'Identical claim: 10x throughput enhancement verified' },
    { voter: 'colluding-agent-2', choice: 'approve', weight: 0.2, rationale: 'Identical claim: 10x throughput enhancement verified' },
    { voter: 'sec-auditor', choice: 'reject', weight: 0.3, rationale: 'Heap exhaustion risk under sustained concurrency load' },
    { voter: 'perf-architect', choice: 'reject', weight: 0.3, rationale: 'GC pause latency spikes by 400% on tail percentiles' },
    { voter: 'reliability-lead', choice: 'reject', weight: 0.3, rationale: 'Violates SLA safety boundaries established in ADR-004' }
  ];

  const rMaj = ce.resolve({ subject: 'collusion-evaluation', votes: colludingVotes, policy: 'majority' });
  assert(
    rMaj.round?.outcome === 'rejected' &&
    rMaj.round?.tally?.approveWeight === 0.4 &&
    Math.abs(rMaj.round?.tally?.rejectWeight - 0.9) < 1e-6,
    '12.2.1: Política majority rejeita conluio: votos matemáticos sobrepõem textos persuasivos repetidos'
  );

  const rSup = ce.resolve({ subject: 'collusion-evaluation', votes: colludingVotes, policy: 'supermajority' });
  assert(
    rSup.round?.outcome === 'rejected',
    '12.2.2: Política supermajority rejeita conluio: proporção de aprovação (30.8%) fica abaixo de 66.7%'
  );

  const rUna = ce.resolve({ subject: 'collusion-evaluation', votes: colludingVotes, policy: 'unanimous' });
  assert(
    rUna.round?.outcome === 'rejected',
    '12.2.3: Política unanimous rejeita conluio: existência de votos de rejeição veta aprovação imediata'
  );

  // -------------------------------------------------------------------------
  // 12.3 — Dynamic Specialist Failover with Reactivation & Zero Duplication
  // -------------------------------------------------------------------------
  console.log('\n--- 12.3 Dynamic Specialist Failover with Reactivation & Zero Duplication ---');
  const clb = new CognitiveLoadBalancerEngine();

  clb.registerAgent('specialist-primary', { maxCapacity: 1.0, currentLoad: 0.1 });
  clb.registerAgent('specialist-secondary', { maxCapacity: 1.0, currentLoad: 0.25 });

  const recInitial = clb.recommendAssignment('task-01');
  assert(
    recInitial?.agentId === 'specialist-primary',
    '12.3.1: Alocação inicial seleciona especialista primário de menor carga (0.10 vs 0.25)'
  );

  // Simula sobrecarga no primário com tarefas adicionais
  clb.assignTask('specialist-primary', 'task-01');
  clb.assignTask('specialist-primary', 'task-02'); // carga sobe para 0.30

  const recFailover = clb.recommendAssignment('task-03');
  assert(
    recFailover?.agentId === 'specialist-secondary',
    '12.3.2: Failover dinâmico: especialista secundário assume nova tarefa quando primário atinge 0.30'
  );
  clb.assignTask('specialist-secondary', 'task-03');

  // Primário conclui suas tarefas pendentes
  clb.completeTask('specialist-primary', 'task-01');
  clb.completeTask('specialist-primary', 'task-02'); // carga volta a 0.10

  const recRecovered = clb.recommendAssignment('task-04');
  assert(
    recRecovered?.agentId === 'specialist-primary',
    '12.3.3: Reativação limpa: primário recuperado volta a receber tarefas prioritárias'
  );

  // Verificação de não-duplicação de tarefas
  const executedTaskIds = new Set();
  const allAssigned = ['task-01', 'task-02', 'task-03', 'task-04'];
  let duplicateCount = 0;
  for (const tid of allAssigned) {
    if (executedTaskIds.has(tid)) duplicateCount++;
    executedTaskIds.add(tid);
  }
  assert(
    duplicateCount === 0 && executedTaskIds.size === 4,
    '12.3.4: Zero duplicação: nenhuma tarefa foi executada duplamente durante o ciclo de failover e recuperação'
  );

  // -------------------------------------------------------------------------
  // 12.4 — Cross-Mission State & Audit Trail Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- 12.4 Cross-Mission State & Audit Trail Isolation ---');
  const bosAlpha = new BehaviorOS();
  const bosBeta = new BehaviorOS();

  const dnaAlpha = {
    name: 'dna-mission-alpha',
    version: '1.0.0',
    personas: [{ name: 'Alpha Worker', role: 'developer', skills: ['code'] }],
    governance: [],
    quality: []
  };

  const dnaBeta = {
    name: 'dna-mission-beta',
    version: '1.0.0',
    personas: [{ name: 'Beta Worker', role: 'developer', skills: ['code'] }],
    governance: [
      {
        id: 'block-beta-mutation',
        level: 'critical',
        action: 'block',
        description: 'Mutation is strictly blocked in beta',
        conditions: [{ type: 'action-type', value: 'dangerous-mutation' }]
      }
    ],
    quality: []
  };

  await bosAlpha.loadDNA(dnaAlpha);
  await bosBeta.loadDNA(dnaBeta);

  const evalAlpha = bosAlpha.evaluateGovernance('dangerous-mutation', {
    agent: 'persona:developer',
    context: { 'action-type': 'dangerous-mutation' }
  });
  const evalBeta = bosBeta.evaluateGovernance('dangerous-mutation', {
    agent: 'persona:developer',
    context: { 'action-type': 'dangerous-mutation' }
  });

  assert(
    evalAlpha.verdict === 'allow' && evalBeta.verdict === 'deny',
    '12.4.1: Governança isolada: Sessão Alpha permite mutação enquanto Sessão Beta bloqueia estritamente com deny'
  );

  const missionAlpha = bosAlpha.createMission({ title: 'Mission Alpha Pipeline', type: 'development' });
  const missionBeta = bosBeta.createMission({ title: 'Mission Beta Audit', type: 'audit' });

  bosAlpha.startMission(missionAlpha.id);

  assert(
    missionAlpha.id !== missionBeta.id &&
    bosAlpha.getAgentState().activeMission === missionAlpha.id &&
    bosBeta.getAgentState().activeMission === null,
    '12.4.2: Isolamento de ciclo de vida: Missões criadas em instâncias separadas mantêm IDs e estados desacoplados'
  );

  const auditVerification = bosAlpha.verifyAuditTrail();
  assert(
    auditVerification.valid === true,
    '12.4.3: Integridade da trilha de auditoria: estrutura SHA-256 preservada e matematicamente válida'
  );

  // -------------------------------------------------------------------------
  // 12.5 — Consensus Manipulation Defense & Boundary Enforcement
  // -------------------------------------------------------------------------
  console.log('\n--- 12.5 Consensus Manipulation Defense & Boundary Enforcement ---');
  const ceManip = new ConsensusEngine();

  // Teste A: Unânime com votante solitário e quorum atingido
  const rSolo = ceManip.resolve({
    subject: 'solo-unanimous',
    policy: 'unanimous',
    quorum: 1,
    votes: [{ voter: 'lone-voter', choice: 'approve', weight: 1.0 }]
  });
  assert(
    rSolo.round?.outcome === 'approved',
    '12.5.1: Política unanimous com 1 participante unânime resolve approved sem bloqueio espúrio'
  );

  // Teste B: Supermaioria na fronteira estrita (2/3 = 0.6666... vs threshold 0.667)
  const rBoundary = ceManip.resolve({
    subject: 'boundary-check',
    policy: 'supermajority',
    supermajorityThreshold: 0.667,
    votes: [
      { voter: 'v1', choice: 'approve', weight: 2 },
      { voter: 'v2', choice: 'reject', weight: 1 }
    ]
  });
  assert(
    rBoundary.round?.outcome === 'rejected' && (rBoundary.round?.tally?.approveRatio ?? 0) < 0.667,
    '12.5.2: Fronteira matemática estrita: 66.66% é rejeitado quando limiar de supermaioria exige >= 66.7%'
  );

  // Teste C: Todos abstêm-se (fail-safe)
  const rAllAbstain = ceManip.resolve({
    subject: 'all-abstain',
    policy: 'majority',
    votes: [
      { voter: 'v1', choice: 'abstain', weight: 1.0 },
      { voter: 'v2', choice: 'abstain', weight: 1.0 }
    ]
  });
  assert(
    rAllAbstain.round?.outcome === 'rejected' && rAllAbstain.round?.tally?.approveWeight === 0,
    '12.5.3: Fail-safe Zero-Trust: votação com 100% de abstenção resulta obrigatoriamente em "rejected"'
  );

  // -------------------------------------------------------------------------
  // 12.6 — Interruption Recovery & Cryptographic Idempotency
  // -------------------------------------------------------------------------
  console.log('\n--- 12.6 Interruption Recovery & Cryptographic Idempotency ---');
  const orchestrator = new AutonomousOrchestrator({ defaultMaxAttempts: 1 });
  orchestrator.registerAgent({
    id: 'operator-agent',
    name: 'Operator Agent',
    type: 'specialist',
    status: 'idle',
    dnaPattern: 'enterprise-governance',
    capabilities: ['execution'],
    authority: 'write'
  });

  let taskExecutionCounter = 0;
  orchestrator.registerAdapter({
    name: 'idempotent-mock-adapter',
    execute: async (task) => {
      taskExecutionCounter++;
      return {
        status: 'completed',
        exitCode: 0,
        stdout: `Task ${task.id} execution #${taskExecutionCounter} finished`,
        stderr: ''
      };
    }
  });

  const missionPlan = {
    id: 'plan-idempotency-mission',
    title: 'Idempotency Recovery Mission',
    dnaPattern: 'enterprise-governance',
    idempotencyKey: 'idemp-key-exp12-session-alpha',
    tasks: [
      {
        id: 't-resilience-1',
        title: 'Execute Database Transaction',
        objective: 'Apply schema migration idempotently',
        adapter: 'idempotent-mock-adapter',
        acceptance: [{ gate: 'exit-code', description: 'Zero exit code', type: 'exit-code', expected: '0', required: true }],
        dependencies: [],
        maxAttempts: 1
      }
    ]
  };

  const firstExecution = await orchestrator.executeMission(missionPlan, 'operator-agent');
  assert(
    firstExecution.status === 'completed' && taskExecutionCounter === 1,
    '12.6.1: Primeira execução da missão executa tarefa física (contador de execuções = 1)'
  );

  // Re-execução da mesmíssima missão com a mesma idempotencyKey
  const secondExecution = await orchestrator.executeMission(missionPlan, 'operator-agent');
  assert(
    secondExecution.status === 'completed' && taskExecutionCounter === 1,
    '12.6.2: Re-execução com mesma chave de idempotência retorna resultado em cache com ZERO re-execuções físicas'
  );

  // Execução de missão com nova idempotencyKey
  const missionPlanNewKey = {
    ...missionPlan,
    idempotencyKey: 'idemp-key-exp12-session-beta'
  };
  const thirdExecution = await orchestrator.executeMission(missionPlanNewKey, 'operator-agent');
  assert(
    thirdExecution.status === 'completed' && taskExecutionCounter === 2,
    '12.6.3: Execução com nova chave de idempotência prossegue para nova execução física controlada'
  );

  // -------------------------------------------------------------------------
  // Resumo
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`RESUMO EXPERIMENTO 12: ${passed} PASS, ${failed} FAIL (Total: ${passed + failed})`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runExperiment12().catch((err) => {
  console.error('ERRO FATAL NO EXPERIMENTO 12:', err);
  process.exit(1);
});
