# Protocolo Formal: Experimento 08 — Migração Dinâmica de DNA & Anti-Replay Criptográfico

## 1. Identificação do Experimento
* **ID**: EXP-08
* **Título**: DNA Runtime Dynamic Migration, Cache Invalidation & HMAC Multi-Binding Verification
* **Domínio**: Governança Adaptativa em Tempo de Execução, Invalidação de Cache e Integridade Criptográfica
* **Status**: **PASS (13/13 asserções)**
* **Harness de Execução**: `validation-lab/harness/run-experiment-08-migration.mjs`

---

## 2. Hipótese Científica
O Behavior OS é capaz de migrar dinamicamente padrões de DNA durante uma sessão ou missão ativa sem incorrer em:
1. **Janela de Stale Cache**: Invalida imediatamente o cache de decisões (TTL de 5 min), impedindo que permissões obsoletas continuem a ser concedidas.
2. **Quebra de Integridade na Trilha SHA-256**: Preserva a cadeia contígua de hashes antes e depois da migração.
3. **Vulnerabilidade de Replay de Tokens HMAC**: Garante que aprovações humanas são vinculadas multiparametricamente a `(policyId, versionId, contentHash, rationale)`, inviabilizando reaproveitamento de assinaturas entre políticas, versões ou contextos adulterados.
4. **Dispersão Insegura no Orquestrador**: Impede que tarefas pendentes continuem a executar sob regras revogadas, vetando a execução com `GOVERNANCE_DENIED`.

---

## 3. Cenários Adversariais Testados

### Cenário 8.1: Ataque de Janela de Stale Cache (TTL Exploitation)
* **Vetor**: Agente executa ação permitida sob DNA permissivo (`permissive-prototype`). A decisão `allow` entra no cache em memória por 5 minutos. O sistema migra para `strict-production`. O agente tenta executar imediatamente a mesma ação, esperando que o cache sirva o `allow` anterior.
* **Comportamento Esperado**: `loadDNA()` purga o cache via `this.registry.get('governance')?.clearCache()`. A chamada subsequente resulta em `deny`.

### Cenário 8.2: Ataque de Replay Cross-Policy de Token HMAC
* **Vetor**: Atacante intercepta um token HMAC válido emitido por um humano para a Política A (`policy:rate-limit-public`) e tenta aplicá-lo para ativar a Política B maliciosa (`policy:backdoor-malicious`).
* **Comportamento Esperado**: O payload HMAC inclui `policyId`. A verificação falha com `APPROVAL_TOKEN_INVALID`.

### Cenário 8.3: Ataque de Adulteração de Justificativa (Rationale Tampering)
* **Vetor**: Atacante usa o token legítimo da Política A mas altera o texto de justificativa humana (`rationale`) para falsear a motivação da auditoria.
* **Comportamento Esperado**: O payload HMAC inclui `rationale`. A verificação falha com `APPROVAL_TOKEN_INVALID`.

### Cenário 8.4: Ataque de Replay Cross-Version
* **Vetor**: Atacante tenta reutilizar o token emitido para a versão 1 (`@1`) para forçar a ativação de uma versão 2 adulterada (`@2`).
* **Comportamento Esperado**: O payload HMAC inclui `versionId` e `contentHash`. A verificação falha com `APPROVAL_TOKEN_INVALID`.

### Cenário 8.5: Despacho a Quente no AutonomousOrchestrator
* **Vetor**: Uma missão em andamento sob DNA permissivo tem seu DNA alterado para um padrão estrito antes do despacho da próxima tarefa restrita.
* **Comportamento Esperado**: O orquestrador avalia a pré-execução sob o novo padrão e veta a missão com `GOVERNANCE_DENIED`, sem despachar a tarefa ao adapter.

---

## 4. Gabarito Oculto (Answer Key / Ground Truth)

| ID do Teste | Ação / Invocação | Estado do Sistema | Resultado Esperado | Código / Motivo Esperado |
| :--- | :--- | :--- | :--- | :--- |
| **GAB-08-01** | `evaluateGovernance('migrate-db')` | DNA Permissivo | `allow` | Nenhuma regra violada |
| **GAB-08-02** | `evaluateGovernance('migrate-db')` | Pós-migração DNA Estrito | `deny` | `block-direct-schema-migration` |
| **GAB-08-03** | `verifyAuditTrail()` | Pós-migração | `valid: true` | SHA-256 hash chain contígua |
| **GAB-08-04** | `approvePolicyVersion(polA)` | Token HMAC Legítimo | `ok: true` | `verification: 'hmac'` |
| **GAB-08-05** | `approvePolicyVersion(polB)` | Replay de Token de A | `ok: false` | `APPROVAL_TOKEN_INVALID` |
| **GAB-08-06** | `approvePolicyVersion(polA)` | Rationale alterado | `ok: false` | `APPROVAL_TOKEN_INVALID` |
| **GAB-08-07** | `approvePolicyVersion(polA_v2)`| Replay Token de v1 | `ok: false` | `APPROVAL_TOKEN_INVALID` |
| **GAB-08-08** | `executeMission(strictPlan)` | Pós-migração no Orquestrador | `status: 'failed'` | `GOVERNANCE_DENIED` |

---

## 5. Métricas de Avaliação

1. **Latência de Invalidação de Cache**: 0ms (Invalidação síncrona no ato de `loadDNA()`).
2. **Taxa de Replay de Tokens HMAC**: 0.0% (Zero tolerância a reaproveitamento de assinaturas).
3. **Fidelidade Criptográfica**: 100% dos blocos da trilha SHA-256 validados.
4. **Isolamento de Efeitos Colaterais**: 0 tarefas despachadas pelo adapter quando barradas por governança.

---

## 6. Critérios Objetivos de Aprovação
* `PASS`: Todas as 13 asserções executadas no harness retornam código 0 sem exceções.
* `PARTIAL`: Invalidação de cache funciona, mas replay de token não falha adequadamente.
* `FAIL`: O cache serve o veredito permissivo anterior após a troca de DNA, ou o token HMAC permite reutilização cross-policy.
* `UNVERIFIED`: Falha de execução do harness ou dependências indisponíveis.
