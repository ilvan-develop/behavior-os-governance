# Sprint 1B — Parallel Task Branches (verified report)

Status: **implemented and verified at package and monorepo level**
Mission: `mission-1793729231171-gr73jdgz4e6` (Lean Factory, agent `agent-audit`)
Audit: `bos_run_audit` with `simulate:false` → **pass**
Learning: `learn-1793796731115-13g3f826r3if`

## Contract

- `ExecuteMissionOptions.maxParallelism?: number`, default `1`.
- With `maxParallelism = 1` the dispatch loop is byte-for-byte equivalent in
  observable behavior to the previous sequential loop (same order, same events,
  same evidence, same outcomes). The 142 pre-existing orchestrator tests are the
  equivalence oracle and still pass.
- A batch contains only **mutually ready** tasks: every `dependsOn` entry is
  already `completed`. A dependent task can never enter the same batch as its
  prerequisite.
- At most `maxParallelism` branches are awaited at once. There is no
  uncontrolled `Promise.all` over the task graph.
- Results are applied **sequentially in plan order** after the batch settles, so
  evidence, events, observer callbacks and result ordering stay deterministic
  and independent of adapter completion order.
- A delegation reservation is released exactly once per scheduled branch in a
  `finally`, including when the branch rejects.
- A failing branch no longer discards results that already completed in the
  same batch; the failure is recorded and the remaining settled results are
  applied. Dispatch of later batches stops after a terminal failure, matching
  the previous fail-fast contract.
- Non-finite or `NaN` `maxParallelism` is treated as `1` (prevents an empty
  batch from spinning the loop).

## Implementation

- `packages/orchestrator/src/orchestrator.ts`
  - `ExecuteMissionOptions.maxParallelism`.
  - Batched, bounded dispatch (`readyTasks` → `batch` → controlled
    `Promise.all` → sequential result application).
  - Per-branch delegation release in `finally`; reservation cancel on refusal,
    governance block, observer failure and pre-`markStarted` exit.
- `packages/orchestrator/tests/orchestrator.test.ts`
  - New `describe('AutonomousOrchestrator parallel branches')` with 5 tests.

## Tests added

1. `runs independent branches concurrently up to maxParallelism` — peak
   in-flight adapters is exactly 2 with `maxParallelism: 2` and 4 tasks; results
   are in plan order.
2. `is strictly sequential by default` — omitting the option yields peak 1.
3. `never starts a dependent task before its prerequisite completes` — the
   dependent adapter observes the prerequisite already completed.
4. `keeps independent results when a sibling branch fails in the same batch` —
   with `maxParallelism: 3`, tasks end `completed / failed / completed`; the
   successful independent branch keeps its result.
5. `cancels in-flight branches when the caller aborts` — aborting the caller
   signal while two branches are in flight yields mission outcome `cancelled`.
6. `times out one branch without losing its sibling result` — a branch with
   `timeoutMs: 25` fails with `TIMEOUT` while its concurrently running sibling
   completes and keeps its result.
7. `resumes a partially proven parallel batch and runs only the unproven
   branches` — a task with executed evidence is skipped with `attempts: 0`, and
   the two unproven siblings fill the batch and run concurrently (peak 2).

## Verification evidence (forced, no turbo cache)

All commands were run from the repository root unless stated.

| Gate                | Command                                                                  | Result                              |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Orchestrator tests  | `packages/orchestrator`: `node ../../node_modules/vitest/vitest.mjs run` | exit 0 — 8 files, **147/147** tests |
| Full suite (forced) | `pnpm test --force`                                                      | exit 0 — **1297** tests, 0 failed   |
| Typecheck           | `pnpm typecheck`                                                         | exit 0                              |
| Lint                | `pnpm lint:check`                                                        | exit 0 (`biome check .`)            |
| Build               | `pnpm build`                                                             | exit 0; orchestrator `tsc` 0 errors |
| Whitespace          | `git diff --check`                                                       | exit 0 (CRLF advisory only)         |
| Governance audit    | `bos_run_audit` `simulate:false`                                         | pass                                |

Forced-suite breakdown:

- `@behavior-os/core` 852
- `@behavior-os/opencode-plugin` 177
- `behavioros-orchestrator` 147
- `@behavior-os/mcp-server` 45
- `@behavior-os/schemas` 35
- `@behavior-os/cli` 22
- `@behavior-os/sdk` 15
- `behavioros-examples` 4

## Pre-existing drift exposed by the forced run

The earlier "full suite green" result in this session was a turbo **cache hit**.
Running the suite with `--force` surfaced pre-existing inconsistencies that
predate Sprint 1B. They were corrected without weakening any gate:

- Duplicate MCP registration in `opencode.json` (`mcp.servers.behavioros`)
  removed; the plugin is the native integration (see `AGENTS.md`).
- Stale counts aligned to the measured source: MCP tools `86`, plugin tools
  `71`, engines `48` across `AGENTS.md`, `README.md`, `GUIDE.md`,
  `CONTRIBUTING.md`, `PITCH.md`, `docs/CLAIMS.md`,
  `docs/ARCHITECTURE_DEEP_DIVE.md`, and `packages/mcp-server/package.json`.
- Unsorted imports/exports in `packages/core/src/engine/behavior-os.ts`,
  `packages/core/src/engine/index.ts` and `packages/mcp-server/src/server.ts`
  fixed with the repository's own Biome formatter.

## Hardening update (2026-11-04)

Two dedicated tests close the residual gaps listed below:

- `times out one branch without losing its sibling result` — a branch with
  `timeoutMs: 25` fails with `TIMEOUT`; its concurrently running sibling
  completes and keeps its result.
- `resumes a partially proven parallel batch and runs only the unproven
  branches` — a task with executed evidence is skipped with `attempts: 0`, and
  the two unproven siblings fill the batch and run concurrently (peak 2).

The resume test exposed a real slot-accounting bug: a task already proven by
executed evidence was included in the `maxParallelism` slice before the skip
check, so it consumed a concurrency slot and the unproven siblings ran
sequentially. The dispatcher now includes proven tasks without consuming a
slot, preserving plan order while letting unproven siblings fill the batch.

Evidence: orchestrator suite **149/149** (was 147); full forced suite **1315**
tests (was 1297: +16 Sprint 2 tests, +2 hardening tests); typecheck, lint and
build exit 0. Breakdown: schemas 35, core 868, sdk 15, cli 22, mcp-server 45,
orchestrator 149, plugin 177, examples 4.

## Residual limitations (not claimed as solved)

- **Idempotency is in-process only.** The `idempotencyByKey` map is not
  persisted, so the guarantee remains _at-least-once with deduplication_, not
  exactly-once. A retry after a process restart can re-execute protected work.
- **Fail-fast after a batch.** Independent results are preserved within the
  settled batch, but later batches are not dispatched after a terminal failure.
- **Adapter limitations** are unchanged: an adapter that ignores the abort
  signal cannot make the orchestrator report success, but the orchestrator
  cannot undo side effects an adapter already performed.

## Not done

- No commit, push, tag, publish or deploy was performed.
- The 11 dependency-security findings remain in the separate security backlog.
