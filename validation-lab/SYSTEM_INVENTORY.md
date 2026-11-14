# SYSTEM_INVENTORY

What actually exists, and how far it has been proven. Classification:

- **A Implemented** - source exists
- **B Integrated** - wired into a host path
- **C Operational** - executed successfully in this lab or an ambient gate
- **D Experimentally validated** - operational _and_ shown to change behaviour under a controlled experiment
- **E Partial** - works with documented gaps
- **F Missing** - not present
- **G Broken** - present and fails a mandatory check

Facts below were counted from the working tree at `b4124ca5`.

## Repository facts

| Item            | Count                                                             | Source                                     |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Packages        | 6 (`schemas`, `core`, `sdk`, `cli`, `mcp-server`, `orchestrator`) | `packages/`                                |
| Engine files    | 51 (48 engines + facade + types + registry)                       | `packages/core/src/engine`                 |
| DNA patterns    | 21                                                                | `dnas/*.yaml`                              |
| MCP tools       | 98 unique `bos_*` names                                           | `packages/mcp-server/src/server.ts`        |
| Plugin tools    | 102 (98 shared + 4 loop tools)                                    | `verify-tool-parity`                       |
| OpenCode skills | 8                                                                 | `.opencode/skills`                         |
| OpenCode agents | 5 (`researcher`, `planner`, `reviewer`, `auditor`, `builder`)     | `.opencode/agents`                         |
| Commands        | 6                                                                 | `.opencode/commands`                       |
| Tests           | 1497 passed, 0 failed, 8 packages, 131 files                      | `artifacts/raw/pnpm-test.txt`              |
| Lint            | 525 files clean                                                   | `artifacts/raw/pnpm-lint.txt`              |
| Graph           | 3739 nodes / 7231 edges                                           | `artifacts/raw/L02-graph-graph-stats.json` |

**Caveat.** The typecheck artifact reports `11 successful, 11 cached` - it was
served from the Turbo cache, not re-executed. It is evidence that the cache key
matches a previous green run, not that the current dirty tree typechecks. This
lab does not count it as fresh proof.

## Capability inventory

| Capability                                            | Class | Evidence                                                               |
| ----------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| DNA loading + validation (21 patterns)                | D     | `verify-governance` 25/25, labs load real YAML                         |
| Governance evaluation (allow/deny/escalate/transform) | D     | L06 10/12 checks; deny precedence, lenient softening                   |
| Deny-override for control plane / read-only           | G     | G-01: releases denied `export` and `git push`                          |
| Tamper-evident audit chain                            | C     | memory chain + durable JSONL verifier detects edit/gap/head truncation |
| Durable audit sink authority in the plugin            | C     | `bos_verify_audit_trail` prefers the file (`index.ts:1135-1142`)       |
| Role policy, pre-DNA block                            | C     | conformance + L13 pipeline deny                                        |
| Temporal rules                                        | C     | L09: active inside window, inactive outside                            |
| Dynamic policy / risk adaptation                      | C     | L09: strict/lenient, low/high risk multipliers (0.75 vs 2)             |
| Delegation (skills, authority, budget, reservations)  | D     | L04 9/9                                                                |
| Orchestration (deps, idempotency, parallelism)        | D     | L05 13/13                                                              |
| Control loop persistence + resume                     | D     | L14 10/10, no duplicate mission, no re-execution                       |
| Resilience (retry, circuit breaker, timeout)          | C     | L11 8/8                                                                |
| Mission completion evidence gate                      | D     | L12 8/8: missing/simulated/reported rejected                           |
| Persistent memory (SQLite)                            | C     | L07: recall + restart round-trip                                       |
| Learning lifecycle (observation->monitored)           | D     | L08: stage skip and evidence-free validation rejected                  |
| Learning changes governance output                    | D     | L08 corrected: rule applied, fires, warns, ablatable                   |
| Autonomous error discovery                            | F/E   | NOT_VERIFIED - no model-in-the-loop run                                |
| Generalization to a new project                       | F/E   | NOT_VERIFIED - fixture exists, not executed                            |
| Zero-trust identity issuance + verification           | C     | L13: issue, verify, DID mismatch, expiry                               |
| Zero-trust capability authorization                   | G     | S-01: revoked identity still has capability                            |
| Fairness engine + provenance/human oversight          | A/B   | exposed as `bos_evaluate_fairness`; not exercised in this lab          |
| Governance-as-code / compliance mapping               | A/B   | exposed; not exercised here                                            |
| Knowledge graph (learning nodes + edges)              | B     | plugin records learnings into the graph (per claims)                   |
| Graphify code understanding                           | C     | CLI only: 3739-node graph, query/path/explain all answered correctly   |
| Graphify as native plugin tools                       | F     | **0 references to `graphify_*` in plugin source**                      |
| OpenCode V2 plugin (102 tools, hooks)                 | C     | `verify:opencode` 42/42, `verify:plugin` hook report                   |
| MCP server (98 tools, stdio)                          | B     | tool parity PASS; full `smoke:mcp` not run in this session             |
| LLM gateway / router                                  | A     | claims describe it; not exercised here                                 |
| Code edit / code fix engines                          | A     | exposed as tools; not exercised here                                   |
| Multi-provider consensus/brainstorm/conversation      | A     | exposed; not exercised here                                            |

## The honest headline

The **deterministic substrate is real**. Delegation, orchestration, evidence
gating, persistence, resume, and most governance behave as designed under
adversarial input.

Two capabilities are **broken at a mandatory boundary**: the deny-override
classification (G-01) and zero-trust authorization after revocation (S-01).

The **intelligence claims** - autonomous understanding, planning,
self-correction, generalization - are **not disproven, but not verified**. They
need a model in the loop, and this lab refuses to infer them from unit tests.
