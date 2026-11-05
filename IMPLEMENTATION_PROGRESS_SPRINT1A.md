# Behavior OS — Sprint 1A Implementation Progress

**Sprint**: 1A — Idempotency Enforcement  
**Authorized**: YES — per Phase 1 authorization protocol  
**Status**: COMPLETE — implemented, hardened and verified locally (uncommitted)

## Implementation

### 1. Idempotency map

```typescript
private readonly idempotencyByKey = new Map<string, TaskResult>();
```

In-process only. The guaranteed semantics are **at-least-once execution with
deduplication**, not exactly-once: only effects an adapter reported before the
result was persisted are covered.

### 2. Cache check in `executeTask` (before the retry loop)

- Same task id and cached `status === 'completed'` → return
  `structuredClone(cached)`. The clone is schema-valid and carries
  `evidence`, `acceptance`, `error`, `completedAt` and provenance, so
  downstream `taskResult.evidence.length` cannot crash.
- Cached result bound to a **different task id** → fail closed with
  `INVALID_INPUT` (`blocked`). Silently reusing another task's result would
  claim its gates passed without running it.
- Same task, cached in a non-terminal, non-`failed` state (e.g. `running`,
  `dispatched`, `blocked`) → fail closed with `INVALID_INPUT` and require human
  reconciliation.
- No cached row, or a prior attempt `failed` → fall through to the retry loop.

### 3. Caching after completion

```typescript
if (task.idempotencyKey && taskResult.status === 'completed') {
  this.idempotencyByKey.set(task.idempotencyKey, structuredClone(taskResult));
}
```

## Earlier TypeScript issue (resolved)

The original implementation hand-built a cached return object and invented
`result` / `executionId` properties that `TaskResult` does not have; TypeScript
correctly rejected it and the object also omitted the required `evidence` field.
It is replaced by `structuredClone(cached)` — no casts, no invented fields.

## Tests

New regression test in
`packages/orchestrator/tests/orchestrator.test.ts`:

> `fails closed when one idempotency key is reused by a different task`

Two tasks share a key: the adapter runs once, the first task completes, the
second is `blocked` with `INVALID_INPUT` and does not borrow the first task's
evidence.

Existing coverage retained: mission-level replay without a second dispatch,
skip by executed evidence, gate isolation, and control-loop key integrity.

## Verification evidence (this run)

| Gate                        | Result                                         |
| --------------------------- | ---------------------------------------------- |
| `pnpm build` (orchestrator) | 0 `error TS`                                   |
| Orchestrator tests (fresh)  | 142 / 142 passed (8 files)                     |
| Plugin tests (fresh)        | 177 / 177 passed (12 files)                    |
| Full monorepo `pnpm test`   | exit 0 (orchestrator cache miss, ran fresh)    |
| `pnpm typecheck`            | exit 0                                         |
| `pnpm lint:check`           | exit 0                                         |
| `git diff --check`          | exit 0                                         |
| `pnpm verify:governance`    | FAIL — C09, pre-existing state-dependent check |

### C09 finding (pre-existing, not caused by Sprint 1A)

`scripts/governance-conformance.mjs` C09 does
`target = missions[missions.length - 1]` from
`bos_list_missions({ limit: 50 })` instead of using the id of the mission it
just created. With 175+ accumulated missions the truncated list's last element
is an old **completed** mission, so `bos_start_mission` cannot set
`activeMission` and the check fails. The tracked baseline
(`generatedAt 2026-10-30`) records C09 PASS for the same code, proving it is
data/ordering dependent; a fresh store (as in CI) keeps the created mission
within the limit and passes. This diff touches only `packages/orchestrator/*`,
its tests and `opencode.json` — never core list/start.

Recommended follow-up (separate concern): use the mission id returned by
`bos_create_mission` instead of indexing a truncated list. Do not weaken the
check.

## Next steps

1. Sprint 1B — parallel task branches (plan in `SPRINT1B_PLAN.md`).
2. Sprint 2 — policy versioning and rollback.

No commit, push, tag, publish or deploy was performed.
