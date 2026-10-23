# Behavior-OS — O Sistema Operacional para Equipes de Agentes de IA Autônomas

---

## O Problema

Equipes de IA estão ficando cada vez mais comuns no desenvolvimento de software. Mas sem governança, elas se tornam imprevisíveis:

- **Agentes agem de forma não determinística** — o mesmo prompt gera resultados diferentes
- **Sem trilhas de auditoria** — quem fez o quê, quando e por quê?
- **Governança manual** — revisão humana constante para validar decisões
- **Agentes não aprendem** — erros repetidos, padrões nunca corrigidos
- **Coordenação difícil** — múltiplos agentes trabalhando em silos
- **Reinvente a infraestrutura a cada projeto** — cada equipe constrói do zero

---

## A Solução: Behavior-OS

**Behavior-OS é o sistema operacional para equipes autônomas de agentes de IA.**

Ele define *como* os agentes pensam, decidem, colaboram e aprendem — usando padrões comportamentais baseados em DNA (YAML-driven), pipelines determinísticos e orquestração autônoma.

> Pense no Behavior-OS como o Kubernetes para agentes de IA: governança, orquestração e observabilidade prontas para uso.

---

## Como Funciona

### 1. **DNA Patterns** — O Código Comportamental
Padrões YAML que definem roles, regras de governança, gates de qualidade e workflows. Escolha um padrão pronto ou crie o seu:

```
┌─────────────────────────────────────┐
│  Surgical Team       → Zero defects │
│  Enterprise Gov      → Compliance   │
│  Military Ops        → Chain of cmd │
│  Lean Factory        → Continuous   │
│  Fintech Trading     → Risk limits  │
│  Gaming Studio       → Matchmaking  │
│  ... 21 padrões em `dnas/`          │
└─────────────────────────────────────┘
```

### 2. **Governança em Camadas**
Cada ação é avaliada automaticamente:

| Camada | Função |
|--------|--------|
| Governance | Avalia regras (block/escalate/warn/log/transform) |
| Quality | Gates automáticos (coverage ≥ 80%, lint=0, security=0) |
| Audit | Pipeline multi-estágio (lint → typecheck → security → coverage; simulado por padrão) |
| Learning | Deteção de padrões recorrentes; edições de código só com opt-in + `apply:true` (dry-run por padrão) |
| Decision | Votação ponderada + quorum (majority/supermajority/unanimous) |
| Mission | Ciclo de vida completo (criar → executar → completar) |
| DNA (DNALoader) | Carrega e valida padrões YAML com Zod |

> O `PipelineEngine` (core) executa gates ordenados de forma síncrona: um gate
> `pre` bloqueante veta a ação **antes** de ela correr, em qualquer host.

### 3. **Protocolo de 7 Passos**
Processo determinístico para qualquer tarefa:

```
1. Select DNA Pattern     → Escolha o padrão comportamental (bos_select_dna)
2. Confirm DNA Rules      → Veja o que o padrão permite (bos_list_dna)
3. Resolve State          → Leia o estado atual do protocolo (bos_get_state)
4. Create Mission         → Inicie a missão (bos_create_mission)
5. Start Mission          → Comece a missão (bos_start_mission)
6. Run Audit              → Audite o resultado (bos_run_audit)
7. Record Learning        → Aprenda com o processo (bos_record_learning)
```

Cada passo só avança quando a ferramenta correspondente corre
(`PROTOCOL_STEPS` em `packages/core/src/engine/behavior-os.ts`; o resource MCP
`behavioros://protocol/steps` serve a mesma lista).

---

## Integração com Seu Fluxo Existente

Behavior-OS se conecta aos principais tools via **Model Context Protocol (MCP)**:

| Ferramenta | Status |
|------------|--------|
| Claude Code | ✅ Pronto |
| Cursor | ✅ Pronto |
| VS Code + GitHub Copilot | ✅ Pronto |
| OpenCode v2 | ✅ Plugin nativo |
| Windsurf | ✅ Pronto |

**30 ferramentas MCP** para clientes externos (criação de missões, avaliação de governança, pre-flight de ações, votação/quorum, evolução de DNA, propostas e aplicação de correções de código, edição governada de ficheiros (dry-run por omissão), listagem de resultados, recomendações, drift entre DNAs, execução de auditorias, registro de aprendizados e mais) + **32 tools nativas `bos_*`** no OpenCode v2 via plugin.

---

## Por Que Usar Behavior-OS?

| Sem Behavior-OS | Com Behavior-OS |
|-----------------|-----------------|
| Agentes imprevisíveis | Comportamento determinístico via DNA |
| Sem rastreamento | Auditoria completa de cada ação |
| Revisão manual constante | Governança automatizada |
| Erros se repetem | Engine de aprendizado deteta padrões recorrentes |
| Coordenação difícil | Protocolo de 7 passos + missões rastreáveis |
| Infraestrutura ad-hoc | 21 engines + CLI + SDK prontos |

---

## Demonstração Rápida

```bash
# Inicialize um projeto com um padrão DNA
pnpm cli:init -- --directory ./my-project --dna surgical-team

# Valide e compile os padrões DNA
npx behavioros validate
npx behavioros compile

# Veja o estado do sistema
npx behavioros status
npx behavioros simulate --action deploy --agent my-agent
```

---

## Para Quem é?

- **Equipes de desenvolvimento** que usam agentes de IA (Claude, Cursor, etc.)
- **Empresas reguladas** que precisam de compliance e auditoria
- **Organizações** com múltiplos agentes colaborando
- **Qualquer um** que quer IA autônoma com governança e segurança

---

## Status do Projeto

- ✅ 66 ficheiros de teste / 778 casos (`pnpm test`)
- ✅ 0 erros de typecheck (`pnpm typecheck`, 10/10 tarefas)
- ✅ `pnpm lint:check` limpo (Biome)
- ✅ `pnpm test:coverage` passa (66 ficheiros / 778 casos)
- ✅ Build ESM + DTS
- ✅ v2.0.0

---

## Comece Agora

```bash
pnpm install
pnpm build
pnpm test
```

Ou experimente o SDK:

```typescript
import { BehaviorOS } from '@behavior-os/sdk'

const bos = new BehaviorOS({
  dnaPath: './dnas/surgical-team.yaml',
  quality: { enabled: true, minCoverage: 80 },
  audit: { enabled: true },
  learning: { enabled: true },
})

const mission = bos.createMission({
  title: 'Implement payment module',
  type: 'feature',
  priority: 'high',
})
```

---

**Behavior-OS** — Governança determinística para a era dos agentes de IA.

[GitHub](https://github.com/ilvan-develop/behavioros) · [Documentação](./docs/ARCHITECTURE.md) · [Protocolo](./docs/PROTOCOL.md)
