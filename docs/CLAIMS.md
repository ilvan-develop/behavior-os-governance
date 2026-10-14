# CLAIMS — Verificação de afirmações (Behavior-OS)

> Documento único de verdade. Cada afirmação pública é cruzada com o código.
> Nada aqui é aspiracional: ou está **verificado**, ou está **retirado** com o
> valor real medido ao lado. Ver `pnpm test` / `pnpm typecheck` / `pnpm lint`
> para o resultado vivo e `git log` para a data da última medição.

## Como verificar (comandos)

```bash
# Motores reais: 13 ficheiros = 11 motores + fachada (behavior-os.ts) + registo (index.ts)
# Esperado: audit, behavior-os, code-edit, decision, dna-loader, drift, governance,
#           index, learning, mission, pipeline, quality, recommendation
ls packages/core/src/engine/*.ts

# Linhas por motor (números reais, não marketing)
wc -l packages/core/src/engine/*.ts

# Tools MCP (esperado: 27) e resources (esperado: 2)
grep -c "registerTool(" packages/mcp-server/src/server.ts
grep -c "registerResource(" packages/mcp-server/src/server.ts

# Tools do plugin OpenCode (esperado: 29)
grep -c "name: 'bos_" plugins/opencode-v2/src/index.ts

# Ficheiros DNA (esperado: 21)
ls dnas/*.yaml | wc -l

# Schemas Zod (esperado: 31 objetos, 25 enums)
grep -c "z.object(" packages/schemas/src/index.ts
grep -c "z.enum(" packages/schemas/src/index.ts

# Tabelas SQLite (esperado: 9)
grep -c "CREATE TABLE" packages/core/src/persistence/sqlite-store.ts

# Testes (esperado: 51 ficheiros / 521 casos) — `pnpm test` para o resultado vivo
ls packages/*/tests/*.test.ts plugins/opencode-v2/tests/*.test.ts

# Cada DNA tem de passar o DNASchema (22 casos: 1 lista + 21 padrões)
pnpm --filter @behavior-os/core exec vitest run tests/dnas.test.ts

# Guarda transversal: docs/regras não podem citar tools, comandos CLI, scripts
# `pnpm`, métodos de `BehaviorOS` ou variáveis de ambiente que não existam (9 casos)
pnpm --filter @behavior-os/core exec vitest run tests/docs-consistency.test.ts

# SQLite (esperado: >= 1 ficheiro no código)
grep -ri "sqlite" packages plugins --include=*.ts

# Persistência plugável (esperado: store.ts, sqlite-store.ts, postgres-store.ts)
ls packages/core/src/persistence/*.ts

# Postgres é opcional (esperado: 0 imports estáticos de "pg")
grep -n "from 'pg'" packages/core/src/persistence/postgres-store.ts

# Código só é escrito com opt-in + apply:true (esperado: 1 motor com esta trava)
grep -n "codeEdit" packages/core/src/engine/behavior-os.ts
```

## Afirmações verificadas

| Afirmação | Realidade verificada |
|---|---|
| **11 motores operacionais** | 13 ficheiros em `engine/` = 11 motores + fachada `BehaviorOS` + `EngineRegistry`: audit (192 linhas), code-edit (267), decision (107), dna-loader (40), drift (117), governance (147), learning (209), mission (111), pipeline (161), quality (96), recommendation (107). |
| 29 schemas Zod | **31** `z.object` + **25** `z.enum` (medido, não estimado). |
| Camada de decisão (votação/quorum) | `decision-engine.ts`: políticas `majority`/`supermajority`/`unanimous`, quorum, votos com peso; persistida na tabela `decisions`. Tool `bos_decide`. |
| 21 padrões DNA | 21 ficheiros YAML em `dnas/`, validados por Zod (`DNALoader`). |
| Recomendações scoreadas | `recommendation-engine.ts` + `bos_recommendations` (MCP e plugin). Ver secção abaixo. |
| Drift entre padrões DNA | `drift-engine.ts` + `bos_drift`, que resolve padrões **por nome** e compara regras/gates por `id` **incluindo mudanças de corpo com o mesmo `id`**. Ver secção abaixo. |
| Auto-evolução do DNA (opt-in) | `proposeEvolution()` propõe mudanças com confiança ≥ 0,8. Aplicam-se só com `evolution.enabled` **e** `apply: true`; só acrescentam regras `warn`. Tool `bos_evolution`. |
| Propostas de correção de código | `proposeCodeFixes()` (leitura pura) + `applyCodeFixes()` (3 travas: opt-in, `apply:true`, votos). As rejeições por votação **ficam persistidas** com `applied: false`, o padrão e a confiança. |
| Camada de edição de código governada | `CodeEditEngine` (267 linhas) + `BehaviorOS.applyCodeEdit()`. Ver secção abaixo. |
| Persistência SQLite sem dependências | `SqliteStore` usa o módulo embutido `node:sqlite` (Node ≥ 22.5) e cria **9** tabelas. Ver secção abaixo. |
| Trilho de auditoria tamper-evident | Hash-chain SHA-256 (`bos_verify_audit_trail`) **mais** sink append-only durável opt-in que deteta truncatura, lacuna de `seq` e adulteração. Não é WORM (ver "Afirmações retiradas"). |
| Gate pipeline pré-execução | `preflightAction()` corre gates `pre` bloqueantes de forma síncrona. Ver secção abaixo. |
| Protocolo de 7 passos | `PROTOCOL_STEP_COUNT = 7`; a progressão vive em `AgentState.stepHistory` e é injetada na sessão de cada host. |
| MCP real (não vaporware) | **27 tools + 2 resources** em `packages/mcp-server/src/server.ts`, com o teste `registers exactly 27 tools` a falhar se a contagem derivar. |

## Afirmações retiradas ou corrigidas

Cada linha é uma afirmação do material antigo que **não** correspondia ao código.
Nenhuma é item pendente: a afirmação foi retirada e substituída pelo valor real,
medido com `wc -l`.

| Afirmação antiga | O que o código diz |
|---|---|
| GovernanceEngine com 609 linhas | **147** linhas (`governance-engine.ts`). |
| QualityEngine com 618 linhas | **96** linhas (`quality-engine.ts`). |
| AuditEngine com 1347 linhas | **192** linhas (`audit-engine.ts`). |
| PipelineEngine com 657 linhas | **161** linhas (`pipeline-engine.ts`). O número original não tinha qualquer relação com o ficheiro. |
| 9 camadas de validação (runtime) | **Retirada.** O pipeline é configurável e o default é 1 gate `pre` (`governance`) + N gates `post` (N = gates de qualidade do DNA ativo). Não existe um conjunto fixo de "9 camadas". |
| 30 tools & 7 resources MCP | **27 tools + 2 resources** no servidor MCP; **29 tools** no plugin OpenCode (as restantes duas são específicas do host). |
| "8 tabelas" (métrica antiga de persistência) | **9** tabelas: `missions`, `learnings`, `agents`, `audit_log`, `pipeline_runs`, `decisions`, `code_fix_results`, `code_edits`, `meta`. |
| "Trilho de auditoria imutável" | Imutabilidade é um requisito de **armazenamento físico** (WORM), não de software. O que existe é deteção: hash-chain SHA-256 + sink append-only opt-in por ficheiro. Ver a secção "Cadeia de auditoria". |
| "Learning engine não aplica correções automaticamente" | Já aplica, mas só com `config.codeEdit.enabled` **e** `apply: true` na chamada, `find` único, ficheiro dentro do workspace e (se houver votos) quórum aprovado. Sem isso, é sempre dry-run. |
| Regras de protocolo "Display DNA Block" / "Resolve Truth" / "Delegate" | Retirado. Os passos são `PROTOCOL_STEPS` (`bos_select_dna`, `bos_list_dna`, `bos_get_state`, `bos_create_mission`, `bos_start_mission`, `bos_run_audit`, `bos_record_learning`). O texto do resource MCP `behavioros://protocol/steps` dizia outra coisa e foi corrigido; e uma vez que o texto é agora gerado a partir dessa constante (e o plugin reexporta-a), MCP, plugin e docs já não conseguem divergir no nome dos passos. |
| Tools `bos_resolve_truth`, `bos_display_dna`, `bos_validate_dna`, `bos_get_patterns`, `bos_get_dna_pattern`, `bos_complete_mission`, `bos_fail_mission`, `bos_get_mission`, `bos_get_audit_report`, `bos_list_dna_patterns` | **Não existem.** Estavam citadas em `docs/API_REFERENCE.md`, `.cursor/rules/*.mdc`, `.windsurfrules` e `.github/copilot-instructions.md`; foram retiradas. Um teste (`docs-consistency.test.ts`) falha se voltarem a aparecer em documentação atual. |
| `bos_list_missions` com filtros `status` / `type` / `priority` | Os filtros eram anunciados no schema e **ignorados** no handler; passaram a ser aplicados de facto (sobre a lista do motor, antes do `limit`). |
| CLI "corre a governança" em `compile`/`validate`/`simulate`/`status`/`deploy`/`agent` | Cinco comandos imprimiam resultados fabricados. Agora: `compile`/`validate` carregam os YAML com `DNALoader`/`DNASchema` (exit 1 se falharem); `status`/`simulate`/`deploy`/`autonomous` resolvem o DNA ativo (`BEHAVIOROS_DNA_PATH` → `dnas/<padrão>.yaml`); `simulate` chama `evaluateGovernance()` real; `deploy` imprime o plano de gates do DNA e o resultado real de `preflightAction()`; `protocol` conta os passos presentes em `AgentState.stepHistory`. |
| "`behavioros deploy` faz o deployment" | **Não faz.** Imprime o plano de gates e o resultado do pre-flight bloqueante (exit 1 se bloqueado) e não corre gates `post` nem publica artefactos. Ver "Limitações abertas". |
| "`pnpm benchmark` mede a performance" | Script removido do `package.json`: o alvo (`scripts/benchmark.*`) não existe. Os números de performance são **alvos de desenho**, não medições. |
| Workspace com `apps/*` | Removido de `pnpm-workspace.yaml` — a pasta não existe e o glob não apanhava nada. |
| Script `test` do `@behavior-os/orchestrator` | Removido: era um `echo` (nenhum teste corria). O pacote não tem suite; está declarado abaixo. |
| `behavioros init` gera `.mcp.json` a apontar para `mcp-server/dist/server.js` | O caminho não era válido a partir da raiz do projeto. Passa a `join(__dirname, '..', '..', 'mcp-server', 'dist', 'server.js')`. |
| Códigos de saída `2`/`3` da CLI | **Não existem.** A CLI usa apenas `0` e `1` (documentado em `docs/CLI.md`). |
| Variáveis `BEHAVIOROS_PROJECT`, `BEHAVIOROS_LOG_LEVEL`, `BEHAVIOROS_STATE_DIR` | **Nenhum código as lê.** `BEHAVIOROS_LOG_LEVEL` ainda era *definida* no `Dockerfile`, no `docker-compose.yml` e em `scripts/smoke-mcp.mjs` — ninguém a consumia; foi removida desses três sítios. A CLI lê `BEHAVIOROS_DNA_PATH`, o plugin `BEHAVIOR_*` e o MCP `BEHAVIOROS_*`. |
| `EXPOSE 3000` no `Dockerfile` ("MCP server port, if using HTTP transport") | O servidor MCP é **stdio** (zero referências a HTTP/`listen`/SSE no código). `EXPOSE` removido, assim como o mapeamento `3000:3000` do `docker-compose.yml`. |
| `Dockerfile` a instalar o workspace sem o `packages/orchestrator/package.json` | O `pnpm install --frozen-lockfile` via um grafo de workspace diferente do lockfile. O `COPY` do pacote foi adicionado. |
| `templates/.agent_state.json.example` e `.agent_state.example.json` (duplicados) | Dois exemplos idênticos, sem referências no código, com o nome **antigo** do ficheiro de estado (o real é `.behavioros/state.json`). Consolidados num só, com o nome correto: `.behavioros/state.example.json`; a pasta `templates/` foi removida. |
| `CONTRIBUTING.md` dizia `Register in packages/dnas/src/index.ts`, `src/tools/<category>/`, `schemas/src/mcp.ts`, `tests/dna/` | Nenhum desses caminhos existe. Substituídos pelos reais (`server.ts`, `schemas/src/index.ts`, `tests/*.test.ts`). |
| Script de raiz `cli:init` = `pnpm --filter @behavior-os/cli run init` | O pacote CLI não tem script `init` (o comando falhava). Agora `node packages/cli/dist/cli.js init`; um teste novo (`docs-consistency.test.ts`) valida delegações `pnpm --filter <pkg> run <script>`. |
| `GUIDE.md`/`docs/SDK.md`: `evaluateQuality()`, `getAgentState(): AgentMetrics`, `.mcp.json` com `dist/mcp-server.js`, Cursor com `serverUrl` HTTP, `opencode.json` com bloco `plugins` | Tudo falso. Nomes/tipos reais: `checkQuality()`, `getAgentState(): AgentState`; MCP é stdio (sem HTTP); o plugin é descoberto em `.opencode/plugins/`. Corrigido. |
| "45+ tools MCP", "5.200+ testes", "12 padrões DNA", "22 engines" nas regras de editor | Retirado: 27 tools + 2 resources, 21 padrões, 11 motores. As contagens vivem em `docs/CLAIMS.md`. |
| `plugins/opencode-v2/tests/plugin-basic.test.ts` ("OpenCode Plugin Structure") | O ficheiro assertava literais escritos à mão e **não importava o plugin**: passava mesmo que o plugin divergisse. Reescrito para importar o export real (`PROTOCOL_STEPS`) e ler `dnas/`. |
| `.behavioros/README.md` "regenerado automaticamente" com `${STEP_2_STATUS}` | Nada o regenera e os placeholders nunca eram substituídos. Passou a documento estático com o mapa real dos passos e dos ficheiros de estado. |
| `@behavior-os/mcp-server` `package.json`: `"description": "... 11 tools ..."` | O manifesto publicável anunciava **11** tools; o servidor regista **27**. Corrigido para "27 tools and 2 resources", com um teste (`mcp.test.ts`) que falha se o número deixar de bater com os `registerTool(` reais. |
| Nomes dos 7 passos divergiam entre superfícies de código | O plugin servia "Delegate" para o passo 5 (`bos_start_mission`) enquanto o resource MCP `behavioros://protocol/steps` servia "Start Mission" — e o comentário do próprio plugin dizia que evitava "a copied literal" sendo ele a cópia. Agora existe **uma** definição, `PROTOCOL_STEPS` em `packages/core/src/engine/behavior-os.ts`; o resource MCP é **gerado** a partir dela e o plugin reexporta-a, pelo que a divergência deixou de ser possível por construção. `PROTOCOL_TOOL_STEPS` e `PROTOCOL_STEP_COUNT` passaram a ser derivados. |
| `PROTOCOL_STEP_COUNT` documentado como "0-based index into this list" | A lista não existia: o valor era o literal `7`. Agora é `PROTOCOL_STEPS.length` e a lista existe (validada contra `ProtocolStepSchema` em `protocol-steps-catalog.test.ts`). |
| `scripts/count-tests.mjs` | Removido: nada o corria (nem `package.json`, nem CI), contava testes por regex (o que contradiz o número medido pelo vitest), tinha ramos só do Jest (`xit`/`xtest`), deixava `fileDetails` com Promises por resolver e uma função morta. Uma segunda contagem divergente é uma fonte de afirmações falsas. |

## Gate pipeline

`PipelineEngine` (`packages/core/src/engine/pipeline-engine.ts`) corre uma lista
ordenada de gates de forma síncrona. Um gate é
`{ id, phase, blocking, evaluate }`; um gate **bloqueante** que devolve `failed`
interrompe o run e bloqueia a ação.

- `preflightAction(action, ctx)` corre **apenas** os gates `pre` →
  `{ allowed, blockedBy, run }`. É um veto real, antes da execução, que qualquer
  host pode chamar (o servidor MCP expõe-no como `bos_preflight`), não só o
  plugin do OpenCode.
- `runPipeline(context)` corre `pre` + `post` e persiste o run.
- Gates por omissão: `governance` (pre, bloqueante) + um `quality:<id>` por gate
  de qualidade do DNA (post, bloqueante). Passar `pipeline.gates` substitui-os;
  `pipeline.enabled: false` deixa uma pass-through.
- Pre-flights bloqueados e runs completos ficam na tabela `pipeline_runs`.

Nota de desenho: os gates são síncronos e in-process. Não há execução
distribuída — e o nome "9 camadas" foi retirado em vez de fabricado.

## Cadeia de auditoria (tamper-evidence)

O log de governança (`plugins/opencode-v2/src/governance-log.ts`) é uma cadeia
SHA-256: cada entrada inclui `prevHash` e um `hash` calculado sobre o conteúdo.
`verifyGovernanceLog()` recalcula a cadeia e devolve também `complete` (a janela
em memória é um ring buffer) e continuidade de `seq`.

Para sobreviver a um restart — e para tornar a verificação independente do
processo — existe um **sink append-only opt-in** por ficheiro JSONL
(`BEHAVIOR_OS_AUDIT_LOG`):

- `initGovernanceLogSink` re-semeia a memória a partir do ficheiro; a partir daí
  o ficheiro é a fonte de verdade entre reinícios;
- `verifyGovernanceLogFile` deteta **truncatura** (linha final cortada),
  **lacunas de `seq`** (entradas removidas) e **adulteração** (recomputação do
  hash discorda), reportando o `seq` ofensivo;
- falhas de escrita são contadas, não lançadas: um sink partido nunca derruba
  uma decisão de governança.

O que isto é: deteção de manipulação (tamper-evident) + histórico durável
append-only. O que **não** é: armazenamento WORM/imutável por hardware, nem
proteção contra alguém com acesso de escrita ao ficheiro que decida reescrever
o histórico inteiro (nesse caso a hash-chain não tem âncora externa).

## Camada de edição de código governada

`CodeEditEngine` (`packages/core/src/engine/code-edit-engine.ts`) é o único
módulo do projeto que escreve em ficheiros, e foi desenhado para que uma
proposta errada não faça dano:

| Guarda | Comportamento |
|---|---|
| Dry-run por omissão | `preview()` calcula conteúdo, `sha256:` antes/depois, tamanho e um diff unificado; o ficheiro **não** é tocado. |
| Confinamento ao workspace | O caminho é resolvido e passado por `realpath`; fora da raiz (via `../` ou symlink) é recusado. |
| Allowlist de extensões | 30 extensões de texto; um lockfile, um binário ou uma chave não são editáveis. |
| `find` exato | O texto tem de ocorrer **exatamente uma vez**; 0 ou 2+ ocorrências falham. |
| Limite de tamanho | 1 MiB por omissão. |
| Bloqueio otimista | `expectedBeforeHash` desatualizado → erro, em vez de sobrescrever. |
| Escrita atómica | Ficheiro temporário na mesma pasta + `rename`. |

`BehaviorOS.applyCodeEdit()` aplica as quatro travas, por ordem:

1. guardas do motor (acima) — falha devolve `error`, não escreve;
2. `apply: true` — sem isto é **dry-run** (`reason: 'dry-run'`);
3. `config.codeEdit.enabled === true` — sem isto, `reason: 'opt-in-disabled'`;
4. se houver `votes`, têm de ser **aprovados** pelo `DecisionEngine`
   (`reason: 'vote-rejected'`).

**Tudo é registado**, incluindo dry-runs e recusas: cada avaliação válida é
persistida em `code_edits` (tabela SQLite) com `file`, `beforeHash`,
`afterHash`, `bytesBefore/After`, `addedLines`, `removedLines`, `occurrences`,
`applied`, `reason`, `agentId`, `dnaPattern`, `voteOutcome`/`voteTally` e
`missionId`. `bos_list_code_edits` (MCP e plugin) lê esse histórico — o que faz
do "não há histórico versionado de propostas rejeitadas" uma frase antiga.

Atribuição: o registo usa a identidade governada (`resolveAgentIdentity()`), ou
seja o agente registado → o id explícito → a persona da DNA
(`persona:<role>`) → `unassigned`. **Nunca** o nome do modelo do host.

Ativação por ambiente: `BEHAVIOR_OS_CODE_EDIT=true` (plugin) /
`BEHAVIOROS_CODE_EDIT=true` (MCP), e `*_CODE_EDIT_ROOT` para limitar a árvore.
O motor aceita `new BehaviorOS({ codeEdit: { enabled, root, extensions } })`.

Fronteira assumida: é uma substituição textual única por ficheiro. Não há
refactor estrutural (AST/AST-level), nem multi-ficheiro, nem análise estática —
para isso a proposta é entregue ao agente, que a executa com as ferramentas do
host (governadas pelo mesmo hook de permissão).

## Aprendizagem e evolução de DNA

```
confiança = min(1, ocorrências / 5) * 0.6 + pesoDeImpactoMédio * 0.4
pesos de impacto: low 0.25 · medium 0.5 · high 0.75 · critical 1
```

`proposeEvolution(dnaName, minConfidence = 0.8)` devolve propostas **puras**
(não muta nada) para padrões `failure`/`fix` que atinjam o limiar.

Aplicação — três travas independentes, todas necessárias:

1. `config.evolution.enabled === true`;
2. a chamada passa explicitamente `apply: true`;
3. se forem fornecidos `votes`, a alteração tem de ser **aprovada**.

A única alteração possível é acrescentar uma regra `warn` com a condição
`{ type: 'pattern', value: <tipo> }`; como `warn` nunca altera o veredicto, uma
proposta aplicada nunca bloqueia uma ação. Cada aplicação gera um evento de
aprendizagem com `source: 'dna-evolution'`.

`applyCodeFixes()` segue as mesmas travas e acrescenta: propostas **rejeitadas
por votação** ficam persistidas em `code_fix_results` com `applied: false`,
`pattern`, `confidence`, `voteOutcome` e `voteTally`. Só registos com
`applied: true` bloqueiam uma re-aplicação do mesmo padrão — uma proposta
rejeitada uma vez pode ser aprovada depois.

Limites assumidos (não são afirmações falsas): só `failure`/`fix` geram
propostas; não há mineração de texto (LLM/NLP); a evolução só acrescenta regras
`warn` — nunca remove nem bloqueia.

## Motor de decisão (votação/quorum)

- políticas: `majority` (default), `supermajority` (≥ 2/3), `unanimous`;
- `quorum` = peso participante mínimo (aprovações + rejeições + abstenções),
  default 1;
- pesos por votante (negativos → 0); abstenções contam para o quórum mas nunca
  aprovam sozinhas; empate e "tudo abstenção" → `rejected` (fail-safe);
- `BehaviorOS.decide()` aplica os defaults de config e persiste na tabela
  `decisions` (MCP: `bos_decide`).

Fronteira: é contagem/voto determinístico in-process — não há consenso
distribuído (Raft/Paxos) nem delegação entre agentes.

## Recomendações (`RecommendationEngine`)

```
score = 0.4 * recência + 0.3 * frequência + 0.3 * impacto
recência   = max(0, 1 - idade_horas / 72)
frequência = min(1, n_eventos / 5)
impacto    = média(peso) / 4        (low=1 … critical=4)
```

`BehaviorOS.recommend(limit, ageLimitHours)` agrupa por tipo, ordena por score e
devolve até `limit` itens (default 5, janela 168 h). MCP: `bos_recommendations`.

Fronteira: agrega **por tipo de evento** (uma recomendação por tipo), não por
padrão individual nem por ficheiro; o texto é determinístico (template), sem
LLM; não há recomendações persistidas.

## Drift entre DNAs (`DriftEngine`)

`compare()` devolve a diferença simétrica de regras e gates:

- `rulesAdded` / `rulesRemoved` — ids presentes num só lado;
- `rulesChanged` / `gatesChanged` — ids presentes nos dois lados com **corpo
  diferente** (ex.: `warn` → `block`, ou threshold 80 → 90);
- `totalChanges` = soma dos quatro tipos; **significativo** quando ≥ 2.

O corpo é comparado estruturalmente (chaves ordenadas), pelo que uma regra
re-serializada com outra ordem de chaves **não** conta como drift.

## Persistência plugável (SQLite / Postgres)

`Store` (`packages/core/src/persistence/store.ts`) é o contrato **síncrono** que
o `BehaviorOS` usa. Implementações:

- `SqliteStore` — default, `node:sqlite`, zero dependências externas, **9**
  tabelas: `missions`, `learnings`, `agents`, `audit_log`, `pipeline_runs`,
  `decisions`, `code_fix_results`, `code_edits`, `meta`;
- `PostgresStore` — opcional, uma tabela `behavior_os_documents` com
  discriminador `kind`; o driver `pg` é resolvido via `createRequire` **apenas**
  em `connect()`, pelo que não é dependência do pacote.

Injeção: `new BehaviorOS({ persistence: { store } })` (o `store` tem precedência
sobre `path`). Sem store, tudo funciona em memória e
`listCodeEdits()`/`listCodeFixResults()` devolvem `[]`.

Consistência forte para escritores: `PostgresStore.withTransaction(fn)` faz
`BEGIN` / `COMMIT` / `ROLLBACK` numa conexão dedicada e atualiza o espelho
somente após o COMMIT, pelo que um leitor concorrente vê todas as mudanças ou
nenhuma. O `BehaviorOS.persistAll()` invoca automaticamente `withTransaction`.

Limitações honestas do `PostgresStore`:

- é um **espelho em memória + write-through assíncrono**: leituras normais
  (fora de `withTransaction`) servem o espelho;
- para garantir atomicidade de leitura, o leitor deve chamar
  `await store.flush()` depois de operações escritoras;
- o `pg` **não** é dependência declarada: quem usa o adaptador instala-o
  (`pnpm add pg`) ou injeta o seu `createPool`.

## Fronteiras de desenho e limitações abertas

Todas as afirmações do material público (README, PITCH, ARCHITECTURE,
CONTINUOUS_IMPROVEMENTS, regras de editor) foram cruzadas com o código. As que
não correspondiam foram **retiradas** e substituídas pelo valor medido — ver a
tabela acima.

O que resta divide-se em duas categorias, ambas declaradas para que nenhuma seja
confundida com marketing nem com defeito escondido.

### Fronteiras de desenho (não são defeitos)

- **WORM físico**: imutabilidade por hardware é um requisito de infraestrutura.
  O software entrega deteção (hash-chain + verificação por `seq`).
- **Consenso distribuído**: a votação é in-process; não há Raft/Paxos nem
  delegação entre processos.
- **Gates distribuídos**: o pipeline é síncrono no processo do host.
- **Reprodução de Postgres em CI**: o adaptador é testado com um *pool* falso;
  não há servidor Postgres nos testes.
- **Análise estática/NLP**: as propostas de evolução e de correção vêm de
  eventos de aprendizagem; a edição de código é substituição textual única.

### Limitações abertas (medidas, ainda **não** fechadas)

Lacunas reais que continuam abertas. Não são afirmações falsas: são ausências, e
por isso são listadas em vez de corrigidas por texto.

| # | Limitação | Estado medido |
|---|---|---|
| C1 | `deploy` sem deployment | Imprime o plano de gates do DNA e corre o pre-flight bloqueante, mas não executa gates `post` nem publica artefactos. |
| C2 | Sem rate limiting no servidor MCP | Nenhuma tool tem limite de frequência. |
| C3 | `examples/` fora do workspace | Os exemplos não são cobertos por `pnpm test` (a pasta está fora dos globs). |
| C4 | `@behavior-os/orchestrator` sem testes | Não tem suite nenhuma (o script `test` falso foi removido em vez de mantido). |
| C5 | `behavioros agent` não lista agentes | Mostra o agente resolvido, não o registo de agentes. |
| C6 | `drift-check` é um subconjunto | Compara `currentStep`/`selectedDna` com `baseline.json`; o `DriftEngine` compara também regras e gates. |

## Estado dos testes

Medido com `pnpm test` (não aspiracional): **51 ficheiros / 521 casos**,
`pnpm typecheck` 10/10 tarefas sem erros e `pnpm lint:check` (Biome) limpo. Os
números vivem nos próprios testes, que falham se a contagem derivar:
`packages/mcp-server/tests/mcp.test.ts` ("27 tools" + descrição do manifesto),
`plugins/opencode-v2/tests/plugin-registration.test.ts` ("29 bos_* tools"),
`packages/core/tests/protocol-steps-catalog.test.ts` (os 7 `PROTOCOL_STEPS`
passam `ProtocolStepSchema`), `packages/core/tests/dnas.test.ts` (os 21 YAML
passam `DNASchema`) e `packages/core/tests/docs-consistency.test.ts`
(documentação atual não pode citar tools, comandos CLI, scripts `pnpm`, métodos
de `BehaviorOS` ou variáveis de ambiente que não existam).
