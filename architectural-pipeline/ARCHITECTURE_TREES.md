# Behavior-OS — Architecture Trees & Execution Graphs (Nível 5)

> **Documento:** `ARCHITECTURE_TREES.md`  
> **Pipeline:** Architectural Intelligence & Alignment Engine  
> **Data de Análise:** 2026-11-14  
> **Repositório:** `c:\www\behavior-os`  
> **Grafo de Conhecimento:** `graphify-out/graph.json` (3.869 nós, 7.549 arestas, 53 comunidades semânticas)

---

## 1. Import Graph & Package Dependency Graph

A análise estática das 2.157 arestas de importação (`imports`, `imports_from`, `re_exports`, `dynamic_import`) comprova que o grafo de dependências entre pacotes é estritamente acíclico (DAG puro).

```mermaid
graph TD
    Schemas["@behavior-os/schemas<br/>(Contratos de Domínio & Zod)"]
    Core["@behavior-os/core<br/>(48 Motores + Fachada BehaviorOS)"]
    Orchestrator["behavioros-orchestrator<br/>(Loop de Controlo & Delegação)"]
    Plugin["@behavior-os/opencode-plugin<br/>(OpenCode V2 Native Plugin)"]
    MCPServer["@behavior-os/mcp-server<br/>(Servidor MCP stdio)"]
    SDK["@behavior-os/sdk<br/>(Cliente TypeScript)"]
    CLI["@behavior-os/cli<br/>(Interface de Terminal)"]
    Examples["examples<br/>(Workspace App)"]

    Core -->|imports| Schemas
    Orchestrator -->|imports| Core
    Orchestrator -->|imports| Schemas
    Plugin -->|imports| Core
    Plugin -->|imports| Orchestrator
    Plugin -->|imports| Schemas
    MCPServer -->|imports| Core
    MCPServer -->|imports| Schemas
    SDK -->|imports| Core
    SDK -->|imports| Schemas
    CLI -->|imports| Core
    CLI -->|imports| Schemas
    Examples -->|imports| Core
```

### Análise de Ciclos de Importação
- **Ciclos Fortemente Conectados (SCC > 1) com arestas de importação:** **0 ciclos**.
- A verificação direcionada confirma que as referências circulares aparentes encontradas em análises não-direcionadas eram falsos positivos gerados por arestas bidirecionais de contenção (`contains` e `method`), e não por importações circulares em runtime.

---

## 2. AST (Abstract Syntax Tree) Hierarchy

O grafo de código mapeia 3.869 nós AST gerados a partir do código fonte TypeScript (77.995 linhas de código `.ts` distribuídas por 359 ficheiros).

```mermaid
classDiagram
    class BehaviorOS {
        +EngineRegistry engines
        +DNALoader dnaLoader
        +Store store
        +evaluateGovernance(action, options)
        +preflightAction(action, options)
        +runAudit(options)
        +recordLearning(input)
        +createMission(options)
        +startMission(missionId)
        +completeMission(missionId, evidence)
        +decide(subject, options)
    }

    class GovernanceEvaluationService {
        +evaluate(action, context, dna, policies)
        +checkSafetyFloors(action)
        +matchDnaRules(action, context)
        +applyActivePolicies(action, context)
    }

    class GovernanceEngine {
        +evaluateRule(rule, context)
        +evaluateAction(action, dna, context)
    }

    class MissionEngine {
        +createMission(options)
        +transition(missionId, targetState)
        +addEvidence(missionId, evidence)
    }

    class LearningEngine {
        +createRecord(options)
        +advanceRecord(options)
        +createPolicyCandidate(options)
        +validatePolicyVersion(options)
        +approvePolicyVersion(options)
        +activatePolicyVersion(options)
    }

    class DecisionEngine {
        +decide(subject, options)
        +computeQuorum(votes, policy)
    }

    class DelegationEngine {
        +registerAgent(profile)
        +assign(taskId, requirements)
        +reserve(agentId, taskId)
        +release(reservationId)
    }

    class AutonomousOrchestrator {
        +executeTask(task)
        +dispatchLoop(plan)
    }

    BehaviorOS --> GovernanceEvaluationService : delega avaliação
    GovernanceEvaluationService --> GovernanceEngine : avalia regras DNA
    BehaviorOS --> MissionEngine : gere estados de missão
    BehaviorOS --> LearningEngine : rastreia ciclo de aprendizagem
    BehaviorOS --> DecisionEngine : executa votação ponderada
    AutonomousOrchestrator --> DelegationEngine : reserva e atribui agentes
```

---

## 3. Call Graph — Caminhos de Execução Críticos

O sistema possui 2.066 arestas de chamada direta (`calls`, `indirect_call`, `method`).

### 3.1 Chokepoint de Governação (Execução em Tempo Real)
```mermaid
sequenceDiagram
    autonumber
    actor Host as OpenCode Hook / MCP Tool
    participant Facade as BehaviorOS
    participant GovSvc as GovernanceEvaluationService
    participant GovEng as GovernanceEngine
    participant PolicyLedger as LearningEngine (Policy Ledger)
    participant Log as GovernanceLog (Ring Buffer)

    Host->>Facade: evaluateGovernance(action, { context, agent })
    Facade->>GovSvc: evaluate(action, context, activeDNA, activePolicies)
    GovSvc->>GovSvc: classifyIrreversibleAction(action)
    alt Ação Irreversível sem Bypass Permitido
        GovSvc-->>Facade: verdict: 'escalate' (Safety Floor)
    else Ação Avaliável
        GovSvc->>GovEng: evaluateRules(dna.governance, context)
        GovEng-->>GovSvc: dnaVerdict (block / escalate / warn / allow)
        GovSvc->>PolicyLedger: getActivePolicies()
        PolicyLedger-->>GovSvc: activeEnforcements
        GovSvc->>GovSvc: mergeEnforcements(dnaVerdict, activeEnforcements)
        GovSvc-->>Facade: finalVerdict
    end
    Facade->>Log: appendEntry({ action, verdict, rule, step, mission })
    Facade-->>Host: GovernanceDecision
```

---

## 4. Control Flow Graph (CFG) — Avaliação de Regras

```mermaid
flowchart TD
    Start([Início: Avaliação de Ação]) --> CheckDNA{DNA ativo selecionado?}
    CheckDNA -- Não --> DefaultPass[Permitir como no-op / modo irrestrito]
    CheckDNA -- Sim --> CheckSafetyFloor{Ação classificada como Irreversível?}

    CheckSafetyFloor -- Sim --> EnforceEscalate[Veredito: ESCALATE obrigatório]
    CheckSafetyFloor -- Não --> MatchDNARules[Iterar sobre regras de governança do DNA]

    MatchDNARules --> HasBlockRule{Alguma regra gerou BLOCK?}
    HasBlockRule -- Sim --> SetBlock[Veredito Provisório: DENY]
    HasBlockRule -- Não --> HasEscalateRule{Alguma regra gerou ESCALATE?}
    HasEscalateRule -- Sim --> SetEscalate[Veredito Provisório: ESCALATE]
    HasEscalateRule -- Não --> HasWarnRule{Alguma regra gerou WARN?}
    HasWarnRule -- Sim --> SetWarn[Veredito Provisório: WARN]
    HasWarnRule -- Não --> SetAllow[Veredito Provisório: ALLOW]

    SetBlock --> CheckActivePolicies[Consultar Políticas Ativas do Policy Ledger]
    SetEscalate --> CheckActivePolicies
    SetWarn --> CheckActivePolicies
    SetAllow --> CheckActivePolicies

    CheckActivePolicies --> HasPolicyOverride{Existe política ativa mais restritiva?}
    HasPolicyOverride -- Sim --> UpgradeSeverity[Elevar severidade para Política Ativa]
    HasPolicyOverride -- Não --> FinalizeVerdict[Consolidar Veredito Final]
    UpgradeSeverity --> FinalizeVerdict

    FinalizeVerdict --> LogDecision[Gravar no Ring Buffer de Governança]
    LogDecision --> ReturnDecision([Retornar GovernanceDecision])
```

---

## 5. State Transition Graph — Máquina de Estados de Missão

O ciclo de vida da missão obedece a regras de transição estritas validadas em `packages/core/src/engine/mission-engine.ts`. Nenhuma transição pode violar as invariantes estabelecidas:

```mermaid
stateDiagram-v2
    [*] --> created : createMission()
    created --> active : startMission()
    created --> cancelled : cancelMission()
    
    active --> completed : completeMission() [Requer Evidências Válidas]
    active --> failed : failMission() [Requer Razão de Falha]
    active --> cancelled : cancelMission()

    completed --> [*]
    failed --> [*]
    cancelled --> [*]

    note right of completed
        Não pode transitar para completed
        sem evidências de testes / auditoria.
    end note
```

---

## 6. State Transition Graph — Ciclo de Vida do Policy Version Ledger

O ledger de políticas promove lições através de estágios unidirecionais imutáveis (`packages/core/src/engine/learning-engine.ts`):

```mermaid
stateDiagram-v2
    [*] --> observation : recordLearning(observation)
    observation --> lesson : advanceRecord(lesson)
    lesson --> candidate : createPolicyCandidate()
    candidate --> validated : validatePolicyVersion() [Requer Evidência]
    validated --> approved : approvePolicyVersion() [Requer Aprovação Humana ou HMAC]
    approved --> active : activatePolicyVersion()
    active --> deactivated : deactivatePolicy()
    active --> rolled_back : rollbackPolicy()
    deactivated --> active : re-activate
    rolled_back --> [*]
    deactivated --> [*]

    note right of approved
        Human Gate Obrigatório:
        actor.kind === 'human' ou
        HMAC-SHA256 Token Válido.
    end note
```

---

## 7. Data Flow Graph (DFG) — Da Ingestão à Persistência

```mermaid
flowchart LR
    UserInput["Entrada: Prompt / Ação de Ferramenta"] --> Hook["OpenCode Hook / MCP Server Handler"]
    Hook --> ContextBuilder["buildGovernanceContext()"]
    ContextBuilder --> HashGen["SHA-256 Action Payload Hash"]
    HashGen --> Facade["BehaviorOS.evaluateGovernance()"]
    Facade --> Engine["GovernanceEvaluationService"]
    Engine --> Verdict["Decision Object"]
    Verdict --> RingBuffer["RingBuffer Log (Persisted Tail)"]
    Verdict --> StoreWriter["Store.saveMissionEvent()"]
    StoreWriter --> SQLite[("SQLite / Postgres DB")]
    Verdict --> NotificationService["Coalescing Notification Service"]
    NotificationService --> UIOutput["Aviso em Tela / Retorno ao Agente"]
```

---

## 8. Event Flow Graph — Barramento de Eventos e Telemetria

O sistema emite eventos tipados rastreáveis através do `MetricsEngine` e `event-monitor`:

```mermaid
flowchart TD
    ActionTrigger["Disparo de Ação"] --> GovEvent["Evento: governance.evaluate"]
    GovEvent --> RuleCount["Contador: ruleFires.increment(ruleId)"]
    GovEvent --> ToolUsage["Contador: toolUsage.increment(toolName, verdict)"]
    GovEvent --> LatencyTrace["Temporizador: latencyMs"]

    VerdictDeny["Veredito DENY / ESCALATE"] --> SyntheticNotice["Mensagem Sintética de Sessão"]
    SyntheticNotice --> Coalescer["Notification Coalescer (Deduplicação de Avisos)"]
    Coalescer --> SessionStream["Stream da Sessão OpenCode"]

    MetricsQuery["bos_get_metrics"] --> MetricsExtract["Extrator de Métricas"]
    RuleCount --> MetricsExtract
    ToolUsage --> MetricsExtract
    LatencyTrace --> MetricsExtract
```

---

## 9. Task DAG — Decomposição e Execução em Loop

No `behavioros-orchestrator`, as tarefas são orquestradas como um Directed Acyclic Graph (DAG) gerido por `ControlLoop`:

```mermaid
graph TD
    RootTask["Tarefa Raiz (Objetivo da Missão)"] --> Sub1["Subtarefa 1: Análise de Código"]
    RootTask --> Sub2["Subtarefa 2: Scaffold de Testes"]
    Sub1 --> Sub3["Subtarefa 3: Implementação da Alteração"]
    Sub2 --> Sub3
    Sub3 --> Sub4["Subtarefa 4: Execução da Ladder de Testes"]
    Sub4 --> Sub5["Subtarefa 5: Auditoria e Evidência"]
```

---

## 10. Agent Delegation Graph — Casamento de Capacidades e Carga

O `DelegationEngine` (`packages/orchestrator/src/delegation.ts`) e o `CognitiveLoadBalancerEngine` equilibram o trabalho entre personas:

```mermaid
flowchart TD
    Chief["Chief Planner / Orchestrator"] --> AssessReq["Avaliação de Requisitos da Tarefa"]
    AssessReq --> QueryDelegation["DelegationEngine.getAgentLoad()"]
    QueryDelegation --> MatchPersona{"Casar Perfil e Carga"}

    MatchPersona -->|Arquitetura & Design| Architect["Lead Architect (Carga < 80%)"]
    MatchPersona -->|Implementação| Builder["Builder Agent (Carga < 80%)"]
    MatchPersona -->|Auditoria & Validação| Auditor["Auditor Agent (Read-Only)"]
    MatchPersona -->|Revisão Independente| Reviewer["Reviewer Agent (Read-Only)"]

    Architect --> MakeReservation["DelegationEngine.reserve()"]
    Builder --> MakeReservation
    Auditor --> MakeReservation
    Reviewer --> MakeReservation

    MakeReservation --> TaskExecution["Execução sob Governação"]
    TaskExecution --> ReleaseAgent["DelegationEngine.release()"]
```

---

## 11. Diagnóstico de Integridade dos Grafos

1. **Ciclos Circulares:** ZERO ciclos de dependência circular no grafo de imports direcionado.
2. **Caminhos de Bypass:** O chokepoint de permissão em `plugins/opencode-v2/src/governance.ts` interceta todas as chamadas antes da execução técnica no host.
3. **Invariantes Criptográficas:** Todo o ledger de políticas e assinaturas HMAC são validadas antes de qualquer mutação de estado.
