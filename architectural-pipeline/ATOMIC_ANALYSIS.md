# Behavior-OS — Atomic Analysis of Critical Operations (Nível 4)

> **Documento:** `ATOMIC_ANALYSIS.md`  
> **Pipeline:** Architectural Intelligence & Alignment Engine  
> **Data de Análise:** 2026-11-14  
> **Repositório:** `c:\www\behavior-os`  
> **Foco:** Análise atómica das operações mínimas de execução, pré-condições, pós-condições, invariantes e modos de falha.

---

## 1. Metodologia de Análise Atómica

Para cada operação crítica do sistema, a análise responde rigorosamente às 9 questões canónicas:
1. **Objetivo:** Qual a finalidade exata da operação?
2. **Entrada:** Que argumentos, tipos e invariantes de entrada recebe?
3. **Saída:** Que tipo, valor ou estrutura retorna?
4. **Mutação de Estado:** Que estado em memória ou persistência é alterado?
5. **Permissões / Autoridade:** Que privilégios ou papéis são exigidos?
6. **Invariantes:** Que propriedades do sistema devem permanecer estritamente verdadeiras antes e após a execução?
7. **Modos de Falha:** Que exceções, falhas transitórias ou erros lógicos podem ocorrer?
8. **Dependentes:** Que subsistemas, ferramentas ou fluxos dependem desta operação?
9. **Otimização / Segurança:** Existe uma implementação mais segura, resiliente ou simples?

---

## 2. Inspecção das 7 Operações Críticas Centrais

### Operação Atómica 1: `GovernanceEvaluationService.evaluate()`
- **Localização:** `packages/core/src/services/governance-evaluation-service.ts` (linhas 15–98)
- **1. Objetivo:** Avaliar uma ação proposta contra os pisos de segurança (safety floors), regras do DNA ativo e políticas ativas do policy ledger, retornando um veredito síncrono determinístico.
- **2. Entrada:**
  - `action`: string (identificador da ação/ferramenta, ex: `'bash'`, `'write'`)
  - `context`: `GovernanceContext` (flags de condição, texto do prompt, ferramentas envolvidas)
  - `dna`: `DNA | null` (padrão comportamental ativo)
  - `activePolicies`: `PolicyVersion[]` (conjunto imutável de políticas em vigor)
- **3. Saída:** `GovernanceDecision` `{ verdict: 'allow' | 'deny' | 'escalate' | 'warn', reason: string, rulesEvaluated: string[], firedRules: string[] }`
- **4. Mutação de Estado:** **Zero mutação de estado** nesta função (função pura de avaliação). O registo no log de governança ocorre na camada superior da fachada.
- **5. Permissões:** Executável no nível do enforcer do sistema; não requer credenciais externas.
- **6. Invariantes:**
  - Se a ação for classificada como irreversível (`classifyIrreversibleAction`), o veredito nunca pode ser inferior a `'escalate'` (Safety Floor absoluto).
  - Um DNA não selecionado permite execução no-op (modo permissivo inicial).
  - Uma regra `'block'` tem precedência sobre qualquer regra de menor severidade (`deny` é terminal).
- **7. Modos de Falha:**
  - Erro de formato no payload de contexto → sanitizado internamente com fallback seguro.
  - Regra malformada no YAML → validação de schema prévia garante integridade; exceção contida retorna `deny` por princípio de segurança falha-fechada.
- **8. Dependentes:** OpenCode `permission.evaluate` hook, MCP tool `bos_evaluate_governance`, `BehaviorOS.preflightAction()`, suite de testes C01-C25.
- **9. Otimização / Segurança:** A extração do `GovernanceEvaluationService` da fachada `BehaviorOS` reduziu o acoplamento do god node e isolou a lógica de avaliação pura, tornando-a 100% testável sem instanciar bases de dados.

---

### Operação Atómica 2: `MissionEngine.transition()`
- **Localização:** `packages/core/src/engine/mission-engine.ts` (linhas 45–140)
- **1. Objetivo:** Executar a transição atómica de estado de uma missão, validando pré-condições da máquina de estados.
- **2. Entrada:**
  - `missionId`: string
  - `targetState`: `'active' | 'completed' | 'failed' | 'cancelled'`
  - `options`: `{ evidence?: MissionEvidence[], failureReason?: string }`
- **3. Saída:** `MissionTransitionResult` `{ success: boolean, previousState: MissionState, currentState: MissionState, error?: MissionTransitionErrorCode }`
- **4. Mutação de Estado:** Altera o campo `state` e `updatedAt` da missão em memória e persiste na tabela `missions`. Se o estado alvo for terminal, desmarca `activeMission`.
- **5. Permissões:** Requer que o chamador seja o coordenador da missão ou possua autoridade `architect` / `lead`.
- **6. Invariantes:**
  - `created` só pode transitar para `active` ou `cancelled`.
  - `active` só pode transitar para `completed`, `failed` ou `cancelled`.
  - Transição para `completed` **exige obrigatoriamente** evidências válidas (`evidence.length > 0`). Não existem conclusões sem provas.
  - Estados terminais (`completed`, `failed`, `cancelled`) são imutáveis (proibida qualquer transição posterior).
- **7. Modos de Falha:**
  - Tentativa de transição inválida (ex: `created → completed`) → retorna `{ success: false, error: 'INVALID_TRANSITION' }`.
  - Falha na base de dados SQLite durante o write → a transição é abortada e o estado anterior é preservado sem corrupção.
- **8. Dependentes:** `BehaviorOS.startMission()`, `BehaviorOS.completeMission()`, `BehaviorOS.failMission()`, `LoopManager`.
- **9. Otimização / Segurança:** A máquina de estados utiliza transições explícitas protegidas por enum tipado em vez de atribuições diretas de propriedades.

---

### Operação Atómica 3: `LearningEngine.approvePolicyVersion()`
- **Localização:** `packages/core/src/engine/learning-engine.ts` (linhas 310–395)
- **1. Objetivo:** Aplicar o Human Gate obrigatório para aprovação de uma versão imutável de política gerada por aprendizagem de máquina.
- **2. Entrada:**
  - `policyId`: string
  - `versionId`: string
  - `actor`: `PolicyActor` `{ id: string, name: string, kind: 'human' | 'system' }`
  - `token?: string` (HMAC-SHA256 gerado pelo segredo do operador)
  - `rationale`: string (justificativa expressa da aprovação)
- **3. Saída:** `PolicyVersion` atualizada com status `'approved'` e registo de auditoria de aprovação.
- **4. Mutação de Estado:** Modifica o status da versão de `'validated'` para `'approved'`. Adiciona evento imutável ao ledger `policy-ledger` na tabela `meta`.
- **5. Permissões:** Requer estritamente `actor.kind === 'human'` ou HMAC-SHA256 válido quando `BEHAVIOR_OS_APPROVAL_KEY` está configurada no ambiente.
- **6. Invariantes:**
  - Nenhuma política pode transitar para `'approved'` se o seu status atual não for `'validated'`.
  - Um agente autónomo (`kind: 'system'`) não pode aprovar políticas sob nenhuma circunstância.
  - O hash de conteúdo `contentHash` da versão não pode ser alterado após aprovação.
- **7. Modos de Falha:**
  - Ator não humano tentando aprovar → lança erro `POLICY_HUMAN_GATE_REQUIRED`.
  - HMAC inválido ou divergência de payload → lança erro `INVALID_APPROVAL_TOKEN`.
- **8. Dependentes:** Chokepoint de evolução de DNA, `BehaviorOS.approvePolicyVersion()`, comandos `/govern` e `/learn`.
- **9. Otimização / Segurança:** A separação estrita entre o segredo HMAC e o código em runtime garante conformidade zero-trust e proteção contra prompt injections que tentem auto-aprovar políticas.

---

### Operação Atómica 4: `LearningEngine.activatePolicyVersion()`
- **Localização:** `packages/core/src/engine/learning-engine.ts` (linhas 410–470)
- **1. Objetivo:** Ativar uma versão de política previamente aprovada para que as suas regras passem a ter efeito vinculativo imediato no chokepoint de governança.
- **2. Entrada:** `policyId: string`, `versionId: string`
- **3. Saída:** `PolicyActivationRecord` `{ policyId, versionId, activatedAt, enforcementCount }`
- **4. Mutação de Estado:** Altera o status da versão para `'active'`. Desativa qualquer versão ativa anterior da mesma `policyId`. Atualiza o cache de políticas em vigor.
- **5. Permissões:** Exige aprovação prévia no ledger.
- **6. Invariantes:**
  - Apenas versões com status `'approved'` podem ser ativadas. Versões em `'candidate'` ou `'validated'` são estritamente rejeitadas.
  - No máximo uma versão de cada política pode estar `'active'` simultaneamente (invariante de unicidade ativa).
- **7. Modos de Falha:**
  - Tentativa de ativar versão não aprovada → lança erro `POLICY_NOT_APPROVED`.
  - Versão inexistente → lança erro `POLICY_VERSION_NOT_FOUND`.
- **8. Dependentes:** `GovernanceEvaluationService.evaluate()`, `BehaviorOS.activatePolicyVersion()`.
- **9. Otimização / Segurança:** O motor mantém as políticas ativas compiladas em memória para permitir avaliações de governança síncronas com latência < 1ms.

---

### Operação Atómica 5: `DelegationEngine.reserve()`
- **Localização:** `packages/orchestrator/src/delegation.ts` (linhas 80–135)
- **1. Objetivo:** Criar uma reserva atómica e exclusiva de um agente para uma tarefa, garantindo respeito à sua capacidade cognitiva máxima.
- **2. Entrada:**
  - `agentId`: string
  - `taskId`: string
  - `estimatedLoad`: number (fração de carga entre 0.0 e 1.0)
- **3. Saída:** `DelegationReservation` `{ reservationId, agentId, taskId, createdAt, expiresAt }`
- **4. Mutação de Estado:** Incrementa a carga ativa do agente no mapa de reservas em memória.
- **5. Permissões:** Orquestrador ou Chief Planner.
- **6. Invariantes:**
  - A carga acumulada de um agente nunca pode exceder o seu `maxCapacity` configurado (default: 1.0 ou 3 tarefas simultâneas).
  - Um agente não pode ser duplamente reservado para a mesma tarefa.
- **7. Modos de Falha:**
  - Capacidade excedida → retorna erro de sobrecarga (`AGENT_CAPACITY_EXCEEDED`), exigindo seleção de outro agente ou enfileiramento.
- **8. Dependentes:** `AutonomousOrchestrator`, `ControlLoop`, `CognitiveLoadBalancerEngine`.
- **9. Otimização / Segurança:** A reserva possui expiração temporizada (TTL) automática para prevenir deadlocks no caso de um processo cair antes de libertar a reserva.

---

### Operação Atómica 6: `DecisionEngine.decide()`
- **Localização:** `packages/core/src/engine/decision-engine.ts` (linhas 35–115)
- **1. Objetivo:** Resolver votações sobre tópicos arquiteturais, mitigação de riscos ou aprovação de código através de regras formais de quórum ponderado.
- **2. Entrada:**
  - `subject`: string (descrição do objeto de decisão)
  - `options`: `{ policy: 'majority' | 'supermajority' | 'unanimous', votes: Array<{ voter: string, choice: 'approve' | 'reject' | 'abstain', weight?: number }>, quorumThreshold?: number }`
- **3. Saída:** `DecisionResult` `{ outcome: 'approved' | 'rejected', tallies: { approve: number, reject: number, abstain: number }, totalWeight: number, quorumReached: boolean }`
- **4. Mutação de Estado:** Grava o registo imutável da decisão na tabela `decisions`.
- **5. Permissões:** Membros da equipa de agentes registados no DNA ativo.
- **6. Invariantes:**
  - Se o quórum não for atingido (`quorumReached === false`), o resultado é obrigatoriamente `'rejected'`.
  - Empates e situações de abstenção total resolvem-se estritamente para `'rejected'` (Princípio Fail-Safe).
- **7. Modos de Falha:**
  - Lista de votos vazia → `'rejected'` determinístico sem exceção.
- **8. Dependentes:** `BehaviorOS.decide()`, `AutonomousOrchestrator`, aprovação de evoluções em `BehaviorOS.applyEvolution()`.
- **9. Otimização / Segurança:** O motor é 100% determinístico e em processo, evitando qualquer dependência de redes externas ou protocolos distribuídos frágeis.

---

### Operação Atómica 7: `Store.saveMissionEvent()` (Transação Atómica SQLite/Postgres)
- **Localização:** `packages/core/src/persistence/sqlite-store.ts` (linhas 110–165)
- **1. Objetivo:** Persistir de forma duradoura e atómica um evento de ciclo de vida de missão, assegurando integridade referencial.
- **2. Entrada:** `event: MissionEvent` `{ id, missionId, type, timestamp, payload, hash }`
- **3. Saída:** `void` (garante conclusão do write em disco via `run()`)
- **4. Mutação de Estado:** Insere linha na tabela `events` com chave estrangeira apontando para a tabela `missions`.
- **5. Permissões:** Permissão de I/O em disco no caminho do SQLite.
- **6. Invariantes:**
  - O hash do evento deve coincidir com o hash SHA-256 do payload canónico.
  - Eventos possuem IDs estritamente crescentes / monótonos.
- **7. Modos de Falha:**
  - `missionId` inexistente na tabela `missions` → SQLite rejeita com violação de chave estrangeira (`SQLITE_CONSTRAINT_FOREIGNKEY`), abortando o write.
- **8. Dependentes:** Toda a auditoria forense e recuperação de sessões.
- **9. Otimização / Segurança:** Utilização de prepared statements nativos do `node:sqlite`, prevenindo qualquer forma de SQL injection.

---

## 3. Conclusão da Análise Atómica

Todas as 7 operações críticas fundamentais do sistema foram inspecionadas até ao nível das suas instruções e expressões. As implementações respeitam o princípio de defesa em profundidade, garantindo:
- **Fail-closed:** Em caso de dúvida, erro de parsing ou quebra de invariante, a ação é bloqueada ou rejeitada.
- **Imutabilidade Criptográfica:** Evidências, hashes de políticas e eventos de missão são calculados antes da persistência.
- **Zero Vazamento de Estado:** As operações puras são isoladas de operações com efeitos secundários em disco.
