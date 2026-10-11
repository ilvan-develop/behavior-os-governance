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
│  E-Commerce          → Transactions │
│  Gaming              → Matchmaking  │
│  ... e 15+ padrões │
└─────────────────────────────────────┘
```

### 2. **Governança em Camadas**
Cada ação é avaliada automaticamente:

| Camada | Função |
|--------|--------|
| Governance | Avalia regras (block/escalate/warn/log) |
| Decision | Votações com quorum configurável |
| Quality | Gates automáticos (coverage ≥80%, lint=0, security=0) |
| Audit | Pipeline multi-estágio (lint → typecheck → security → coverage) |
| Learning | Detecção de padrões e aplicação automática de correções |
| Mission | Ciclo de vida completo (criar → executar → completar) |

### 3. **Protocolo de 7 Passos**
Processo determinístico para qualquer tarefa:

```
1. Select DNA Pattern     → Escolha o padrão comportamental
2. Display DNA Block      → Mostre ao humano para aprovação
3. Resolve Truth          → Verifique requisitos
4. Create Mission         → Inicie a missão
5. Delegate               → Execute com delegação
6. Run Audit              → Audite o resultado
7. Record Learning        → Aprenda com o processo
```

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

**11 ferramentas MCP** para clientes externos (criação de missões, avaliação de governança, execução de auditorias, registro de aprendizados e mais) + **12 tools nativas `bos_*`** no OpenCode v2 via plugin.

---

## Por Que Usar Behavior-OS?

| Sem Behavior-OS | Com Behavior-OS |
|-----------------|-----------------|
| Agentes imprevisíveis | Comportamento determinístico via DNA |
| Sem rastreamento | Auditoria completa de cada ação |
| Revisão manual constante | Governança automatizada |
| Erros se repetem | Engine de aprendizado com correção automática |
| Coordenação difícil | Protocolo de handoff entre agentes |
| Infraestrutura ad-hoc | 6 engines + CLI + SDK prontos |

---

## Demonstração Rápida

```bash
# Inicialize
pnpm create behavior-os my-project
cd my-project

# Selecione um padrão DNA
npx bos select-dna surgical-team

# Crie uma missão
npx bos create-mission --title "Implementar checkout" --type feature --priority high

# Execute com governança integrada
npx bos run
```

---

## Para Quem é?

- **Equipes de desenvolvimento** que usam agentes de IA (Claude, Cursor, etc.)
- **Empresas reguladas** que precisam de compliance e auditoria
- **Organizações** com múltiplos agentes colaborando
- **Qualquer um** que quer IA autônoma com governança e segurança

---

## Status do Projeto

- ✅ 253+ testes passando
- ✅ 0 erros de typecheck
- ✅ Build ESM + CJS + DTS
- ✅ Cobertura >80%
- ✅ v2.0.0 estável

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

const mission = await bos.createMission({
  title: 'Implement payment module',
  type: 'feature',
  priority: 'high',
})
```

---

**Behavior-OS** — Governança determinística para a era dos agentes de IA.

[GitHub](https://github.com/ilvan-develop/behavioros) · [Documentação](./docs/ARCHITECTURE.md) · [Protocolo](./docs/PROTOCOL.md)
