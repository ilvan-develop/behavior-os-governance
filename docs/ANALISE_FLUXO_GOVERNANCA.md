# Análise do Fluxo de Governação — Behavior-OS × OpenCode v2

> Análise de **1000 cenários** do fluxo completo (mensagem do utilizador → missão →
> bloqueios → audit → learning), com evidência de código e um plano de correção.

Data: 2026-10-12 · Âmbito: `plugins/opencode-v2`, `packages/core`, `packages/mcp-server`
Artefactos: `docs/analysis/governance-flow-scenarios.csv` (1000 linhas),
`docs/analysis/governance-flow-summary.json`, gerados por
`scripts/analyze-governance-flow.mjs`.

> **Atualização (mesma data) — P0, P1, P2 e P3 implementados e verificados.**
> A governação agora **bloqueia de facto** (§8: P0) e é **observável no ecrã**
> (§8: P3 — tool `bos_get_log`, mensagens sintéticas e linha
> `[Behavior-OS:LOG:…]` no console). Ver §8 para o estado de cada finding, o
> mapeamento para os ficheiros alterados e as provas E2E (`opencode run`). Os números
> da Parte A/B em §4 foram regenerados após a correção.

---

## 0. Sumário executivo (TL;DR — diagnóstico **antes** da correção)

**O comportamento dos agentes NÃO está a ser governado hoje.** Os mecanismos existem,
mas nenhum deles bloqueia efetivamente:

| # | Severidade | Achado | Evidência |
|---|-----------|--------|-----------|
| **F1** | 🔴 Crítico | O hook de governação **nunca bloqueia** — duas avarias independentes (contexto errado + `throw` engolido pelo próprio `catch`) | `index.ts:474-489` · **315/315** veredictos `allow` |
| **F2** | 🔴 Crítico | O mecanismo de bloqueio usado (`execute.before` + `throw`) **não é** o oficial do v2; o oficial é `permission.evaluate → effect:"deny"` | `permission.d.ts` · **0** permission hooks |
| **F3** | 🟠 Alto | O **MCP server** tem o mesmo bug de contexto → **315/315** `allow` | `server.ts:54-58` |
| **F4** | 🟠 Alto | **Não existe hook de mensagem** (`session.prompt`) → enviar mensagem não cria missão nem sugere DNA | **0** prompt hooks |
| **F5** | 🟠 Alto | **Sem DNA selecionado, o agente não recebe sinal nenhum** (injeção condicionada) | `index.ts:495` · **0/5** injeções sem DNA |
| **F6** | 🟠 Alto | **Seleção de DNA não é inteligente** — 21 padrões, seleção 100% manual | `bos_select_dna` |
| **F7** | 🟡 Médio | **Missão não é automática**; sem `execute.after` para audit/learning | **0** after hooks |
| **F8** | 🟡 Médio | **Não existe skill `behavior-os` nem prompt governado** (só um bloco de 3 linhas, condicional) | `.opencode/` |
| **F9** | 🟡 Médio | Estado **só em memória**; `docs/PROTOCOL.md` promete `.behavioros/state.json` (não implementado) | sem `writeFile` no core |
| **F10** | 🟢 Baixo | `execute.before` só apanha nomes com `bash/write/edit/mcp__` (substring) | `index.ts:468` |
| **F11** | 🟢 Baixo | `evaluateGovernance` cria um engine novo por chamada → cache de 5 min nunca é usada | `behavior-os.ts:128` |
| **F12** | 🟢 Baixo | MCP tem 11 tools vs 12 do plugin (falta `bos_list_dna`) | `server.ts` |

> **Pós-correção (ver §8):** F1–F3, F5–F12 resolvidos ou implementados. O estado agora
> **persiste** via `ctx.storage` (F9) e o cache de governação é **reutilizado** (F11).

**Resumo da matriz:** de 570 cenários em que a DNA define uma regra de *block* e o
contexto era satisfazível, **0 bloquearam** pelos canais instalados (plugin e MCP).
Só a chamada "correta" (aninhando `context.context`) produz `deny`/`escalate`.

**O que está bem:** a progressão do protocolo de 7 passos é monotónica e correta
(`advanceProtocolStep`, `PROTOCOL_TOOL_STEPS`, `currentStep`), e as 12 tools diretas
funcionam. O problema está no *enforcement*, não no *tracking*.

---

## 1. Método (1000 cenários)

`scripts/analyze-governance-flow.mjs` enumera **exatamente 1000 cenários** e mede o
comportamento **real** (motor compilado `packages/core/dist` + plugin compilado
`plugins/opencode-v2/dist`, hooks acionados de facto):

- **Parte A — 945 cenários de alcançabilidade da governação**
  `DNA (21) × nível (3: strict/moderate/lenient) × fornecedor de contexto (3) × tool (5)`
  - **plugin** — a forma como o hook chama hoje: `context: { action: tool }`.
  - **mcp** — a forma como o servidor chama hoje: `{ agent, scope, ...flags }` (spread).
  - **caller-correct** — a forma que o motor e os testes esperam:
    `{ agent, context: { ...flags } }` (aninhado).
- **Parte B — 55 cenários de fluxo**
  `fase (5) × dnaSelecionado (2) × tool (5)` + 5 casos nomeados.
  Fases: `user_prompt`, `model_context`, `tool_execute_before`, `tool_execute_after`,
  `permission_evaluate`. Cada cenário carrega o plugin do zero e invoca os hooks reais.

Saídas: `governance-flow-scenarios.csv` (1000 linhas) e
`governance-flow-summary.json`.

---

## 2. Fluxo atual (como está implementado)

```
Utilizador envia mensagem
        │
        ▼
[OpenCode]  session.hook("prompt")      ← NÃO REGISTADO  ✗ (nada acontece)
        │
        ▼
[OpenCode]  resolve skills/attachments  ← sem skill behavior-os  ✗
        │
        ▼
[OpenCode]  session.hook("context")     ← registado (index.ts:493)
        │      se !selectedDna → return (nada injetado)  ✗
        │      senão → injeta 3 linhas (DNA + próximo passo + catálogo)
        ▼
   Modelo decide chamar tools
        │
        ├── bos_select_dna   (manual; sem sugestão)              F6
        ├── bos_create_mission (manual; sem auto-criação)        F7
        ├── bos_start_mission / bos_run_audit / bos_record_learning
        │
        └── tool de mutação (bash/write/edit/mcp__)
                │
                ▼
        [OpenCode] session.hook("tool.execute.before")  ← registado (index.ts:457)
                │  se !selectedDna → return               ✗
                │  evaluateGovernance(tool, {context:{action}})  ✗ contexto errado
                │  se deny → throw ... que o próprio catch apanha ✗  F1
                ▼
        [OpenCode] permission.hook("evaluate")   ← NÃO REGISTADO  ✗  F2
                ▼
        tool corre SEM bloqueio
                │
                ▼
        [OpenCode] session.hook("tool.execute.after")  ← NÃO REGISTADO  ✗  F7
```

### Comportamento por trigger

| Trigger | Hook registado? | Efeito real | Governado? |
|---|---|---|---|
| Utilizador envia mensagem | ❌ `prompt` | nada | ❌ |
| Montagem do pedido ao modelo | ✅ `context` | injeta estado **só se houver DNA** | ⚠️ |
| Tool prestes a correr | ✅ `execute.before` | avalia, mas **nunca bloqueia** | ❌ |
| Tool terminada | ❌ `execute.after` | nada (sem audit/learning automático) | ❌ |
| Decisão de permissão | ❌ `permission.evaluate` | nada (mecanismo oficial ausente) | ❌ |
| Skill disponível | ❌ | não existe skill | ❌ |
| Prompt do agente | ❌ | sem preâmbulo governado | ❌ |
| Persistência de estado | ❌ | só memória (reset por processo) | ❌ |

---

## 3. Findings detalhados

### F1 — 🔴 O hook de governação nunca bloqueia

`plugins/opencode-v2/src/index.ts:473-489`:

```ts
try {
  const decision = bos.evaluateGovernance(toolName, {
    agent: eventTyped.agent ?? 'opencode-agent',
    context: { action: (eventTyped.input?.command as string | undefined) || toolName },
  });                                    // ⬆ contexto = { action }
  if (decision.verdict === 'deny') {
    throw new Error(`Governance blocked: ${decision.reason}`);   // ⬅ DENTRO do try
  }
  ...
} catch (error) {
  console.warn(`[Behavior-OS] Governance error: ${errorMessage}`); // ⬅ apanha o próprio throw
}
```

**Avaria 1 — contexto errado.** O motor lê as condições de `context.context`
(`behavior-os.ts:132`): `context: (context.context || {})`. As regras DNA casam por
**chave** dessa bolsa, ex.: `surgical-team.yaml:19-31` usa
`conditions: [{ type: production, value: true }]`. O plugin fornece
`{ action: <comando> }` → a chave `production` nunca existe → nenhuma regra casa →
`verdict: 'allow'`. Resultado medido: **315/315 `allow`**.

**Avaria 2 — `throw` engolido.** Mesmo que o veredicto fosse `deny`, o `throw` está
dentro do mesmo `try` cujo `catch` o apanha e apenas faz `console.warn`. **O hook é
incapaz de bloquear, por construção.** Resultado medido: **0** bloqueios em 55 cenários
de fluxo (incluindo `surgical-team` + `"deploy to production"`).

Prova: `governance-flow-summary.json → partB.toolExecuteBeforeBlocks = 0`.

### F2 — 🔴 Mecanismo de bloqueio errado (não é o oficial do v2)

A doc oficial (`opencode.ai/v2/docs/build/plugins`, secção *Tools*) diz apenas que
`tool.execute.before` serve para **"inspect or replace tool input"** e a assinatura é
`(event) => Promise<void> | void` — **não existe API de rejeição**.

O bloqueio tipado e oficial é **`permission.evaluate`** (`permission.d.ts`):

```ts
interface PermissionEvaluation {
  action: string; resources: readonly string[];
  effect: "allow" | "ask" | "deny";   // ← bloqueia aqui
  message?: string;
}
```

Regras: *"A hook may change `effect` to `allow`, `ask`, or `deny`; `message` becomes the
denial reason"*. O plugin **não regista** este hook (`permissionHookRegistered = 0`).

### F3 — 🟠 O MCP tem o mesmo bug de contexto

`packages/mcp-server/src/server.ts:54-58`:

```ts
const decision = bos.evaluateGovernance(action, { agent, scope, ...context });
```

O `...context` espalha as flags no **topo**, mas o motor lê `context.context` →
`undefined` → `{}` → nenhuma regra casa. Medido: **315/315 `allow`** mesmo com um cliente
a passar `context: { production: true }`. Para funcionar, o cliente teria de passar
`context: { context: { production: true } }` (contraintuitivo).

### F4 — 🟠 Não existe hook de mensagem (`session.prompt`)

A doc define o hook `prompt` ("intercept incoming user prompts **before** attachment and
skill resolution and durable inbox admission", com `event.prompt` mutável). É o ponto
natural para: classificar intenção, sugerir/selecionar DNA, criar missão e anexar o
prompt governado. O plugin **não o regista** → **enviar uma mensagem não tem qualquer
efeito Behavior-OS**.

### F5 — 🟠 Cold start sem governação

`index.ts:494-495`:

```ts
const currentState = bos.getState();
if (!currentState.selectedDna) return;   // sem DNA → zero orientação
```

Como nada seleciona DNA automaticamente, o estado inicial típico é "sem DNA" → o agente
**nunca** recebe instruções de governação. Medido: injeções `model_context` = **5 (com
DNA) / 0 (sem DNA)**.

### F6 — 🟠 Seleção de DNA não é inteligente

Não há mapeamento intenção→padrão. Os 21 padrões só são alcançáveis se o modelo decidir
chamar `bos_select_dna` por sua iniciativa (é apenas uma tool entre muitas). Não existe:
classificação por palavras-chave, sugestão no `context`, nem auto-seleção no `prompt`.

### F7 — 🟡 Missão e learning não são automáticos

Só via `bos_create_mission` explícito. Sem `execute.after`, não há captura automática de
learning, nem sugestão de audit no fecho de uma tarefa. Medido: `afterHookRegistered = 0`.

### F8 — 🟡 Sem skill `behavior-os` nem prompt governado

- Não existe `.opencode/skills/**` nem skill registada via `ctx.skill.transform`.
- Não há `ctx.agent.transform` a injetar um preâmbulo governado.
- A única superfície é: 12 tools + um bloco condicional de 3 linhas.
- Nada no harness obriga o agente a seguir o protocolo de 7 passos (ele pode ignorá-lo).

### F9 — 🟡 Estado não persiste

O motor não escreve nada (`grep writeFile` no core → 0). `docs/PROTOCOL.md` afirma "Read
state first: always check `.behavioros/state.json`" e "Write state after" — **não
implementado**. O estado vive num singleton do processo do plugin e perde-se no restart.
Curiosidade: `ctx.storage` (durabilidade por plugin) está disponível e não é usado.

> **Corrigido (P2):** `BehaviorOS.exportState()` / `importState()` serializam o estado
> completo (protocolo, DNA, missões, aprendizagens). O plugin persiste em `ctx.storage`
> (chave `behavioros:state`) após cada mutação e **restaura no `setup`**, sobrevivendo a
> um restart. `docs/PROTOCOL.md` foi atualizado para o mecanismo real.

### F10/F11/F12 — 🟢 Menores

- **F10:** `governanceTools = ['bash','write','edit','mcp__']` com `toolName.includes(t)`
  (index.ts:468-469) → `task`, `webfetch`, `patch` e variantes de shell ficam de fora;
  `mcp__` é substring (colide com nomes que o contenham).
- **F11:** `evaluateGovernance` faz `registry.createGovernanceEngine(...)` a cada chamada
  (behavior-os.ts:128); o `decisionCache` de 5 min do engine (governance-engine.ts:17)
  nunca é reutilizado entre chamadas.
  > **Corrigido:** `EngineRegistry.createGovernanceEngine` já reutiliza o engine enquanto a
  > referência do DNA não muda → o `decisionCache` de 5 min passa a ser efetivamente usado
  > (coberto por `governance-cache.test.ts` e `persistence.test.ts`).
- **F12:** MCP expõe 11 tools (falta `bos_list_dna`); plugin expõe 12.

---

## 4. Resultados da matriz (1000 cenários)

> Os valores abaixo são os **pós-correção** (regenerados com o plugin/core atuais).
> A coluna "antes" fica como referência do diagnóstico.

### Parte A — alcançabilidade da governação (945)

| Fornecedor | allow | escalate | deny | *(antes)* |
|---|---:|---:|---:|---:|
| **plugin** (corrigido) | 261 | 44 | 10 | *315 allow* |
| **mcp** (corrigido) | 15 | 110 | 190 | *315 allow* |
| **caller-correct** | 15 | 110 | 190 | *15 / 110 / 190* |

- **19/21** DNAs definem regra de *block*; **20/21** definem *escalate*; só `lean-factory`
  é só-`warn` (0 deny, 0 escalate).
- O plugin aplica heurísticas genéricas (`deploy`/`production`/`destrutivo`/PII…) e por
  isso bloqueia/escala mudanças de produção, mas **não** classifica flags de domínio
  (`no-monitoring`, `invalid-circuit`, …). Por isso ainda há **231** cenários
  block-rule-mas-allow **no plugin** (era 570 no total). O MCP passou a igualar a chamada
  correta: o **caller** é que fornece a bolsa de condições.

### Parte B — fluxo (55)

| Métrica | Antes | Agora |
|---|---:|---:|
| `session.prompt` registados | 0 | **11** |
| `tool.execute.after` registados | 0 | **11** |
| `permission.evaluate` registados | 0 | **11** |
| Bloqueios via `execute.before` (throw) | 0 | 0 (passou a advisory) |
| Ações **efetivamente** negadas/escaladas via `permission.evaluate` | 0 | **6** |
| Injeções de contexto (com DNA / sem DNA) | 5 / 0 | **11 / 6** |
| Cenários com gap (plugin, flags de domínio) | 50 | 231 |

---

## 5. Respostas diretas às perguntas

- **"Como está o fluxo quando o user envia uma mensagem?"** → Nada acontece ao nível
  Behavior-OS. Não há hook de mensagem (F4) e o `context` só injeta se já houver DNA
  (F5). Não há criação de missão nem sugestão de DNA.
- **"Quando é criada uma missão?"** → Só quando o **agente decide** chamar
  `bos_create_mission`. Não é autónomo nem disparado por hook (F7).
- **"O que é feito autonomamente ou por hook? Onde bloqueia?"** → **Hoje não bloqueia
  nada** (F1/F2) e não há automação de missão/learning (F7).
- **"A seleção de DNA é inteligente?"** → Não (F6).
- **"Os agentes estão a ter comportamento governado?"** → **Não**, no sentido forte. As
  tools funcionam e o protocolo é rastreado, mas nenhuma ação é efetivamente bloqueada
  quando devia (F1/F2/F3).
- **"Tem skill behavior-os ou prompt governado?"** → **Não** (F8). Só existe a injeção
  condicional de 3 linhas.

---

## 6. Design alvo e plano de correção

### P0 — tornar a governação real (bloquear de facto)

1. **Substituir** `tool.execute.before`+`throw` por **`ctx.permission.hook("evaluate")`**
   (`index.ts`), mapeando `action`/`resources` → regras DNA e definindo
   `event.effect = "deny" | "ask"` + `event.message`. É o único caminho tipado de bloqueio.
2. **Corrigir a bolsa de contexto:** construir `{ context: { production, deployment,
   pii-access, ... } }` a partir de `tool` + `input` (heurísticas por palavra-chave:
   `deploy|production|prod` → `production/deployment`; caminhos sensíveis → `pii-access`…),
   em vez de `{ action }`. Alternativa/adicional: aceitar contexto plano no motor com
   retrocompatibilidade.
3. **Corrigir o `throw` engolido:** mover o `throw` para fora do `try`, ou substituir por
   `permission` (deixa de ser necessário).
4. **Prompt governado sempre ativo:** `session.context` deve injetar um preâmbulo curto
   **mesmo sem DNA** ("Behavior-OS: selecione um DNA antes de agir", lista de passos).
5. **Corrigir o MCP** (`server.ts:54`): aninhar o contexto em `context.context` (ou
   normalizar no motor).

### P1 — inteligência de fluxo

6. **Hook `session.prompt`:** classificar a intenção da mensagem → (a) sugerir/auto-selecionar
   DNA (heurística por palavras-chave → padrão), (b) criar missão automaticamente
   (`createMission` com tipo/prioridade inferidos), (c) anexar o prompt governado.
7. **Hook `execute.after`:** registar learning automático (falha/sucesso) e sugerir audit.
8. **Skill `behavior-os`** (`.opencode/skills/behavior-os/SKILL.md`) + opcional
   `ctx.agent.transform` para preâmbulo governado nos agentes.
9. **Mapeamento explícito intenção→DNA** (tabela de palavras-chave por padrão), exposto
   também via `bos_select_dna` (parâmetro `reason`).

### P2 — robustez

10. **Persistência** via `ctx.storage` (DNA ativo, missão, stepHistory) — alinhar com
    `docs/PROTOCOL.md`, ou remover a promessa do doc.
11. **Paridade MCP** (`bos_list_dna`) e `execute.before` para mais tools.
12. **Cache de governação** efetiva (reutilizar engine ou cache no `BehaviorOS`).

---

## 7. Reprodutibilidade

```powershell
node scripts/analyze-governance-flow.mjs
# → docs/analysis/governance-flow-scenarios.csv   (1000 linhas)
# → docs/analysis/governance-flow-summary.json
```

> Os números acima foram reproduzidos a partir do build atual (`dist/`). Sempre que o
> plugin/core mudar, correr `pnpm build` e repetir o analisador.

---

## 8. Estado de implementação (P0, P1 e P2 implementados)

Implementado e verificado. Cada correção tem testes que a provam.

### P0 — governação real ✅

| Finding | Correção | Ficheiro | Prova |
|---|---|---|---|
| **F1** nunca bloqueia | Enforcement passou para o hook **`permission.evaluate`**; o contexto é construído de facto a partir de `action`/`resources`/`metadata`; `execute.before` deixou de lançar (é *advisory*) | `plugins/opencode-v2/src/index.ts` | `permission.effect = "deny"` em `verify:plugin`, testes, **E2E** |
| **F2** mecanismo errado | Hook `permission.hook("evaluate")` registado; mapeia `deny`/`escalate` → `effect: "deny"`/`"ask"` + `message` | `index.ts` | `permissionHooks.evaluate` presente (11 cenários) |
| **F3** bug de contexto no MCP | `context.context` aninhado + `action` | `packages/mcp-server/src/server.ts` | `smoke:mcp` → `escalate` por `change-control` |
| **F5** cold start mudo | `session.context` injeta sempre (com ou sem DNA) | `index.ts` | injeções **11 / 6** (era 5 / 0) |

### P1 — inteligência de fluxo ✅

| Finding | Correção | Estado |
|---|---|---|
| **F4** sem hook de mensagem | `session.prompt` classifica a intenção e **auto-seleciona** o DNA (ex.: "patient/HIPAA" → `healthcare-hipaa`) | ✅ |
| **F6** seleção não inteligente | `classifyDNA` (21 padrões × palavras-chave, com desempate por pontuação) | ✅ |
| **F7** sem `execute.after` | Hook regista `failure` no learning engine (sem avançar o protocolo — `recordLearning({ advanceProtocol: false })`) | ✅ |
| **F7** missão não automática | `session.prompt` cria **e** inicia uma missão (`classifyMissionIntent` → tipo/prioridade) quando há DNA ativo e nenhuma missão ativa; **não** avança o protocolo e **não** repete por mensagem | ✅ |
| **F8** sem skill / prompt governado | Prompt governado sempre injetado no `context`; **skill `behavior-os`** criada em `.opencode/skills/behavior-os/SKILL.md` (advertida pelo v2); **preâmbulo governado** anexado ao `system` de cada agente via `ctx.agent.transform` | ✅ |
| **F9** estado só em memória | `BehaviorOS.exportState()/importState()` + persistência automática via **`ctx.storage`** (chave `behavioros:state`); restauro no `setup` | ✅ |

### P2 — robustez ✅

| Finding | Correção | Estado |
|---|---|---|
| **F12** paridade MCP | `bos_list_dna` adicionado (MCP passou de 11 → **12** tools) + catálogo `behavioros://dna/catalog` dinâmico | ✅ |
| **F10** subconjunto de tools no before | `GOVERNED_TOOL = /bash\|write\|edit\|patch\|apply\|shell\|mcp__/i` (advisory) | ✅ |
| **F11** cache de governação | Efetivamente resolvido: o registry reutiliza o engine enquanto a referência do DNA não muda → `decisionCache` de 5 min ativo | ✅ |

### P3 — observabilidade (ler a governação no ecrã) ✅

> Pedido explícito: poder **ler**, na sessão do OpenCode, como o DNA/governança está a ser
> aplicado. Antes só existia `console.log` disperso, sem histórico consultável.

| Comportamento | Correção | Estado |
|---|---|---|
| Sem histórico de decisões | **Ring buffer** de eventos (máx. 200) em `governance-log.ts` | ✅ |
| Sem leitura na sessão | Tool **`bos_get_log`** (13ª tool) devolve os N eventos em JSON | ✅ |
| Sem feedback imediato | Mensagens sintéticas (`ctx.session.synthetic`) em DNA auto, missão auto, `⛔` deny e `⚠️` escalate | ✅ |
| Sem análise nos logs do servidor | Linha única greppable `[Behavior-OS:LOG:kind:outcome] dna=… step=… mission=… action="…"` para `deny`/`escalate`/`error` | ✅ |

Cada evento carrega `seq`, `at`, `kind`, `outcome`, `dna`, `step`, `mission`, `action` e
`detail`; os `kind` possíveis são `dna_selected`, `mission`, `protocol`, `permission`,
`advisory`, `learning`, `restore` e `tool`. Decisões `allow` sem regra avaliada não são
registadas (mantém o log focado). É puramente diagnóstico: não persiste nem influencia
decisões.

### P4 — provar a governação (conformance de promessas) ✅

> Pergunta: *"como provamos que temos governação total e que o Behavior-OS cumpre tudo o
> que promete a 100%?"* Resposta rigorosa: "100%" não é um estado que se afirma — é
> **cobertura sobre um conjunto enumerado de promessas**, cada uma com uma verificação
> executável.

| Comportamento | Correção | Estado |
|---|---|---|
| Duas vias de decisão divergiam: o hook `permission` **escalava** `deploy to production` enquanto a auto-verificação `bos_evaluate_governance` respondia `allow` | A tool passa a construir o *condition bag* via `buildGovernanceContext` (igual ao hook): `tool`/`resources`/`text` + `metadata` explícitos | ✅ |
| Nenhuma prova agregada de que o motor cumpre as promessas | **Harness de conformance** `scripts/governance-conformance.mjs` (`pnpm verify:governance`): arranca plugin+core reais, avalia 19 *claims*, imprime `claims → evidência` e grava `docs/analysis/governance-conformance.json`; falha com exit ≠ 0 | ✅ |
| Divergência entre instâncias/sessões invisível | Cada evento do log ganha `instance` (`p<pid>-<rand>`) e o harness inclui C13 (auto-missão coerente numa instância isolada) e C14 (identidade estável) | ✅ |
| Clobber entre instâncias concorrentes (last-writer-wins) | Módulo puro `storage-sync.ts`: cada snapshot leva `revision`+`writer`; `planPersist` decide **adopt-then-write** (adota snapshot mais recente de outra instância antes de escrever) e mantém revisões monotónicas; C15 prova o contrato | ✅ |
| Updates locais perdidos no adopt | `mergeSnapshots`: missões/learnings unidas por `id` (o mais recente ganha no mesmo `id`), DNA/`activeMission` do mais recente com fallback ao local, `currentStep` máximo, `stepHistory` unida; C16 + teste de integração com dois writers | ✅ |
| Persists concorrentes na mesma instância | Fila single-flight (`persistQueue`) serializa as escritas; verificação pós-escrita com detecção de overtake (`detectOvertake`) + retry; C17 prova revisões monotónicas. O CAS de backend continua a ser o limite irreduzível (a API só expõe get/set) | ✅ |
| Log de governação perdido no restart | O snapshot persistido transporta um tail do log (limite `GOVERNANCE_LOG_PERSIST_LIMIT`); no arranque é reinjetado e a sequência retoma (C18) | ✅ |
| Colisão de revisão igual entre processos indeterminada | `detectOvertake` trata um `writer` estrangeiro na mesma revisão como overtake e o retry força adopt+merge (C19) | ✅ |
| Limites não declarados | Secção "Limites honestos" no `OPENCODE_RUN.md` separa **Enforced** (`permission` deny) / **Advisory** (`escalate`→`ask`, não impede execução) / **Reativo** (protocolo por tools) / **Não provado** | ✅ |

As 19 claims cobrem: C01 bloqueio real, C02/C04 consistência hook↔auto-verificação,
C03 escalonamento, C05 log com DNA+passo, C06 limite+monotonicidade, C07 protocolo,
C08 persistência, C09 invariante `activeMission`, C10 quality gates, C11 learnings,
C12 mensagem no ecrã, C13 auto-missão coerente, C14 identidade de instância, C15
adopt-then-write entre instâncias, C16 merge de conflito sem updates perdidos, C17 single-flight de persists concorrentes na mesma instância (sem escrita perdida), C18 log de governação persistido/restaurado, C19 colisão de revisão igual detetada.

### Ficheiros novos/alterados (P0/P1/P2/P3)

- `plugins/opencode-v2/src/governance.ts` **(novo)** — `classifyDNA`, `buildGovernanceContext`,
  `classifyMissionIntent` e `buildGovernedPreamble`/`GOVERNED_PREAMBLE_MARKER` (helpers puros,
  sem imports do OpenCode).
- `plugins/opencode-v2/src/governance-log.ts` **(novo, P3)** — ring buffer de eventos de
  governação + `serializeGovernanceLog` (linha greppable para o console).
- `plugins/opencode-v2/src/index.ts` — hooks `permission.evaluate`, `session.prompt`
  (auto-DNA + **auto-missão**), `session.context` (sempre ativo), `tool.execute.before`
  (advisory), `tool.execute.after` (learning); **persistência** via `ctx.storage`;
  **preâmbulo governado nos agentes** via `ctx.agent.transform`; **observabilidade** (registo
  de eventos + mensagens sintéticas + tool `bos_get_log`).
- `packages/core/src/engine/behavior-os.ts` — `recordLearning({ advanceProtocol? })`,
  `createMission`/`startMission({ advanceProtocol? })`, **`activeMission`** (set no start,
  clear no complete/fail), `exportState()`/`importState()` + `BehaviorOSSnapshot`.
- `packages/core/src/engine/mission-engine.ts` / `learning-engine.ts` — `snapshot()`/`restore()`.
- `packages/mcp-server/src/server.ts` — contexto aninhado + `bos_list_dna` + catálogo dinâmico.
- `scripts/verify-plugin.mjs` — valida hooks e **bloqueio real**.
- `scripts/governance-conformance.mjs` **(novo, P4)** — harness de conformance: 19 *claims*
  sobre plugin+core reais, relatório `claims → evidência` + JSON.
- `scripts/smoke-mcp.mjs` — valida 12 tools e o **match de contexto**.
- `scripts/analyze-governance-flow.mjs` — modela o novo contrato; regenera CSV/JSON.
- `plugins/opencode-v2/tests/governance.test.ts` (**24 testes**),
  `plugin-registration.test.ts` (18), `plugin-session-flow.test.ts` (3),
  `governance-log.test.ts` **(novo, P3 — 5 testes do ring buffer e do eco no console)**.
- `packages/core/tests/persistence.test.ts` **(novo, 8)** — round-trip de estado,
  `activeMission`, `advanceProtocol:false` e reutilização do cache.
- `.opencode/skills/behavior-os/SKILL.md` **(novo)** — skill governada (protocolo de 7
  passos, mapa intenção→DNA, explicação de bloqueios), descoberta automaticamente pelo v2.

### Provas end-to-end (`opencode run`, harness real)

1. `bos_select_dna(surgical-team)` executado via `opencode run` → *"Governance rules activated."*
2. `opencode run --auto "…echo deploy to production"` →
   **`permission.rejected`: `[Behavior-OS:Surgical Team] Blocked by rule: sterile-field`**.
   O `--auto` **não** sobrepõe um `deny` explícito — o bloqueio é real.
3. Nota observada: durante esta sessão, os próprios `edit`/`write` do agente passaram a ser
   negados enquanto o DNA `surgical-team` estava ativo no servidor de fundo (partilhado),
   confirmando que o hook governa **qualquer** ferramenta, não só as tools `bos_*`.
4. Auto-missão e persistência provadas **ao vivo** (`opencode run --standalone`): após
   *"Fix the crash in the payment service"*, `bos_get_state` devolveu
   `{"selectedDna":"Financial Compliance","activeMission":"mission-…","currentStep":3}`; um
   **segundo processo** restaurou o mesmo `activeMission` a partir de `ctx.storage`.
5. `pnpm verify:plugin` confirma o **preâmbulo governado nos agentes**
   (`Agents: governed preamble applied to build, review`).
6. `pnpm verify:plugin` confirma também a **observabilidade** — imprime a linha
   `[Behavior-OS:LOG:permission:deny] dna=Surgical Team step=3 mission=mission-… action="bash" …`
   e valida que `bos_get_log` devolve os eventos `dna_selected` + `permission deny`.

### Como reproduzir

```powershell
pnpm build; pnpm test; pnpm lint:check; pnpm typecheck
pnpm verify:plugin      # hooks + deny real
pnpm verify:governance  # 19 claims: promessa → evidência
pnpm smoke:mcp          # 12 tools + match de contexto
pnpm analyze:flow       # regenera os 1000 cenários
```
