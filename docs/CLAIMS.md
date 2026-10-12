# CLAIMS — Verificação de afirmações (Behavior-OS)

> Documento único de verdade. Cada afirmação pública é cruzada com o código real.
> Sempre que algo não existe, é dito explicitamente. Última auditoria: ver
> `git log` e os comandos no fim deste ficheiro.

## Como verificar (comandos)

```bash
# Motores reais (esperado: audit, behavior-os, dna-loader, governance, learning, mission, quality)
ls packages/core/src/engine/*.ts

# Linhas por motor
wc -l packages/core/src/engine/*.ts

# Tools MCP (esperado: 12) e resources (esperado: 2)
grep -c "registerTool(" packages/mcp-server/src/server.ts
grep -c "registerResource(" packages/mcp-server/src/server.ts

# Ficheiros DNA (esperado: 21)
ls dnas/*.yaml | wc -l

# Schemas Zod (esperado: 20 objetos)
grep -c "z.object(" packages/schemas/src/index.ts

# SQLite (esperado: 0 no código)
grep -ri "sqlite" packages plugins --include=*.ts
```

## Tabela de afirmações

| Afirmação | Estado | Realidade verificada |
|---|---|---|
| 10 motores operacionais | ❌ | **6** motores reais + fachada `BehaviorOS` + `EngineRegistry`. Não existem Decision/Behavioral/Pipeline/Compiler. |
| GovernanceEngine com 609 linhas | ❌ | **126** linhas. |
| QualityEngine com 618 linhas | ❌ | **59** linhas. |
| AuditEngine com 1347 linhas | ❌ | **160** linhas. |
| PipelineEngine com 657 linhas | ❌ | Ficheiro **não existe**. |
| 9 camadas de validação (runtime) | ❌ | Diagrama conceptual; sem pipeline de 9 gates. |
| 30 tools & 7 resources MCP | ❌ | **12 tools + 2 resources** (server) / **14 tools** (plugin). |
| 29 schemas Zod | ❌ | **20** `z.object` (+10 enums). |
| 16 ficheiros YAML / 4 padrões | ❌ | **21** ficheiros DNA. |
| SQLite / tabelas relacionais | ✅ | `SqliteStore` no core (módulo nativo `node:sqlite`, sem dependência) com tabelas `missions`, `learnings`, `agents`, `audit_log`, `meta`. Ativa-se com `persistence: { path }` ou `BEHAVIOROS_DB_PATH`. |
| Trilho de auditoria imutável | ✅ tamper-evident | Log append-ordered com **hash-chain SHA-256** (`verifyGovernanceLog`, tool `bos_verify_audit_trail`). É deteção de adulteração, não armazenamento WORM. |
| 7 algoritmos matemáticos | ❌ | Só contagem por tipo de evento + recomendações. |
| Auto-evolução do DNA com confiança > 80% | ❌ | Não existe auto-apply nem limiar de confiança. |
| 10 estágios de auditoria | ❌ | `AuditStageSchema` tem **6**; por omissão corre **4**. |
| `authority_level: 3` | ❌ | Campo real: `authority: string` (ex.: `operator`). |
| Gate 2 real (Biome, tsc, pnpm audit) | ⚠️ | Verdade **apenas** com `simulate: false`; por omissão é simulado e passa sempre. |
| Hierarquia block → escalate → warn → log | ✅ | Implementada em `governance-engine.ts`. |
| Bloqueio antes da execução | ✅ (plugin) | `ctx.permission.hook('evaluate')` → `deny`/`ask`, só com DNA ativo e só em ações que mudam estado. |
| Protocolo de 7 passos rastreável | ✅ | `behavior-os.ts` + `AgentState.stepHistory`. |
| MCP real (não vaporware) | ✅ | 12 tools + 2 resources funcionais. |
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

## O que ainda NÃO existe (roadmap)

- Persistência em Postgres remoto (o SQLite local já existe).
- Pipeline de N gates com bloqueio síncrono pré-execução fora do plugin OpenCode.
- Motor de decisão por votação/quorum.
- Aplicação automática de correções pelo LearningEngine.
