# Behavior OS — Phase 1 Implementation Roadmap

**Authorization**: APPROVED — proceeding with independent sprint deliveries
**Order**: 1A → 1B → 2 (idempotency → parallel branches → policy versioning)
**Constraint**: No simultaneous implementation; each sprint validated independently

## Sprint 1A — Idempotency Enforcement

### Objective

Implement reliable idempotency for explicitly marked tasks with deterministic guarantees.

### Key Requirements

1. **Typed idempotency contract** — `idempotent?: boolean` on TaskDefinition; `idempotencyKey?: string`
2. **Deterministic key generation** — when key not provided, derive from task signature
3. **Persistence of execution state** — store startedAt, evidence, side-effect markers before result
4. **Duplicate dispatch prevention** — same key → skip or return cached result
5. **Crash window handling** — if side effect occurred but result not persisted → require reconciliation
6. **Fail-closed recovery** — when uncertain, require human approval or mark for manual review
7. **Backward compatibility** — existing tasks without idempotency metadata continue working (no regression)

### What Idempotency Does NOT Guarantee

- Exactly-once execution (distributed systems impossibility)
- No side effects on external systems without explicit support
- Automatic reconciliation for non-idempotent adapters

### Test Requirements (per the protocol)

- Duplicate dispatch
- Repeated retry
- Resume after interruption
- Crash after side effect but before result persistence
- Concurrent attempts with same key
- Different keys for independent operations
- Legacy tasks without idempotency metadata

### Relevant Existing Code

- `orchestrator/src/orchestrator.ts` — `executeMission`, task dispatch, `normalizeRequiredSkills`
- `orchestrator/src/control-loop.ts` — `taskSettled`, `applyMissionResult`, `retryBlocked`
- `plugins/opencode-v2/src/loop-manager.ts` — `DelegationEngine`, agent role mapping
- `orchestrator/src/adapters.ts` — `TaskAdapter`, `mutating` field

### Starting Point

Inspect current dispatch logic and determine where idempotency check fits in the pipeline.

## Sprint 1B — Parallel Task Branches

### Objective

Implement bounded parallel execution inside a mission, respecting dependencies and governance.

### Key Requirements

1. **Dependency DAG** — explicit `dependsOn?: string[]` on tasks; resolved in `computeNextControlAction`
2. **Concurrent ready tasks** — execute independent ready tasks within concurrency limits
3. **Branch failure isolation** — one branch failing does not destroy results of independent branches
4. **Concurrency limit enforcement** — max N concurrent tasks per mission (configurable, default from DNA or governance)
5. **Integration with DelegationEngine** — agent selection respects workload accounting even under parallel dispatch
6. **Cancel/timeout propagation** — coordinated cancellation across branches
7. **Persist execution state** — enough for reliable resume without repeating completed side effects
8. **Deterministic ordered results** — mission results despite concurrent execution

### Test Requirements

- Independent branches executing concurrently
- Dependent tasks waiting for prerequisites
- One branch failing while another succeeds
- Concurrency limit enforcement
- Cancellation during parallel execution
- Timeout during parallel execution
- Resume with partially completed branches
- Duplicate dispatch prevention
- Different DNA missions executing concurrently

## Sprint 2 — Policy Versioning

### Objective

Implement governed policy versioning in the existing learning engine.

### Key Requirements

1. **Lifecycle**: OBSERVATION → LESSON → CANDIDATE → VALIDATED → POLICY → MONITORED
2. **Stable policy identity** — versioned IDs persist across restarts
3. **Immutable version history** — never overwrite historical versions
4. **Provenance for every change** — who/when/why for each transition
5. **Validation results associated with exact version** — can't activate version N without its validation record
6. **Human approval before activation** — `bos_approve_loop` for policy activation
7. **Controlled activation/deactivation** — can deactivate, but not overwrite
8. **Rollback to previous validated version** — deterministic rollback with audit trail
9. **Monitoring of active policies** — behavior tracking without overwriting
10. **Audit trail** — every transition recorded in governance log
11. **Legacy compatibility** — existing policies continue working

### Test Requirements

- Candidate creation
- Validation success and failure
- Unauthorized activation
- Approval and activation
- Version comparison
- Rollback
- Monitoring failure
- Recovery after interruption
- Legacy policy compatibility

## Validation Gates (per sprint)

### Sprint 1A Gates

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint:check` passes
- [ ] Focused idempotency unit tests pass (minimum 15 new tests)
- [ ] Plugin integration tests pass
- [ ] Persistence and recovery tests pass
- [ ] `verify:governance` still 24/24
- [ ] `verify:opencode` still 39/39
- [ ] `git diff --check` clean

### Sprint 1B Gates

- [ ] All Sprint 1A gates +
- [ ] Parallel branch tests pass (minimum 12 new tests)
- [ ] Concurrency limit enforcement verified
- [ ] Cross-DNA concurrent missions verified
- [ ] Cancellation and timeout tests pass
- [ ] Resume with partially completed branches verified

### Sprint 2 Gates

- [ ] All prior gates +
- [ ] Policy versioning tests pass (minimum 15 new tests)
- [ ] Candidate creation → validation flow verified
- [ ] Approval and activation requires human step
- [ ] Rollback is reproducible and auditable
- [ ] Legacy policy compatibility confirmed
- [ ] Governance conformance unchanged (24/24)

## Execution Governance

### Agent Assignment

- **@explorer**: read-only inspection, research, independent verification
- **@fixer**: authorized implementation within approved scope

### Human Approval Required For

- Policy activation (Sprint 2)
- Any operation with external side effects
- Destructive operations
- Overwriting historical versions

### Constraints

- Maximum two agents active simultaneously
- Agents cannot approve their own governance-sensitive changes
- All changes must preserve existing governance boundaries
- Audit trail must be reproducible

## Correction/Audit Cycles

- Maximum 3 correction/audit cycles per sprint
- Escalate unresolved failures rather than looping indefinitely
- Do not claim exactly-once execution where only at-least-once with deduplication is guaranteed
- Update CLAIMS.md, ARCHITECTURE.md and ADRs only with verified implementation evidence

## Deliverable Milestones

### After Sprint 1A

1. Idempotency enforcement code merged
2. Minimum 15 idempotency tests passing
3. `verify:all` exits 0
4. Independent audit of idempotency implementation

### After Sprint 1B

1. Parallel branch implementation merged
2. Minimum 12 parallel branch tests passing
3. Concurrent mission scenarios verified
4. Independent audit of parallel execution

### After Sprint 2

1. Policy versioning implementation merged
2. Minimum 15 policy versioning tests passing
3. Full governance conformance verified (24/24)
4. Independent audit complete
5. All acceptance criteria met (11 of 11)

## Next Action

Begin Sprint 1A — Idempotency Enforcement.

First task: inspect current dispatch pipeline and identify insertion point for idempotency check.

**Ready to begin when authorization is confirmed.**
