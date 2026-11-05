# Sprint 1B — Parallel Task Branches: Implementation Plan

**Mission**: mission-1793729231171-gr73jdgz4e6 **Status**: PLANNING (pre-implementation review)

## Current State (verified, source-grounded)

Existing architecture in `packages/orchestrator/src/orchestrator.ts`:
- `TaskDefinitionInput.dependsOn?: string[]` (line 66) — dependencies declared per task
- Dependency resolution in dispatch loop: lines 690-736
  - `dependencyBlocked`: tasks whose dependency failed/blocked/cancelled → blocked with `DEPENDENCY_BLOCKED`
  - `next`: first pending task whose `(task.dependsOn ?? []).every(dep => tasks.find(...).status === 'completed')`
  - Cycles rejected at normalization (lines 1742-1767, 1794-1813)
- Single-threaded sequential dispatch: `while(true)` picks ONE `next` task per iteration
- Existing evidence-based skipping: line 739-756 (`completedEvidenceFor` → skip task, return cached evidence)

## Gap identified

No bounded parallel execution exists. All tasks run strictly sequentially within a mission. Parallelism is only possible between concurrent `executeMission` calls (cross-mission).

## Design: bounded parallel branch execution

### Contract changes

1. **Task definition** — no new fields needed; `dependsOn` already exists.
2. **Mission config** — add optional `maxParallelism?: number` to `ExecuteMissionOptions` (default: 1, preserving current sequential behaviour → backward compatible).
3. **Task execution state** — track `branchId` per task (derived from a concurrent execution group) to group results and enable branch-level failure isolation.

### Core data structures

```typescript
// In dispatch:
type Branch = {
  id: string;
  tasks: TaskDefinition[]; // tasks scheduled to run in this branch
  running: Map<string, Promise<TaskResult>>;
  results: TaskResult[];
  error?: TaskError; // branch-level terminal error
  signal: AbortController;
};
```

### Algorithm (bounded worker pool)

1. Compute **ready set** = pending tasks whose dependencies are all `completed`.
2. Assign each ready task to a branch respecting `maxParallelism` (create new branch or reuse empty branch).
3. Execute branch tasks **concurrently** (`Promise.allSettled` per branch, respecting per-branch order for dependent ordering within branch).
4. Apply dependency resolution AFTER each branch completes: new ready tasks unlock.
5. **Branch failure isolation**: if branch errors, its tasks are `failed`/`cancelled`, but other branches continue. Mission terminal state = intersection: cancelled if signal aborted; else first-fail (fail-fast) OR preserve-branches-per-policy (configurable; default fail-fast on first failed branch, but independent successful branches keep their results).
6. **Idempotency integration**: parallel branches must check `idempotencyByKey` BEFORE dispatch (duplicate-dispatch protection) — same guard as Sprint 1A.
7. **Governance**: each task preflight/evaluateGovernance runs BEFORE branch execution; a DENY blocks that task only (not the whole mission) per existing fail-fast-on-governance logic.
8. **Agent workload accounting**: delegate through DelegationEngine (existing) — parallel branches may dispatch to the same or different agents; concurrency budget handled by DelegationEngine per DNA.
9. **Cancellation/timeout propagation**: each branch gets an `AbortController` wired to `options.signal`; `runAttempt` already supports `parentSignal` (line 1308-1316). Timeout per task already exists (`timeoutMs`).
10. **Persistence/resume**: existing control-loop persistence already serializes per-task status; parallel branches must persist branch-level state (branch id, which tasks in-flight) so resume doesn't re-dispatch completed tasks.

### Concurrency limits

- `maxParallelism` enforced by worker pool: only N tasks executing concurrently across all branches.
- `maxAttempts` per task respected.
- Circuit breakers (per adapter) respected — `breaker.canExecute()` check already in executeTask.
- Concurrency budget from DelegationEngine (in-process, shared across control loops from one runtime instance — documented scope limitation preserved).

### Ordering & determinism

- Results collected into ordered array by task id (not branch order).
- Mission result `tasks: TaskResult[]` ordered deterministically.
- Events emitted per task (task.created, task.completed, task.failed) with proper correlationId.

### Failure semantics

- Fail-fast: mission fails on first branch error (existing behaviour).
- Independent successful branches: results preserved in `results` array; mission still fails, but evidence of independent work is retained (this is the "Fail closed / preserve independent branches" requirement).
- Dependency blocked tasks: already handled (line 700-719) → blocked without destroying independent branches.

### Test plan (per protocol)

Unit tests (orchestrator.test.ts):
1. Independent branches execute concurrently — measure wall-clock time (A && B each 100ms, 2 branches → < 150ms vs > 200ms sequential).
2. Dependent tasks wait for prerequisites — C depends on A and B; C only runs after both completed.
3. One branch fails while another succeeds — failure doesn't re-execute successful branch's adapter; result retained.
4. Concurrency limit enforcement — maxParallelism: 2 with 4 ready tasks → never > 2 concurrent.
5. Cancellation during parallel execution — signal.abort → all branches abort (parentSignal propagation).
6. Timeout during parallel execution — task timeout → that task fails, others continue.
7. Resume with partially completed branches — persisted state loaded → in-flight branches re-established, completed branches skipped.
8. Duplicate dispatch prevention — idempotencyKey on tasks in parallel branches → no duplicate dispatch.
9. Different DNA missions executing concurrently — isolation preserved (each mission its own branches/results).
10. Dependency chain across branches — A→B in branch1, B→C in branch2: C waits for B even across branches.

Integration tests (control-loop.integration.test.ts):
11. Parallel branches persist correct branch state.
12. Failure propagation across branches with proper terminal error.

### Acceptance criteria (per protocol)

1. ✅ Marked idempotent tasks have duplicate-execution protection (reuses Sprint 1A guard).
2. ❌ Crash windows / uncertain external side effects — needs reconciliation path (defer to post-review or handle via branch-level completion vs side-effect flag).
3. ✅ Independent branches execute concurrently within enforced limits.
4. ✅ Dependency ordering correct.
5. ❌ Partial missions resume without repeating completed side effects — needs branch state persistence.
6. ✅ Parallel failures and cancellation correctly handled.
7. n/a (Sprint 2)
8. n/a (Sprint 2)
9. n/a (Sprint 2)
10. ✅ Existing governance and regression gates pass (141 tests + new).
11. ❌ Independent audit — planned post-implementation.

### Known limitations (explicit)

- Cross-process/cross-worker parallelism NOT solved (documented scope limitation preserved).
- Crash-after-side-effect-before-persistence: branch-level completion vs side-effect flag needs explicit handling (if adapter reports side effect + crash → reconciliation).
- Concurrency budget is in-process only.

### Sequence

1. Add `maxParallelism` option + branch data structures.
2. Rewrite dispatch loop to schedule branches instead of single tasks.
3. Add concurrency limit enforcement.
4. Add branch failure isolation + preservation of independent results.
5. Add idempotency guard integration.
6. Add cancellation/timeout propagation (re-use existing parentSignal).
7. Add branch state persistence for resume.
8. Write tests.
9. Verify: build 0 errors, 141+ tests pass, audit pass.

## Review questions for operator

1. Should the default `maxParallelism` be 1 (sequential, backward compatible) or higher?
2. Branch failure policy: fail-fast (mission fails) vs preserve-all (mission completes with mixed results)? Suggested default: fail-fast with independent branch results preserved in evidence.
3. Should `dependsOn` across branches be fully supported (B depends on A where A and B are in different branches)? Yes — dependency resolution is branch-agnostic.
