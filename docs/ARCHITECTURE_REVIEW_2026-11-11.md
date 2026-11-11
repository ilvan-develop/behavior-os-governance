# Revisão de Arquitetura — Behavior-OS (2026-11-11)

> Revisão independente solicitada na missão `mission-1794399469565-4e0d2xusxgv`
> (tipo `audit`, DNA **Open Source**, persona **Security Officer**).
> Método: leitura do código-fonte, medição por comando e confronto com
> `docs/CLAIMS.md`. Nenhum código de produção foi alterado por esta revisão.
> Achados sem evidência executada estão marcados como hipótese.

## 1. Veredito executivo

O Behavior-OS é um projeto maduro em **verificação** e **governança determinística**:
typecheck, lint e a suíte completa passam, o state machine de missão é sólido, a
evidência tem proveniência e o log é encadeado por SHA-256. A arquitetura,
porém, tem uma assimetria central:

> **A superfície cresceu mais rápido que a fundação.** Existem 48 motores e 102
> tools nativas no plugin, mas parte do estado que essas tools produzem não é
> persistida, parte dos motores não é alcançável pelo host, e o caminho de
> enforcement nativo (`permission.evaluate`) não é o mesmo caminho do
> `preflightAction()` que a documentação apresenta como equivalente.

O maior ganho não está em adicionar mais recursos. Está em tornar os recursos
**existentes** duráveis, alcançáveis e verificáveis de ponta a ponta. O roadmap
da seção 7 prioriza exatamente isso.

## 2. Baseline verificado

Comandos executados nesta revisão (Windows, `pnpm` via `cmd /c`):

| Gate              | Resultado                                                                              |
| ----------------- | -------------------------------------------------------------------------------------- |
| `pnpm typecheck`  | 11 tasks, 11 successful, exit 0                                                        |
| `pnpm lint:check` | 486 files checked, no fixes applied, exit 0                                            |
| `pnpm test`       | 8 tasks successful; **1463 passed + 6 skipped** em 131 arquivos                        |
| `bos_run_audit`   | real: `overall: pass`; lint+typecheck passed; `governance` **skipped** (Unknown stage) |
| Distribuição      | core 913, plugin 245, orchestrator 179, mcp 50, schemas 35, cli 22, sdk 15, examples 4 |

Inventário medido (não estimado):

| Item                                    | Número | Evidência                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------- |
| Arquivos em `packages/core/src/engine/` | 50     | 48 motores + `behavior-os.ts` (fachada) + `index.ts` (registro) |
| Tools MCP                               | 98     | `registerTool(` em `packages/mcp-server/src/server.ts`          |
| Resources MCP                           | 2      | `behavioros://protocol/steps`, `behavioros://dna/catalog`       |
| Tools do plugin                         | 102    | 98 do MCP + 4 tools de loop                                     |
| Padrões DNA                             | 21     | `dnas/*.yaml`, validados por Zod                                |
| Linhas da fachada                       | 2757   | `packages/core/src/engine/behavior-os.ts`                       |
| Linhas do plugin                        | 4871   | `plugins/opencode-v2/src/index.ts`                              |
| Linhas do servidor MCP                  | 4828   | `packages/mcp-server/src/server.ts`                             |

## 3. O que está forte (preservar)

- **Evidência com proveniência.** `executed` / `reported` / `simulated`,
  `executionId` obrigatório para executado e `verificationMode: 'executed'` são
  um diferencial real; o `bos_complete_mission` recusa evidência simulada.
- **State machine de missão** com transições declaradas, idempotência e
  `expectedVersion` (`mission-engine.ts`).
- **Trilha tamper-evident** com hash chain e sink JSONL opt-in, incluindo
  detecção de truncatura e lacuna de `seq`.
- **Testes de contrato de host**: 245 casos no plugin, incluindo as 102 tools,
  o hook de permissão e o fluxo de sessão.
- **Fail-safe de identidade**: agente é resolvido pela persona/DNA ou registro,
  nunca pelo nome do modelo.

## 4. Achados por severidade

### P0-1 — O estado nativo é parcialmente efêmero

**Evidência.** `BehaviorOSSnapshot` (`behavior-os.ts:259-282`) persiste apenas
`agentState`, `dna`, `missions`, `learnings`, `learningRecords`, `policyLedger`,
`rolePolicy` e `agents`. `exportState()` (`behavior-os.ts:2748`) confirma a
lista. Ficam de fora:

| Coleção                               | Existe? | Persistida no snapshot? | Persistida no SQLite?                                             |
| ------------------------------------- | ------- | ----------------------- | ----------------------------------------------------------------- |
| Knowledge graph (nós/arestas)         | Sim     | Não                     | Só com `bos_save_memory` / `bos_consolidate_memory`               |
| Regras temporais                      | Sim     | Não                     | Sim, em `meta:temporal-governance-state` (sem hidratação no boot) |
| Dynamic DNA / overrides               | Sim     | Não                     | Não                                                               |
| Decisões (votação/quórum)             | Sim     | Não                     | Tabela `decisions` (MCP), não no snapshot                         |
| Relatórios de auditoria               | Sim     | Não                     | Tabela `audit_log`                                                |
| Pipeline runs                         | Sim     | Não                     | Tabela `pipeline_runs`                                            |
| Métricas                              | Sim     | Não                     | Não                                                               |
| Baseline de anomalia                  | Sim     | Não                     | Não                                                               |
| Memória persistente / meta-decisões   | Sim     | Não                     | `meta:memory:*` quando há store                                   |
| UX comportamental / temporal patterns | Sim     | Não                     | Não                                                               |

**Impacto.** O agente cria conhecimento (`bos_add_knowledge_node`), regras
temporais (`bos_add_temporal_rule`), decisões (`bos_decide`) e auditorias; depois
de um restart do host, a maior parte desaparece. Isso contradiz a expectativa
criada por uma superfície de 102 tools: o recurso existe, mas não é durável.

**Agravante medido.** `recordLearningInGraph()` grava nós/arestas via
`addKnowledgeNode`/`addKnowledgeEdge`, que só tocam o grafo em memória; não
chamam `saveMemory`. Logo, mesmo com SQLite configurado, o grafo de
aprendizagem não sobrevive por padrão.

**Recomendação.** Snapshot v2 com migração de v1, persistindo knowledge graph,
regras temporais, dynamic DNA, decisões, auditorias e pipeline runs; hidratação
correspondente; teste de round-trip por coleção. Alternativa mais barata:
`addKnowledgeNode`/`addKnowledgeEdge` passarem a usar o `PersistentMemoryEngine`
quando houver store.

### P0-2 — Dois caminhos de enforcement divergentes

**Evidência.** A documentação afirma que `preflightAction()` é "a core-level,
host-agnostic equivalent of the OpenCode plugin's permission hook"
(`docs/ARCHITECTURE.md:62-64`). No código:

- O hook nativo chama `bos.evaluateGovernance(...)` e depois
  `bos.bootstrapDenyOverride(...)` (`plugins/opencode-v2/src/index.ts:4360-4405`).
- O hook também avalia políticas de papel **antes** do DNA
  (`evaluateRoleAction`, `index.ts:4342`).
- `preflightAction()` (`behavior-os.ts:816`) corre apenas os gates do
  `PipelineEngine`; o gate `governance` chama `evaluateGovernance` **sem**
  `bootstrapDenyOverride` e **sem** `evaluateRoleAction`
  (`behavior-os.ts:824-870`).

Consequência: para a mesma ação de control plane ou para uma política de papel,
`bos_preflight` e o hook de permissão podem devolver vereditos diferentes — o
oposto de "equivalente". Gates `pre` customizados via `config.pipeline.gates`
também só existem no `preflightAction`, nunca no hook.

**Impacto.** Dois enforcement paths com semânticas distintas são uma fonte
clássica de bypass acidental e de resultados de auditoria inconsistentes.

**Recomendação.** Um único avaliador (função pura) usado por `preflightAction` e
pelo hook: role-policies → DNA → bootstrap carve-out → gates `pre`. Teste de
conformidade com matriz de ações (mutante/read-only/control-plane) provando que
os dois caminhos coincidem.

### P0-3 — Inflação de capacidade: motores que o host não alcança

**Evidência.** Oito motores têm getter na fachada, mas **zero** uso em
`packages/mcp-server`, `plugins/opencode-v2` e `packages/orchestrator`:

`ValueAlignmentEngine`, `ZeroTrustIdentityEngine`, `CounterfactualAuditEngine`,
`ExperientialLearningEngine`, `CrossDnaPipelineTransferEngine`,
`TemporalPatternEngine`, `PipelinePlannerEngine`, `PipelineRecoveryEngine`.

Dois deles também entregam menos do que o nome sugere:

- `zero-trust-identity-engine.ts:37` emite um DID aleatório e um
  `publicKeyHash` derivado de `agentId:did:timestamp` (`:137`), não de uma chave
  real; `verifyIdentity()` (`:70`) compara strings e não verifica assinatura.
- `external-adapter-engine.ts:37` "exporta para SIEM" apenas devolvendo
  `{ exported: logs.length, target, batchId }`; não há I/O de rede.

**Impacto.** O claim "48 motores operacionais" (`docs/CLAIMS.md`) é verdadeiro
no sentido de "existem e têm teste", mas pode ser lido como "enforced". Motores
não ligados nem expostos ampliam a superfície de manutenção e criam risco de
governance theater.

**Recomendação.** Classificar cada motor em `enforced` / `exposed` /
`library-only` / `experimental-retire` e publicar a matriz. Ligar o que for
segurança (identidade, fairness, compliance) ou rebaixar o claim.

### P1-1 — Superfície duplicada e esquemas divergentes

**Evidência.** As 98 tools são implementadas duas vezes: em
`packages/mcp-server/src/server.ts` (Zod `inputSchema`) e em
`plugins/opencode-v2/src/index.ts` (JSON Schema escrito à mão). São 4.828 e
4.871 linhas, respectivamente, com o mesmo catálogo. O plugin ainda mantém 11
tools em `exposed-engines.ts`.

**Impacto.** Toda tool nova exige duas edições e duas descrições; validação,
defaults e mensagens podem divergir sem que nenhum teste perceba (os testes
atuais verificam presença/execução, não paridade de schema). O custo de contexto
e de revisão cresce de forma linear com a superfície.

**Recomendação.** Um manifesto único de capacidades (id, descrição, schema de
entrada, engine, método, nível de enforcement) e geração/validação das duas
superfícies a partir dele. Um teste de CI falha se MCP e plugin divergirem.

### P1-2 — Monolitos e acoplamento

**Evidência.** Fachada com 2.757 linhas e 140+ métodos públicos; plugin com
4.871 linhas e 102 tools registradas dentro de um único `setup()`; servidor MCP
com 4.828 linhas.

**Impacto.** Revisão, merge e teste local ficam caros; o `setup()` é o ponto
onde qualquer regressão de tool pode derrubar todos os hooks. É também o maior
obstáculo para as fases seguintes (manifesto, snapshot v2, paridade SDK).

**Recomendação.** Extrair serviços de domínio da fachada (governance, mission,
learning/memory, policy, collaboration) mantendo a API pública como fachada
fina; extrair as tools do plugin para módulos por domínio com um registro
comum.

### P1-3 — Paridade MCP × plugin incompleta

**Evidência.** O plugin tem 102 tools; o MCP tem 98. As 4 ausentes são
`bos_start_loop` (`index.ts:2636`), `bos_resume_loop` (`:2755`),
`bos_loop_status` (`:2790`) e `bos_approve_loop` (`:2817`). O MCP é a integração
oficial para clientes externos (Claude Code, Cursor, Windsurf, Copilot).

**Impacto.** Orquestração autônoma com evidência executada existe apenas dentro
do OpenCode. Um cliente MCP externo não consegue iniciar, retomar, inspecionar
ou aprovar um loop — justamente os recursos que tornam o BOS "executável", não
apenas consultivo.

**Recomendação.** Expor as 4 tools no MCP (o pacote `orchestrator` já é
independente) ou declarar explicitamente no README/CLAIMS que orquestração é
exclusiva do plugin. A primeira opção é a que mais aumenta a adoção nativa.

### P1-4 — SDK é um espelho parcial da fachada

**Evidência.** `packages/sdk/src/index.ts` expõe 15 métodos (DNA, governance,
quality, audit, lifecycle de missão, learning, status). A fachada tem 140+. Não
há teste de paridade entre `BehaviorOSSDK` e `BehaviorOS`. `docs/SDK.md`
documenta métodos do `BehaviorOS` do core (o quick start importa
`BehaviorOS` do SDK, que é um re-export), o que mascara a diferença.

**Impacto.** Quem usa `BehaviorOSSDK` (o wrapper) não tem acesso a decisões,
brainstorm, conversas, políticas, temporal, knowledge graph, memória, fairness
nem compliance. O SDK vira uma segunda API que pode divergir silenciosamente.

**Recomendação.** Ou o `BehaviorOSSDK` delega a fachada inteira (gerado a partir
de um contrato), ou é removido em favor do re-export. Adicionar teste de
superfície.

### P1-5 — Estágios de auditoria declarados que não existem

**Evidência.** `AuditStageSchema` declara 6 estágios: `lint`, `typecheck`,
`security`, `coverage`, `performance`, `governance`
(`packages/schemas/src/index.ts:484-492`). O `AuditEngine` real implementa
apenas os quatro primeiros; qualquer outro cai no `default` e devolve
`{ status: 'skipped', details: { reason: 'Unknown stage: ...' } }`
(`audit-engine.ts:381`).

Confirmado nesta revisão: `bos_run_audit` com
`stages: ["lint","typecheck","governance"]` devolveu `overall: "pass"` com
2 passed + 1 **skipped** (`Unknown stage: governance`). Ou seja, um pedido
explícito de auditoria de governança não audita nada e ainda assim contribui
para um relatório `pass`.

**Impacto.** Um operador que confia no nome do estágio recebe um falso positivo
estrutural. Como `determineOverall()` só falha em `failed`, `skipped` é
invisível no veredito.

**Recomendação.** Implementar `performance` e `governance` (governance pode
reutilizar `evaluateGovernance`/`verifyAuditTrail`), ou remover os dois do enum
e da doc; e fazer `overall` ser no mínimo `warning` quando um estágio
explicitamente pedido for `skipped`.

### P2-1 — Documentação desatualizada

**Evidência.**

- `docs/ARCHITECTURE.md:154` diz **"Core Engines (11 Total)"** e afirma que
  "these are the only engines that exist"; o código tem **48**.
- `docs/OPENCODE_V2.md:57-60` lista 4 agentes customizados, mas
  `.opencode/agents/` tem 5 (falta `builder`).
- `docs/ARCHITECTURE.md:398` descreve "91 inline + 11 EXPOSED_ENGINES"; a
  contagem de registros é 102, mas a composição interna mudou (há 69
  `tools.add` mais o helper `addJson`), então o número 91 é frágil como
  descrição estrutural.

**Impacto.** Um especialista que lê a doc para avaliar a arquitetura recebe um
mapa errado do sistema. O `docs-consistency.test` não cobre contagem de motores
nem a lista de agentes.

**Recomendação.** Corrigir a doc e adicionar um teste que compare a lista de
arquivos de `engine/` e `.opencode/agents/` com a doc.

### P2-2 — Higiene do repositório

**Evidência.** Há artefatos compilados (`.js`, `.d.ts`, `.map`) dentro de
`packages/core/tests/`, `packages/cli/src/`, `packages/mcp-server/src/` e
`plugins/opencode-v2/tests/`; eles não são rastreados pelo git, mas entram no
`biome check` (486 arquivos) e no escopo de typecheck. Há também um
`packages/test-output.txt` e dezenas de relatórios `.md` obsoletos na raiz
(`FINAL_*`, `IMPLEMENTATION_*`, `typecheck-*.txt`).

**Impacto.** Lint e leitura ficam mais lentos e ruidosos; um artefato velho pode
mascarar o resultado real.

**Recomendação.** Limpar os artefatos, garantir que `dist/`/build os recrie, e
mover relatórios históricos para `docs/archive/` (ou removê-los com registro no
`CHANGELOG`).

### P2-3 — Observabilidade de uso, não só de veredito

**Evidência.** `MetricsEngine` conta `evaluateGovernance`, `decide` e
`recordLearning`; não conta uso por tool, por engine ou por host. Não é possível
responder "quais dos 102 recursos nativos são realmente usados?" a partir do
próprio BOS.

**Impacto.** Sem telemetria de uso, a decisão de expor/reformar/retirar motores
(P0-3) fica baseada em leitura de código, não em comportamento observado.

**Recomendação.** Instrumentar `tool.execute.after` com `tool → count/latency/
deny-rate` e expor `bos_get_metrics` já com esse bloco; manter retenção curta e
sem conteúdo de input.

## 5. Matriz de recursos nativos

Classificação por **uso observado no host** (não por existência de teste):

| Nível             | Significado                               | Exemplos                                                                                                                                      |
| ----------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforced**      | O host aplica automaticamente             | governance/DNA, role-policy, anomaly + dynamic-policy, prediction (advisory), missão                                                          |
| **Exposed**       | Existe tool, o agente decide chamar       | fairness, compliance, temporal, brainstorms, conversas, consenso, policy ledger, code-edit, knowledge graph, memória                          |
| **Library-only**  | Só getter na fachada/testes; host não usa | value-alignment, zero-trust, counterfactual, experiential, cross-dna-pipeline-transfer, temporal-pattern, pipeline-planner, pipeline-recovery |
| **Host-specific** | Só em um host                             | loop tools (plugin), orquestração (orchestrator)                                                                                              |

Leitura da matriz: o BOS tem boa cobertura de **consulta** e de **governança**,
mas cobertura irregular de **execução** e **persistência**. É exatamente aí que
"mais nativo" precisa atuar.

## 6. Riscos e não-objetivos

- **Não** reescrever o core. Os 1463 testes e os invariantes atuais são o ativo
  mais valioso; uma reescrita big-bang trocaria risco conhecido por risco
  desconhecido.
- **Não** aumentar a superfície de tools antes de P0-1/P0-2: mais tools sobre
  estado efêmero ampliam a distância entre promessa e realidade.
- **Não** transformar `zero-trust` em claim de segurança sem chave real. Se não
  houver KMS/assinatura, mantenha como `experimental` e diga isso.
- **Não** usar `deny` de DNA como sandbox. O próprio `docs/OPENCODE_V2.md`
  registra que a política não é uma garantia de sandbox.

## 7. Roadmap recomendado (incremental, com gates)

### Fase 0 — Quick wins (baixo risco, 1 PR)

1. Corrigir `docs/ARCHITECTURE.md` (11 → 48 motores; descrição real da
   composição das 102 tools) e `docs/OPENCODE_V2.md` (adicionar `builder`).
2. Adicionar teste de consistência de inventário: arquivos em `engine/`,
   agentes em `.opencode/agents/`, tools MCP × plugin.
3. Limpar artefatos compilados do source tree e arquivar relatórios históricos.
4. Publicar a matriz de enforcement da seção 5 em `docs/CLAIMS.md`.

**Gate:** `pnpm typecheck`, `pnpm lint:check`, `pnpm test`, `pnpm verify:opencode`.

### Fase 1 — Fundação durável (P0)

1. `BehaviorOSSnapshot` v2 com migração de v1: knowledge graph, regras
   temporais, dynamic DNA, decisões, auditorias e pipeline runs.
2. Hidratação no boot e round-trip por coleção.
3. `addKnowledgeNode`/`addKnowledgeEdge` persistindo via
   `PersistentMemoryEngine` quando houver store.
4. Unificar enforcement: avaliador único para `preflightAction` e hook; teste de
   conformidade com matriz de ações.

**Gate:** os gates da Fase 0 + teste de restart real (export → novo processo →
import) + teste de paridade hook × preflight.

### Fase 2 — Superfície única (P1)

1. Manifesto de capacidades e geração/validação das superfícies MCP e plugin.
2. Extrair tools do plugin por domínio; fachada fina sobre serviços.
3. Expor as 4 tools de loop no MCP (ou documentar a exclusividade).
4. Fechar a lacuna do `BehaviorOSSDK` (delegar ou remover).

**Gate:** teste de paridade MCP × plugin (nomes, schemas, defaults) e
`pnpm smoke:mcp` com as novas tools.

### Fase 3 — Nativo de verdade (P2)

1. Comandos `/policy`, `/fairness`, `/compliance` no control plane.
2. `session.context` enriquecido: gates de qualidade do DNA ativo, status de
   política ativa, aprovação pendente e memória relevante ao prompt.
3. Telemetria de uso por tool em `bos_get_metrics`.
4. Decidir o destino dos 8 motores library-only: ligar, expor ou retirar.

**Gate:** `pnpm verify:all`.

## 8. Critérios de aceitação da próxima missão

- Nenhum motor sem classificação (`enforced`/`exposed`/`library-only`/`retired`).
- Snapshot v2 com round-trip provado para todas as coleções persistidas.
- Hook e `preflightAction` concordam em 100% da matriz de ações testada.
- Nomes, schemas e defaults de tools idênticos entre MCP e plugin (ou diferença
  declarada e testada).
- `docs/CLAIMS.md`, `docs/ARCHITECTURE.md` e `docs/OPENCODE_V2.md` sem
  contradição com `ls`, `grep` e testes.

## 9. Comandos de reprodução

```bash
# inventário
ls packages/core/src/engine/*.ts | wc -l
grep -c "registerTool(" packages/mcp-server/src/server.ts
grep -c "name: 'bos_" plugins/opencode-v2/src/index.ts
ls dnas/*.yaml | wc -l

# baseline
pnpm typecheck
pnpm lint:check
pnpm test

# gates do control plane
pnpm verify:plugin
pnpm smoke:mcp
pnpm verify:opencode
```

## 10. Conclusão

O Behavior-OS já tem os ingredientes de um sistema nativo completo: 48 motores,
21 padrões, 102 tools, hooks, orquestrador real e evidência com proveniência. O
que falta é **coesão**: um estado durável, um único caminho de enforcement, uma
única fonte de superfície e uma classificação honesta do que cada motor entrega.
Fazer essas quatro coisas vale mais, para adoção e confiança, do que adicionar o
próximo motor.

## 11. Atualização — remediação implementada (2026-11-11)

Depois desta revisão, a Fase 0 e parte da Fase 1 foram implementadas e verificadas:

- **Snapshot v2.** `knowledgeGraph` (nós/arestas) e `temporalRules` passam a fazer
  parte de `BehaviorOSSnapshot`; snapshots v1 continuam legíveis; o merge entre
  instâncias faz união por `id`; o SQLite hidrata `temporal-governance-state`.
  Provas: `persistence.test.ts` (round-trip v2 + import v1) e
  `storage-sync.test.ts` (união de grafo e regras).
- **Enforcement alinhado.** O gate `governance` do pipeline aplica políticas de
  role antes do DNA para ações mutantes fora do control plane e o mesmo
  `bootstrapDenyOverride`; `deploy`/`publish`/`release` passam a contar como
  mutantes. Provas: `pipeline-engine.test.ts` e `facade-host-logic.test.ts`.
- **Documentação.** `ARCHITECTURE.md` passou de 11 para 48 motores,
  `OPENCODE_V2.md` inclui o agente `builder`, `CLAIMS.md` ganhou as afirmações de
  snapshot v2/preflight e as contagens foram remedidas (1480 casos, 40/40
  invariantes).

- **Manifesto de capacidades.** `docs/analysis/capabilities.json` é gerado de
  MCP, plugin, `dnas/`, `engine/` e SQLite; `pnpm verify:capabilities` falha com
  diff nominal quando está stale (provado com remoção de `bos_whoami` e contagem
  de motores: exit 1 e, depois de regenerar, PASS).

- **Estágios de auditoria.** `performance` (orçamento sobre o `build`) e
  `governance` (script do projeto) passaram a ser estágios reais; sem script
  reportam `skipped` com motivo, em vez de `Unknown stage`. Provas:
  `audit-engine-real.test.ts` (4 casos).

Baseline pós-mudança: `pnpm typecheck` 11/11, `pnpm lint:check` 486 arquivos,
`pnpm test` **1474 passed + 6 skipped** (1480), `pnpm build` 8/8,
`pnpm verify:plugin` 102 tools, `pnpm verify:governance` 25/25,
`pnpm smoke:mcp` 98 tools + 2 resources, `pnpm verify:opencode` 40/40.

Em aberto (Fases 2–3): decomposição dos monolitos, classificação `library-only` dos 8 motores e telemetria de uso por tool.
