# Architecture Alignment Audit — 2026-10-23

Mission `mission-1792751323714-wr2xsdfiqtk` (type: audit) · agent: persona:architect · DNA: Open Source
Method: 2 independent read-only explorer passes (surface/flow + intelligence/decision) + 6 targeted
independently-probed verdicts (`git grep`-verified). No simulated claims: every HIGH/CRITICAL finding
below was confirmed against source lines this session.

## 1. Architecture and flow (measured, not claimed)

```
OpenCode host ─┬─ plugin 32 bos_ tools + 6 hooks (transform/agent/permission/execute.before+after/session.prompt+context)
               │   └─► BehaviorOS facade (packages/core/src/engine/behavior-os.ts, ~60 public methods)
               ├─ MCP 57 bos_ tools + 2 resources (rate-limited per-tool, token bucket)
               ├─ SDK 11 curated methods (+ re-exports facade)
               └─ CLI 12 subcommands (memory-only, no Store)
                     └─► EngineRegistry → 21 engines:
                         decision core: governance, role-policy, mission (S1), pipeline, decision(votes)
                         intelligence:  learning(+records), cross-dna, prediction, recommendation, drift
                         collaboration: brainstorm, behavioral-ux, pragmatic-conversation, antipattern, dynamic-dna, metrics
                         execution:     audit, quality, code-edit
                     Persistence: SQLite/Postgres Store = 9 entity tables + meta K/V (role-policy-state)
                                  plugin = ctx.storage snapshot subset + own JSONL governance log
```

Counts verified: 57 MCP tools · 32 plugin tools · 21 engines · 77 test files / 869 cases ·
Tree clean at commit `7adbbf7`.

## 2. Verdicts by dimension

**Resulado (what the system achieves today):** the governed-execution kernel is real and healthy:
DNA deny/block/escalate → permission deny/ask, mission evidence gates with rollback, orchestrator
retries/circuit breaker, evidence-aware + version-guarded mission completion, honest degradation to
UNVERIFIED, simulated-audit can never PASS, hash-chained plugin governance log. All verified.

**Impacto:** highest value = deterministic governance for mutating actions in OpenCode sessions;
lowest value (dead code, 0 production calls): metrics (`recordGovernanceEvent` has zero callers —
`bos_get_metrics` always zeros), consensus/prediction/cross-dna engines (unreachable by any host),
antipattern/behavioral-ux/brainstorm/pragmatic (memory-only, no governance influence).

**Comportamento:** fail-safe postures verified (unknown role → require; simulated evidence rejected;
denies only add, never force-allow). One deliberate carve-out: control-plane/read-only deny→allow
override in plugin permission hook (index.ts:1926–1929) — documented as bootstrap-escapability,
but invisible in DNA YAML (governance accessibility smell).

**Inteligência:** learning lifecycle obs→lesson→…→monitored exists (plugin-only promotion surface),
evolution proposes rules from failure events — but **the proposal→enforcement loop is dead twice**:
(i) no host passes `evolution.enabled` (verified: grep = 0), (ii) applied condition key
`{type:'pattern'}` never matches real host context bags even when enabled.

## 3. Misalignment findings (ranked)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | HIGH | Learning→governance loop dead: no host sets `evolution.enabled`; applied rule condition `type:'pattern'` can never match host context keys | behavior-os.ts:1001–1048; grep hosts = 0 |
| 2 | HIGH | Protocol step advancement host-divergent: plugin advances on `list_dna`/`get_state`, MCP does not | plugin index.ts:667,1426 vs server.ts |
| 3 | HIGH | LearningRecords (G-014) don't survive SQLite: no Store table, `createLearningRecord` never writes, `hydrateFromStore` never restores; MCP cannot promote records at all | behavior-os.ts:953,1662–1678; store.ts |
| 4 | HIGH | Two disjoint persistence stacks: MCP Store entities vs plugin ctx.storage subset; plugin sessions never persist roles/policies/decisions; MCP never persists learning records | plugin index.ts:59–66,239–247 |
| 5 | HIGH | Same tool, different verdicts per host: `bos_evaluate_governance` plugin enriches condition bag + deny-override; MCP passes raw | server.ts:113–139 vs plugin:599–609 |
| 6 | MED | Metrics pipeline write-dead (`recordGovernanceEvent` 0 callers) + `bos_reset_metrics` reaches into `registry.engines` via unsafe cast | behavior-os.ts:1444; server.ts:1748–1752 |
| 7 | MED | 3 dead engines: consensus, prediction, cross-dna — wired, never reachable from any host | index.ts:133–145; facade 1399/1414/1424 |
| 8 | MED | Dual audit systems: core AuditReports vs plugin-only JSONL governance log (`bos_get_log`/`bos_verify_audit_trail` have no MCP equivalent) | plugin governance-log.ts |
| 9 | MED | Host logic that belongs in the facade: mission filtering duplicated ×2; DNA directory loading ×3 (2 skip schema validation); metrics reset; deny-override policy | server.ts:629–637; plugin:1105–1112; cli.ts:148–155 |
| 10 | MED | SDK drift: 11/~60 methods; `runAudit` extra-required `agentId`; `createMission` drops `requiredChecks` (SDK missions can never be evidence-gated); no completion path | sdk/index.ts:51–68 |
| 11 | MED | CLI lifecycle gap: `autonomous` creates missions it can never close (no complete/fail/cancel/list); `.behavioros/state.json` disconnected from facade state; CLI bypasses facade (`new DriftEngine()`, `SqliteStore.listAgents()`) | cli.ts:598–651; agents.ts:58; drift.ts:78 |
| 12 | MED | RolePolicy is a sandbox, not enforcement: 0 enforcement-path callers (permission hook/orchestrator never consult it); `auto-fix` decision has no consumer | grep plugins = 0 |
| 13 | LOW | Schema mismatches on shared tools: `agent` vs `agentId` (preflight), `applyVotes` alias only in MCP, `select_dna` enum only in plugin; `record_learning` promotion verb plugin-only | §1d of explorer report |
| 14 | LOW | Rate limiting asymmetric: MCP all 57 wrap (but `createServer()` bypasses; comment says "30 tools"); plugin none | server.ts:54–69,76–78 |
| 15 | LOW | 7 collaboration surfaces never persist anywhere (brainstorm, dynamic-DNA+overrides, behavioral-ux, antipattern, pragmatic, metrics, cross-dna); `bos_override_rule` mutations vanish on restart | exportState fields; sqlite tables |
| 16 | LOW | Version-skew defenses in host code (`typeof bos.advanceLearningRecord !== 'function'`, `bos.listMissions?.()`) instead of peer-version checks | plugin:1332,1381; server.ts:632 |

**Docs alignment:** CLAIMS.md rows on evidence provenance, simulated-audit downgrade, lifecycle
snapshot persist — match code. One misleading row: evolution apply gates are accurately described,
but the implied governance effect of applied rules is unattainable (finding #1).

## 4. The one-paragraph answer to "como está a arquitetura"

O kernel de governança de execução é sólido e honesto (evidência, rollback, fail-safe). O sistema
de inteligência é um **jardim de estátuas**: sete subsistemas de colaboração/aprendizagem sem loop
de fechamento, sem persistência e sem influência em decisões; o loop único realmente fechado de
ponta-a-ponta é orchestrator→missão→evidência (humano no gate final). A próxima frase de maior
valor para o sistema não é mais feature nova — é **fechar 3 loops** (evolução→governança,
métricas→painel, roles→enforcement) e **unificar persistência** (plugin ⇄ Store).

## 5. Recommended cycle plan (alignment repairs, ranked)

1. **Fechar o loop de evolução** (2 linhas + env flag nos hosts) — a IA passa a influenciar regras de verdade.
2. **Alimentar métricas** (5 linhas em 3 pontos de chamada) — o sistema passa a medir-se.
3. **Conectar RolePolicy ao enforcement** (permission hook consulta `evaluateRoleAction` pós-DNA).
4. **Unificar persistência** (plugin resolve Store; LearningRecords ganham tabela) — mata #3/#4/#15.
5. **Fachada absorve lógica de host** (resetMetrics, DNA-dir load com validação, filtro de missões, deny-override) — mata #6/#8/#9.
6. **Ostentar 3 engines mortos ou matá-los** (decisão humana de escopo).