# CLAIMS — Verificação de afirmações (Behavior-OS)

> Documento único de verdade. Cada afirmação pública é cruzada com o código real.
> Sempre que algo não existe, é dito explicitamente. Última auditoria: ver
> `git log` e os comandos no fim deste ficheiro.

## Como verificar (comandos)

```bash
# Motores reais (esperado: audit, behavior-os, decision, dna-loader, governance, learning, mission, pipeline, quality)
ls packages/core/src/engine/*.ts

# Linhas por motor
wc -l packages/core/src/engine/*.ts

# Tools MCP (esperado: 21) e resources (esperado: 2)
grep -c "registerTool(" packages/mcp-server/src/server.ts
grep -c "registerResource(" packages/mcp-server/src/server.ts

# Ficheiros DNA (esperado: 21)
ls dnas/*.yaml | wc -l

# Schemas Zod (esperado: 25 objetos)
grep -c "z.object(" packages/schemas/src/index.ts

# SQLite (esperado: >= 1 ficheiro no código)
grep -ri "sqlite" packages plugins --include=*.ts

# Persistência plugável (esperado: store.ts, sqlite-store.ts, postgres-store.ts)
ls packages/core/src/persistence/*.ts

# Postgres é opcional (esperado: 0 imports estáticos de "pg")
grep -n "from 'pg'" packages/core/src/persistence/postgres-store.ts
```

## Tabela de afirmações

| Afirmação | Estado | Realidade verificada |
|---|---|---|
| 10 motores operacionais | ❌ | **8** motores reais + fachada `BehaviorOS` + `EngineRegistry`. Não existem Behavioral/Compiler. |
| GovernanceEngine com 609 linhas | ❌ | **147** linhas. |
| QualityEngine com 618 linhas | ❌ | **96** linhas. |
| AuditEngine com 1347 linhas | ❌ | **180** linhas. |
| PipelineEngine com 657 linhas | ⚠️ existe, 161 linhas | `pipeline-engine.ts` **existe** (161 linhas), mas não tem 657 nem 9 camadas — ver secção "Gate pipeline". |
| 9 camadas de validação (runtime) | ❌ | Existe um pipeline real e configurável, mas o default é 1 gate `pre` + N gates `post` (N = gates de qualidade do DNA) — não 9. |
| 30 tools & 7 resources MCP | ❌ | **21 tools + 2 resources** (server) / **23 tools** (plugin). |
| 29 schemas Zod | ❌ | **25** `z.object` (+24 `z.enum`). |
| Camada de decisão (votação/quorum) | ✅ | `decision-engine.ts`: políticas `majority`/`supermajority`/`unanimous` + quorum, votos com peso. Tool `bos_decide`. |
| 16 ficheiros YAML / 4 padrões | ❌ | **21** ficheiros DNA. |
| SQLite / tabelas relacionais | ✅ | `SqliteStore` no core (módulo nativo `node:sqlite`, sem dependência) com tabelas `missions`, `learnings`, `agents`, `audit_log`, `pipeline_runs`, `decisions`, `meta`. Ativa-se com `persistence: { path }` ou `BEHAVIOROS_DB_PATH`. |
| Persistência plugável + Postgres remoto | ✅ com ressalvas | Interface `Store` sincronizada; `SqliteStore` é o default. `PostgresStore` é opcional (`pg` resolvido só no `connect()`, **não** é dependência), com espelho em memória + write-through assíncrono (`flush()`/`closeAsync()`). Forte consistência para escritores: `store.withTransaction(async () => { store.saveA(); store.saveB() })` garante COMMIT atômico — o espelho só é atualizado após o COMMIT, por isso um leitor concorrente vê tudo ou nada. |
| Trilho de auditoria imutável | ✅ tamper-evident | Log append-ordered com **hash-chain SHA-256** (`verifyGovernanceLog`, tool `bos_verify_audit_trail`). É deteção de adulteração, não armazenamento WORM. |
| 7 algoritmos matemáticos | ⚠️ parcial | Existe **1** algoritmo real de confiança (`frequency * 0.6 + avgImpact * 0.4`) + deteção de padrões por contagem. Não são 7. |
| Auto-evolução do DNA com confiança > 80% | ⚠️ opt-in | `LearningEngine.proposeEvolution()` propõe mudanças com confiança ≥ 0,8 (default). Só se aplicam com `evolution.enabled` **e** `apply: true`, e só acrescentam regras `warn` (nunca bloqueiam). MCP: `bos_evolution`. |
| Propostas de correção de código | ✅ leitura + persistência governada | `LearningEngine.proposeCodeFixes()` gera `CodeFixProposal[]` a partir de eventos `fix` repetidos. `BehaviorOS.applyCodeFixes()` persiste resultados na tabela `code_fix_results` com as mesmas 3 travas da evolução (opt-in, `apply:true`, quórum). MCP: `bos_code_fixes` / `bos_apply_code_fixes`. |
| 10 estágios de auditoria | ❌ | `AuditStageSchema` tem **6**; por omissão corre **4**. |
| `authority_level: 3` | ❌ | Campo real: `authority: string` (ex.: `operator`). |
| Gate 2 real (Biome, tsc, pnpm audit) | ⚠️ | Verdade **apenas** com `simulate: false`; por omissão é simulado e passa sempre. |
| Hierarquia block → escalate → warn → log | ✅ | Implementada em `governance-engine.ts`. |
| Bloqueio antes da execução | ✅ | **Plugin:** `ctx.permission.hook('evaluate')` → `deny`/`ask`. **Core:** `BehaviorOS.preflightAction()` corre os gates `pre` de forma síncrona e veta antes de executar (tool MCP `bos_preflight`). |
| Protocolo de 7 passos rastreável | ✅ | `behavior-os.ts` + `AgentState.stepHistory`. |
| MCP real (não vaporware) | ✅ | 21 tools + 2 resources funcionais. |
| 21 padrões DNA | ✅ | `dnas/*.yaml` = 21. |
| DNA em YAML validado com Zod | ✅ | `schemas/src/index.ts`; Zod `^4.4.3`. |

## Cadeia de auditoria (tamper-evidence)

O log de governança (`plugins/opencode-v2/src/governance-log.ts`) é encadeado por
hash SHA-256: cada evento carrega `prevHash` e `hash`, e
`verifyGovernanceLog()` recomputa a cadeia e identifica o primeiro evento
adulterado. Isto dá **deteção de adulteração** (tamper-evident), não
imutabilidade por hardware.

Limitações honestas:
- É memória + uma cauda JSON no storage do host; **não** é uma base de dados.
- O buffer é limitado (ring buffer); a verificação cobre a janela retida e
  ancora no `prevHash` do primeiro evento retido.

## Gate pipeline

`PipelineEngine` (`packages/core/src/engine/pipeline-engine.ts`) runs an ordered
list of gates synchronously. A gate is `{ id, phase, blocking, evaluate }`; a
**blocking** gate that returns `failed` halts the run and blocks the action.

- `preflightAction(action, ctx)` runs only the `pre` gates → `{ allowed, blockedBy, run }`.
  This is a real pre-execution veto that any host can call (the MCP server exposes
  it as `bos_preflight`), not only the OpenCode plugin.
- `runPipeline(context)` runs `pre` + `post` gates and persists the run.
- Default gates: `governance` (pre, blocking) + one `quality:<id>` gate per DNA
  quality gate (post, blocking). Supplying `pipeline.gates` replaces them;
  `pipeline.enabled: false` yields a pass-through pipeline.
- Blocked pre-flights and full runs are persisted in the `pipeline_runs` table.

Limitations honestas:
- O default são 2 tipos de gate (1 `pre` + N `post`), não "9 camadas".
- Gates são síncronos e in-process; não há execução distribuída.

## Motor de decisão (votação/quorum)

`packages/core/src/engine/decision-engine.ts` resolve um assunto por votação
ponderada:

- políticas: `majority` (default), `supermajority` (≥ 2/3), `unanimous`;
- `quorum` = peso participante mínimo (aprov + rejei + abstenções), default 1;
- pesos por votante (negativos → 0); abstenções contam para o quórum mas nunca
  aprovam sozinhas; empate e "tudo abstenção" → `rejected` (fail-safe);
- `BehaviorOS.decide()` aplica defaults de config e persiste na tabela `decisions`
  (MCP: `bos_decide`).

Limitação honesta: é contagem/voto determinístico in-process; **não** há consenso
distribuído (Raft/Paxos) nem delegação entre agentes.

## Evolução de DNA (learning-driven)

`LearningEngine` (`packages/core/src/engine/learning-engine.ts`) pontua a
confiança de um padrão recorrente:

```
confiança = min(1, ocorrências / 5) * 0.6 + pesoDeImpactoMédio * 0.4
pesos de impacto: low 0.25 · medium 0.5 · high 0.75 · critical 1
```

`proposeEvolution(dnaName, minConfidence = 0.8)` devolve propostas **puras**
(não muta nada) para padrões `failure`/`fix` que atinjam o limiar. Cinco falhas
de impacto `high` chegam a **0.9**.

Aplicação — três travas independentes, todas necessárias:

1. `config.evolution.enabled === true`;
2. a chamada passa explicitamente `apply: true`;
3. se forem fornecidos `votes`, a alteração tem de ser **aprovada** pelo
   `DecisionEngine`.

A única alteração possível é acrescentar uma regra de governança `warn` com a
condição `{ type: 'pattern', value: <tipo> }`. Como `warn` nunca altera o
veredicto, uma proposta aplicada **nunca bloqueia** uma ação. Cada aplicação
gera um evento de aprendizagem com `source: 'dna-evolution'`.

Limitações honestas:
- Só `failure` e `fix` geram propostas; não há minerização de texto (LLM/NLP).
- A evolução só **acrescenta** regras `warn`; não remove nem bloqueia regras.
- A proposta é recalculada a partir dos eventos em memória — não há histórico
  versionado de propostas rejeitadas.

## Persistência plugável (SQLite / Postgres)

`Store` (`packages/core/src/persistence/store.ts`) é o contrato **síncrono** que o
`BehaviorOS` usa. Implementações:

- `SqliteStore` — default, `node:sqlite`, zero dependências externas, 7 tabelas;
- `PostgresStore` — opcional, uma tabela `behavior_os_documents` com discriminador
  `kind`; o driver `pg` é resolvido via `createRequire` **apenas** em `connect()`,
  pelo que não é uma dependência do pacote.

Injeção: `new BehaviorOS({ persistence: { store } })` (o `store` tem precedência
sobre `path`).

Consistência forte para escritores: `PostgresStore.withTransaction(fn)` faz
`BEGIN` / `COMMIT` / `ROLLBACK` numa conexão dedicada e atualiza o espelho
somente após o COMMIT, pelo que um leitor concorrente vê todas as mudanças ou
nenhuma. O `BehaviorOS.persistAll()` já invoca automaticamente
`withTransaction` para que missões, aprendizados e agentes sejam guardados em
uma só transação atómica.

Limitações honestas do `PostgresStore`:
- é um **espelho em memória + write-through assíncrono**: leituras normais
  (fora de `withTransaction`) servem o espelho, não a base de dados;
- para garantir atomicidade de leitura, o leitor deve chamar
  `await store.flush()` depois de operações escritoras;
- o `pg` **não** é declarado como dependência: a instalação é responsabilidade
  de quem usa o adaptador (`pnpm add pg`), ou passa-se `createPool` próprio.

## Propostas de correção de código

`LearningEngine.proposeCodeFixes(minConfidence = 0.8)` deriva propostas
**apenas de leitura** de eventos `fix` repetidos. A confiança usa a mesma
fórmula do motor de evolução (`frequency * 0.6 + avgImpact * 0.4`): três
eventos `fix` de impacto `critical` atingem ~0.76 (abaixo do limiar default de
0.8); cinco atingem 1.0.

A interface não edita ficheiros — apenas devolve `CodeFixProposal[]` com
`suggestion`, `evidence` e `confidence`. `BehaviorOS.proposeCodeFixes()` é o
ponto de entrada para leitura; `applyCodeFixes()` persiste os resultados na
tabela `code_fix_results` com as mesmas 3 travas da evolução (opt-in, `apply:true`,
quórum). O MCP expõe `bos_code_fixes` e `bos_apply_code_fixes`.

Limitações honestas:
- só eventos do tipo `fix` geram propostas; falhas (`failure`) ficam para
  evolução de DNA;
- não há análise estática de ficheiros — as propostas vêm apenas do log de
  aprendizagens;
- não há edição automática de código — `applyCodeFixes` só grava registos, não
  modifica ficheiros.

## O que ainda NÃO existe (roadmap)

- Edição automática de código pelo LearningEngine (as propostas e aplicações de
  correções são apenas leitura/sugestão — não há manipulação de ficheiros).
