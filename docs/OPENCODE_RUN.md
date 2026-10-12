# OpenCode Run - Instruções de Uso

## Status
✅ Plugin instalado e detectado
⚠️ `opencode run` requer PowerShell/CMD nativo (não funciona via Git Bash)

## Como usar

### Opção 1: PowerShell (Recomendado)
```powershell
cd C:\www\behavior-os
opencode run --standalone "test behavioros governance"
```

### Opção 2: CMD
```cmd
cd C:\www\behavior-os
opencode run --standalone "test behavioros governance"
```

### Opção 3: Git Bash (com workaround)
```bash
# Abrir PowerShell temporariamente
powershell.exe -Command "cd 'C:\www\behavior-os'; opencode run --standalone 'test behavioros'"
```

## Plugin Detectado
```
$ opencode plugin list
ID           VERSION  SOURCE
behavior-os  local    C:\www\behavior-os\.opencode\plugins\behavioros.ts
```

> O loader em `.opencode/plugins/behavioros.ts` aponta para o build do
> `plugins/opencode-v2` (`dist/index.js`) — auto-discovery nativo do OpenCode v2.
> O MCP server **não** é registado no `opencode.json` (`.mcp.json` é ignorado pelo v2);
> mantém-se como pacote standalone para clientes MCP externos.

## Ferramentas Disponíveis (13 × `bos_*`)
- `bos_evaluate_governance` - Avaliar ações contra regras de governança
- `bos_create_mission` - Criar novas missões
- `bos_start_mission` - Iniciar missão
- `bos_list_missions` - Listar missões (com filtros)
- `bos_check_quality` - Verificar gates de qualidade
- `bos_get_insights` - Obter insights do learning engine
- `bos_get_log` - Ler o log de governação (como o DNA foi aplicado)
- `bos_get_state` - Estado atual do protocolo
- `bos_get_status` - Status atual do Behavior-OS
- `bos_list_dna` - Listar padrões DNA disponíveis
- `bos_record_learning` - Registrar aprendizados
- `bos_run_audit` - Executar auditoria
- `bos_select_dna` - Selecionar padrão DNA

> **Nota**: usa `opencode run --agent <agent>` para a sessão carregar o plugin.
> Sem `--agent`, a sessão corre sem agente e as tools `bos_*` podem não aparecer.
> As tools são registadas como **directas** (`options.codemode: false`), pelo que o
> agente as invoca **pelo nome** — não é preciso envolvê-las em `execute`/Code Mode.
> O `currentStep` do protocolo avança automaticamente (monotónico, de 1 a 7):
> selecionar DNA → listar DNA → resolver estado → criar/iniciar missão → auditoria →
> aprendizagem. O hook de contexto mostra sempre o próximo passo.

## Governação ativa (hooks do v2)

O plugin registou os hooks (para além das 13 tools):

- **`permission.evaluate`** — **bloqueia de facto**. Constrói uma bolsa de condições a
  partir da ação/recursos e define `effect: "deny"`/`"ask"` conforme as regras do DNA.
  É o único caminho tipado de bloqueio do v2; um `deny` explícito **não** é sobreposto
  por `--auto`.
- **`session.prompt`** — classifica a intenção da mensagem e **auto-seleciona** o DNA
  quando ainda não há nenhum (ex.: menção a "patient/HIPAA" → `healthcare-hipaa`). Cria
  **e inicia automaticamente uma missão** (`classifyMissionIntent` → tipo/prioridade) quando
  há DNA ativo e nenhuma missão ativa — assim `activeMission` deixa de ficar sempre `null`.
  **Não** avança o protocolo e **não** cria mais de uma missão por sessão (evita spam).
- **`session.context`** — injeta **sempre** orientação governada (mesmo sem DNA).
- **`ctx.agent.transform`** — anexa um **preâmbulo governado curto** ao `system` de cada
  agente (idempotente, via marcador), para que a governação exista na própria definição do
  agente; o estado dinâmico (DNA/passo/missão) fica no `session.context`.
- **`tool.execute.before`** — apenas *advisory* (log de escalonamento); não bloqueia.
- **`tool.execute.after`** — regista falhas no learning engine (sem avançar o protocolo).

## Persistência (o estado sobrevive a restart)

O estado do motor (protocolo, DNA selecionado, missões e aprendizagens) é **persistido
automaticamente** em `ctx.storage` (chave `behavioros:state`) após cada mutação `bos_*` e
restaurado no arranque do plugin:

- `BehaviorOS.exportState()` → snapshot versionado e JSON-serializável
  (`{ version, exportedAt, agentState, dna, missions, learnings }`).
- `BehaviorOS.importState(snapshot)` → restaura e **revincula** os engines de
  governance/quality ao DNA restaurado (evita cache de decisões de um DNA anterior).
- Um restart do servidor **não perde** o DNA ativo nem a missão em curso; um snapshot com
  versão incompatível é ignorado sem tocar no estado atual.

Exemplo de bloqueio real:

```powershell
opencode run --session ses-x "Use bos_select_dna com 'surgical-team' e responda OK"
opencode run --session ses-x --auto "Execute: echo deploy to production"
# => permission.rejected: [Behavior-OS:Surgical Team] Blocked by rule: sterile-field
```

> ⚠️ O estado (DNA ativo) é **global ao servidor** e partilhado por todas as sessões
> desse servidor/diretório. Um DNA restritivo (ex.: `surgical-team`) bloqueia qualquer
> ferramenta — incluindo `write`/`edit` do próprio agente — enquanto estiver ativo.
> Para voltar a um modo não-bloqueante, seleciona um padrão só-`warn` (ex.:
> `bos_select_dna lean-factory`).

## Observabilidade: ler a governação no ecrã

Para que a governação deixe de ser uma "caixa negra", cada decisão é registada num
**ring buffer** em memória (`plugins/opencode-v2/src/governance-log.ts`, máx. 200 eventos)
e fica visível em **três superfícies**:

1. **Na própria sessão (TUI)** — eventos significativos são publicados como mensagens
   sintéticas (`ctx.session.synthetic`): DNA auto-selecionado, missão auto-criada,
   `⛔` bloqueio e `⚠️` escalonamento. O utilizador vê a governação *enquanto* trabalha.
2. **Via tool `bos_get_log`** — devolve os N eventos mais recentes (JSON), cada um com
   `seq`, `at` (ISO), `kind`, `outcome`, `dna`, `step`, `mission`, `action` e `detail`:
   ```powershell
   opencode run --session ses-x "Usa bos_get_log com limit=20 e resume o que aconteceu"
   ```
3. **No console do servidor** — os desfechos `deny`/`escalate`/`error` são também
   impressos numa linha única e *greppable*:
   ```
   [Behavior-OS:LOG:permission:deny] dna=Surgical Team step=3 mission=mission-… action="bash" Blocked by rule: sterile-field
   ```

Eventos registados: `dna_selected`, `mission`, `protocol`, `permission`, `advisory`,
`learning`, `restore`, `tool`. Para manter o log focado, decisões `allow` sem nenhuma
regra avaliada **não** são registadas. O log é apenas diagnóstico — nunca persiste e
nunca influencia decisões.

## Provar a governação: conformance de promessas

Observar um log mostra *o que aconteceu*; para provar que o Behavior-OS **cumpre o que
promete**, cada promessa é convertida numa verificação executável. O harness
`scripts/governance-conformance.mjs` arranca o plugin real + o core real (sem servidor,
sem rede, estado limpo) e avalia um conjunto de *claims*:

```powershell
pnpm verify:governance
```

O relatório imprime uma tabela `claims → evidência` e grava
`docs/analysis/governance-conformance.json`; sai com código ≠ 0 se alguma promessa falhar
(pronto para CI). Cobertura atual: **22/22 claims**.

| Claim | Promessa | Prova |
| --- | --- | --- |
| C01 | Surgical Team bloqueia mudanças de produção | hook `permission` → `deny` |
| C02 | Auto-verificação do agente == enforcement | `bos_evaluate_governance` → `deny` |
| C03 | Enterprise Governance escala mudanças | hook `permission` → `ask` |
| C04 | Auto-verificação == escalonamento | `bos_evaluate_governance` → `escalate` |
| C05 | Todo `deny`/`escalate` é registado (DNA+passo) | `bos_get_log` |
| C06 | Log limitado e monotónico | ring buffer `seq++` |
| C07 | Seleção de DNA = passo 1 do protocolo | `stepHistory` |
| C08 | `exportState`/`importState` round-trip | core |
| C09 | Iniciar missão define `activeMission` | sem divergência |
| C10 | Quality gates aplicam thresholds do DNA | `bos_check_quality` |
| C11 | Learnings surgem em insights | `bos_record_learning` → `bos_get_insights` |
| C12 | `deny`/`escalate` emite mensagem no ecrã | `session.synthetic` |
| C13 | Auto-missão do prompt deixa `activeMission` == missão aberta | instância isolada |
| C14 | Cada evento do log carrega um `instance` estável | divergência entre instâncias visível |
| C15 | Instâncias concorrentes fazem *adopt-then-write* | revisões monotónicas, sem clobber (`storage-sync`) |
| C16 | Merge de conflito preserva itens locais | união por id, sem updates perdidos (`mergeSnapshots`) |
| C17 | Persists concorrentes na mesma instância são serializados | single-flight (`persistQueue`) + verificação pós-escrita com retry (`detectOvertake`) |
| C18 | O log de governação sobrevive a um restart | tail do log persistido no snapshot e reinjetado no arranque; sequência retomada (monotónica) |
| C19 | Uma colisão de revisão igual (outro writer) é detetada | `detectOvertake` considera um writer estrangeiro na mesma revisão; retry com adopt+merge forçado |
| C20 | Uma ação read-only nunca é negada por `data-encryption` | O flag `pii-data` (operação) só nega ações mutantes; ler PII não é operar sobre ela |
| C21 | O control plane (`bos_*`) nunca é negado | A troca de DNA é imune ao DNA ativo (sem deadlock de bootstrap); o override fica registado |
| C22 | Todo o veredito não-`allow` é registado | Deny/escalate/erro são gravados no log antes de aplicar o efeito |

### Limites honestos (o que *não* é 100%)

"Governação 100%" não é um estado que se afirma — é **cobertura sobre um conjunto
enumerado de promessas**. O harness torna o conjunto e as lacunas explícitos. Hoje:

- **Enforced (automático, dificilmente contornável):** o hook `permission.evaluate`
  decide `deny`/`ask`. É a única superfície tipada de bloqueio do v2.
- **Advisory (automático mas mole):** as regras `escalate` produzem `ask`; num host
  não-interativo (ou auto-aprovado) o comando **corre de qualquer forma**. Registado como
  `warn`/`escalate`, mas não impede execução.
- **Reativo (exige ator):** a progressão do protocolo, ciclo de missões e auditorias só
  avançam quando alguém invoca as tools `bos_*`. Não é autónomo por si.
- **Não provado ainda:** que *toda* ação mutadora passe pelo hook (depende do host).
- **Atenuado, não resolvido:** a coerência entre instâncias/sessões concorrentes que
  partilham storage mas não memória. Cada snapshot leva `revision` + `writer`
  (`storage-sync`); um escritor **adota** um snapshot mais recente de outra instância
  antes de escrever (adopt-then-write, C15) e **faz merge por item** — missões/learnings
  unidas por `id`, DNA/`activeMission` do mais recente com fallback, passo máximo
  (C16). Persists concorrentes **na mesma instância** são serializados por uma fila
  single-flight (`persistQueue`) com verificação pós-escrita e retry em caso de
  overtake (`detectOvertake`) — C17. Desde então: o log de governação é persistido e restaurado (C18) e uma colisão de revisão igual entre processos é detetada e recuperada por merge forçado (C19). Os três defeitos seguintes foram corrigidos e provados: a leitura nunca é negada por data-encryption (C20), o control plane é imune ao DNA ativo (C21) e todo o veredito não-allow é registado (C22). Falta ainda transação atómica de storage (lock/compare-and-swap real no
  backend) e política de resolução para *mesmo* item editado concorrentemente
  (hoje ganha o snapshot mais recente).

Corolário: para aumentar a cobertura, adiciona-se um claim por cada nova promessa, com a
sua verificação — não se aumenta a prosa.

## Skill governada

Além do prompt injetado, existe uma **skill `behavior-os`** em
`.opencode/skills/behavior-os/SKILL.md`. O v2 descobre-a e o agente carrega-a com a tool
`skill` (ou mencionando `@behavior-os`) quando o pedido envolve governação, DNA, missões,
auditorias ou mudanças de produção. A skill documenta o protocolo de 7 passos, o mapa
intenção→DNA e como interpretar um bloqueio `[Behavior-OS:…]`.

## DNA Patterns Disponíveis
21 padrões carregados dinamicamente:
surgical-team, enterprise-governance, military-operations, lean-factory, devops-pipeline, financial-compliance, healthcare-hipaa, startup-agile, enterprise-sox, research-lab, gaming-studio, iot-embedded, ai-ml-pipeline, blockchain-web3, mobile-app, cloud-native, legacy-modernization, open-source, data-engineering, fintech-trading, quantum-computing
