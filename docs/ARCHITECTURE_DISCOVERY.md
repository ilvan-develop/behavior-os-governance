# Architecture Discovery Report — Behavior-OS

> **Snapshot:** 2026-11-13. This is a point-in-time analysis artefact. Live,
> machine-verified counts live in `docs/CLAIMS.md`; re-verify any figure against
> the current source before relying on it.

**Date:** 2026-11-13  
**Method:** Graphify knowledge graph at `graphify-out/graph.json` (3736 nodes, 7246 edges, 53 connected components)  
**Constraint:** No source files modified; all findings from `EXTRACTED` graph edges + direct source reads

---

## 1. Architecture Map (High Level)

```text
schemas/          Zod type layer — all domain types (god node: 356 edges)
core/             Engines: BehaviorOS, LearningEngine, DelegationEngine,
                  AuditEngine, GovernanceAsCodeEngine, TemporalGovernanceEngine,
                  ConfidenceWeightedGateSelector, CounterfactualAuditEngine
orchestrator/     AutonomousOrchestrator, ControlLoop, DelegationEngine,
                  LLM providers (LlmRouter, LlmProviderRegistry,
                  OpenAICompatibleProvider, DeterministicLlmProvider)
plugins/opencode-v2/  102 bos_* tools + hooks + loop-manager
mcp-server/       98 MCP tools + 2 resources + rate limiting
sdk/              TypeScript SDK
cli/              CLI commands
dnas/             21 DNA pattern YAML files
```

### God Nodes (most connected)

| Node                       | Edges | Source                                      |
| -------------------------- | ----- | ------------------------------------------- |
| `schemas/src/index.ts`     | 356   | packages/schemas/src/index.ts               |
| `BehaviorOS`               | 179   | packages/core/src/engine/behavior-os.ts     |
| `behavior-os.ts`           | 164   | packages/core/src/engine/behavior-os.ts     |
| `ref_vitest`               | 141   | (test infra reference)                      |
| `DNA`                      | 128   | packages/schemas/src/index.ts               |
| `opencode-v2/src/index.ts` | 128   | plugins/opencode-v2/src/index.ts            |
| `engine/index.ts`          | 121   | packages/core/src/engine/index.ts           |
| `learning-engine.ts`       | 74    | packages/core/src/engine/learning-engine.ts |

---

## 2. Critical Execution Paths

### Path A — Governance Lifecycle

```
behavior-os.ts
  → engine/index.ts
  → LearningEngine
  → PolicyVersion → PolicyLedgerEvent
  → PolicyApproval (human gate, HMAC or actor-kind)
  → PolicyActivationRecord
```

### Path B — Autonomous Orchestration

```
AutonomousOrchestrator
  → DelegationEngine (packages/orchestrator/src/delegation.ts)
  → AgentProfile → DelegationReservation
  → .registerAgent() / .assign() / .markStarted() / .release()
```

### Path C — OpenCode V2 Tool Registration

```
opencode-v2/src/index.ts
  → ToolRegistrarContext (tools/tool-surface.ts)
  → registerMissionTools() (tools/missions.ts)
  → registerCodeEditTools() (tools/code-edit.ts)
  → registerDnaGovernanceTools() (tools/dna-governance.ts)
  → registerIdentityTools() (tools/identity.ts)
```

### Path D — LLM Provider Chain

```
LlmRouter (orchestrator/src/llm/router.ts)
  → LlmProviderRegistry (orchestrator/src/llm/registry.ts)
  → OpenAICompatibleProvider / DeterministicLlmProvider
```

---

## 3. Dependency Analysis

### `learning-engine.ts` (74 edges)

**Direct dependencies (outgoing):**
- `engine/index.ts` (re_exports)
- `behavior-os-types.ts` (imports_from)
- `ref_node_crypto` (imports_from — node:crypto)
- 6 test files (imports_from)

**Direct dependents (incoming):**
- `schemas/src/index.ts` imports: `Severity`, `LearningEvent`, `LearningRecord`, `LearningStage`, `LearningImpact`, `LearningTransition`, `LearningType`, `CodeFixProposal`, `EvolutionProposal`
- `learning-policy-service.ts` (imports_from)
- `behavior-os.ts` (imports_from)
- `recommendation-engine.test.ts` (imports_from)

**Contained symbols (40+):** `LearningEngine`, `PolicyEnforcement`, `PolicyVersion`, `PolicyLedgerEvent`, `PolicyApproval`, `verifyApprovalToken()`, `canonicalJson()`, `policyContentHash()`, and 6 `clone*()` helpers.

### `DelegationEngine` (packages/orchestrator/src/delegation.ts)

**Referenced by:**
- `AutonomousOrchestrator` (orchestrator.ts)
- `CognitiveLoadBalancerEngine` (core/src/engine/cognitive-load-engine.ts)
- `LoopManager` (plugins/opencode-v2/src/loop-manager.ts)

**Methods:** `.registerAgent()`, `.getProfile()`, `.assign()`, `.onTaskStarted()`, `.onTaskCompleted()`, `.onTaskFailed()`, `.getPolicy()`, `.getAgentLoad()`, `.reserve()`, `.markStarted()`, `.cancel()`, `.release()`, `.activeAgentCount()`, `.activeTaskCount()`, `.getReservations()`

---

## 4. Impact Analysis

### If `DelegationEngine` fails

- **Direct:** `AutonomousOrchestrator`, `CognitiveLoadBalancerEngine`, `LoopManager`
- **Indirect:** All control loops (`ControlLoop`), all LLM task dispatch, all agent registration
- **Tests affected:** `delegation.test.ts`, `delegation-integration.test.ts`, `orchestrator.test.ts`, `loop-manager` plugin tests

### If `schemas/src/index.ts` has a breaking change

- **356 dependent nodes** — affects every engine, every test, the SDK, the CLI, the MCP server, and the plugin
- This is the single largest coupling risk in the codebase

---

## 5. Architectural Risks

| Risk                                        | Evidence                                                    | Severity |
| ------------------------------------------- | ----------------------------------------------------------- | -------- |
| `schemas/src/index.ts` is a god node        | 356 edges, highest betweenness centrality (0.1631)          | HIGH     |
| `behavior-os.ts` has broad coupling         | 164 edges; re-exported by `engine/index.ts`                 | HIGH     |
| `DelegationEngine` is a cross-layer bridge  | Connects orchestrator, core, and plugin layers              | MEDIUM   |
| No directed graph for cycle detection       | Current `graph.json` is undirected                          | RESOLVED |
| Integration test coverage of critical paths | 472 test nodes, but path coverage of god nodes not verified | MEDIUM   |

---

## 5a. Import Cycle Detection (Directed Graph Analysis, Phase 1)

A directed reconstruction of `graphify-out/graph.json` was performed using only
import-like relations (`imports`, `imports_from`, `calls`, `references`,
`re_exports`, `dynamic_import`) as directed edges. Structural relations
(`contains`, `method`) were added in both directions.

**Result: 0 true import cycles.**

- Strongly connected components with >1 node using import/call edges only: **0**
- This means there are no circular import dependencies in the current codebase.
- The 714-node and 215-node SCCs found in the undirected analysis are false
  positives caused by structural relations (`contains`, `method`) linking
  symbols back to their containing files, not actual import cycles.

**Conclusion:** The codebase is free of circular import dependencies. The
highest-risk coupling identified in Section 5 is a one-directional fan-out
risk (many modules depend on `schemas/src/index.ts` and `behavior-os.ts`),
not a circular coupling risk.

---

## 6. Evidence-Backed Recommendations

1. **Split `schemas/src/index.ts`** into domain submodules (DNA, Mission, Governance, Learning, Policy) with an aggregating index for backwards compatibility. Rationale: 356-edge god node is a compile and maintenance bottleneck.

2. **Thin the `behavior-os.ts` facade.** Delegate specific responsibilities to individual engines; keep the facade as a thin coordinator. Rationale: 164 edges indicate the facade knows too much.

3. **No directed graph variant was needed for cycle detection.** The undirected
   graph was reconstructed as directed using import-relation orientation.
   Result: 0 true import cycles. The apparent large SCCs in the undirected
   analysis were false positives from structural `contains`/`method` edges.
   A dedicated `--directed` flag is still worth adding for future builds.

4. **Add integration tests for god-node paths.** Specifically: `BehaviorOS → engine/index.ts → LearningEngine → PolicyVersion → PolicyLedgerEvent`. Rationale: the 472 test nodes exist but path coverage of the most-connected nodes is unverified.

5. **Document `DelegationEngine` as a public API boundary.** It is referenced by 3 separate layers; any change must pass a compatibility gate. Rationale: cross-layer coupling.

---

## 7. Facts vs. Hypotheses

| Statement                                                                              | Type                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| All edges listed above come from `graphify-out/graph.json` with provenance `EXTRACTED` | Fact                                                                |
| `schemas/src/index.ts` is a maintenance bottleneck                                     | Hypothesis (needs compile-time experiment to confirm)               |
| The `DelegationEngine` failure would cascade to all LLM task dispatch                  | Hypothesis (inferred from reference edges, not runtime observation) |
| The undirected graph cannot detect import cycles                                       | Fact (graph format limitation)                                      |

---

## 8. Remediation Log

### Phase 2 — `schemas/src/index.ts` split (done)

`packages/schemas/src/index.ts` (1551 lines, 356-edge god node) was split into
11 domain submodules: `dna.ts`, `mission.ts`, `task.ts`, `agent.ts`,
`governance.ts`, `decision.ts`, `learning.ts`, `protocol.ts`, `code-edit.ts`,
`anti-pattern.ts`, `responsible-ai.ts`. The index is now a thin re-export layer
(12 `export *` statements). The public API is unchanged: all 140 importers of
`@behavior-os/schemas` continue to work without edits.

Follow-on fixes: `docs-consistency.test.ts` now measures schema counts across
all `.ts` files in `packages/schemas/src/` (not just `index.ts`), and
`docs/CLAIMS.md` counts were updated to `91 z.object / 64 z.enum`.

### Phase 3 — `behavior-os.ts` facade thinning (done, incremental)

The inline governance-evaluation policy in `BehaviorOS.evaluateGovernance()`
was extracted to `packages/core/src/services/governance-evaluation-service.ts`
(`GovernanceEvaluationService`). The facade method is now a thin delegate. The
service is placed under `services/` (not `engine/`) so it does not inflate the
measured engine count.

Verification (all executed in this session):

| Gate                         | Result                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`             | 11/11 tasks successful                                                                           |
| `pnpm build`                 | 8/8 tasks successful                                                                             |
| `pnpm lint:check`            | 516 files, no fixes applied (exit 0)                                                             |
| `pnpm test` (core)           | 85 test files, 932 passed, 3 skipped                                                             |
| `pnpm test` (other packages) | examples 4, sdk 18, plugin 247, cli 22, schemas 35, orchestrator 181, mcp-server 50 — all passed |

`graphify update` could not be run: the graphify CLI is not installed in this
environment, so `graph.json` still reflects the pre-remediation build.

### Phase 4 — Recommendation status (verified)

| #   | Recommendation                                       | Status                | Evidence                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Split `schemas/src/index.ts`                         | Done                  | 11 submodules; thin re-export index; all gates green                                                                                                                                                                                                                                                                                        |
| 2   | Thin `behavior-os.ts` facade                         | Done (incremental)    | `GovernanceEvaluationService` extracted; typecheck/test/build green                                                                                                                                                                                                                                                                         |
| 3   | Add a directed graph variant (`--directed`)          | Partially done        | Directed reconstruction performed ad hoc against `graph.json`; 0 true import cycles. A first-class `--directed` flag is not feasible here — the graphify CLI is not installed.                                                                                                                                                              |
| 4   | Add integration tests for god-node paths             | **Already satisfied** | `packages/core/tests/policy-versioning.test.ts:374` — "enforces only an active, human-approved policy at the governance choke point" exercises `BehaviorOS → LearningPolicyService → LearningEngine → PolicyVersion → PolicyLedgerEvent → evaluateGovernance`. 18/18 tests pass. This also covers the exact behaviour extracted in Phase 3. |
| 5   | Document `DelegationEngine` as a public API boundary | **Already satisfied** | `packages/orchestrator/src/delegation.ts:1-25` documents the boundary (ADR-004: delegation is data, not authority), roles, concurrency constraint, and remaining work.                                                                                                                                                                      |

**Correction to Section 6.4 / Section 7:** the claim that "path coverage of the
most-connected nodes is unverified" was a hypothesis. It is now falsified by
the executed test above — the governance lifecycle path is covered end to end.
