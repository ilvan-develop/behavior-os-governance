# Behavior-OS Architecture

## System Overview

Behavior-OS is a behavioral governance framework for autonomous AI agent teams. It provides deterministic behavior through DNA-driven patterns, multi-layer governance, and comprehensive audit trails.

## Architecture Layers

### 1. DNA Layer (YAML Configuration)

The foundation layer where behavioral patterns are defined as YAML files.

```yaml
name: surgical-team
version: "2.0.0"
description: "Zero-defect governance pattern"

personas:
  - role: architect
    name: Lead Surgeon
    authority: architect
    boundaries: [...]
    skills: [...]

governance:
  - id: sterile-field
    level: critical
    action: block
    conditions: [...]

quality:
  - id: zero-defect
    type: test_coverage
    threshold: 100
```

### 2. Schema Layer (Zod v4.4.3)

Type-safe validation for all domain objects.

- `DNASchema` - DNA pattern validation
- `MissionSchema` - Mission lifecycle
- `AgentSchema` - Agent definitions
- `GovernanceDecisionSchema` - Governance verdicts
- `AuditReportSchema` - Audit trail
- `LearningEventSchema` - Learning records

### 3. Behavioral Layer

Loads and validates DNA patterns, composes multi-package behaviors.

### 4. Governance Layer

Evaluates actions against governance rules.
- Actions: `block`, `escalate`, `warn`, `log`
- Levels: `critical`, `high`, `medium`, `low`

### 5. Gate Pipeline Layer

A real, ordered gate pipeline (`PipelineEngine`, `pipeline-engine.ts`). Gates run
**synchronously** and may be _blocking_: a blocking `failed` halts the run and
vetoes the action before it executes. `BehaviorOS.preflightAction()` runs the
`pre` gates synchronously (a core-level, host-agnostic equivalent of the OpenCode
plugin's permission hook); `runPipeline()` runs `pre` + `post`.

Default gates: `governance` (pre, blocking) plus one `quality:<id>` gate per DNA
quality gate (post, blocking). Callers replace them with `pipeline.gates`, and
`pipeline.enabled: false` disables the pipeline. There are **not** nine validation
layers — the default pipeline is 1 pre + N post gates (N = DNA quality gates).

### 6. Decision Layer

Voting/quorum engine (`DecisionEngine`, `decision-engine.ts`). A subject is
resolved by weighted votes under a policy (`majority`, `supermajority`,
`unanimous`) with a quorum threshold; ties and all-abstain resolve to `rejected`
(fail-safe). `BehaviorOS.decide()` applies configured defaults and persists the
outcome. This is deterministic in-process voting — **not** a distributed
consensus protocol (no Raft/Paxos).

### 7. Audit Layer

Multi-stage audit pipeline. `AuditStageSchema` defines **6** stages
(`lint`, `typecheck`, `security`, `coverage`, `performance`, `governance`); the
default run uses the first four.

> Audits are **simulated by default** and never report a pass: `BehaviorOS.runAudit`
> forces `simulated: true` and `overall: 'warning'` with a `SIMULATED — no
> verification executed` summary. Real checks run only when explicitly requested
> (`simulate: false`) and shell out to `pnpm lint:check`, `pnpm typecheck`,
> `pnpm audit --audit-level=high`, and the coverage report. The real `lint` stage
> resolves the project linter from its config file (`biome.json`/`biome.jsonc`,
> `eslint.config.*`/`.eslintrc*`, `.oxlintrc.json`) by walking up to the workspace
> root, so a Biome repository reports `{linter: 'biome'}` instead of `skipped`.
> A raw `AuditEngine` used directly is not downgraded; consume reports through
> `BehaviorOS`.

### 8. Quality Layer

Quality gates enforcement:
- Test coverage ≥ 80%
- Zero lint errors
- Zero security vulnerabilities

### 9. Learning Layer

Pattern detection over recorded events:
- Record events
- Detect recurring patterns (an event type seen ≥ 2 times)
- Surface recommendations
- Score the confidence of a recurring pattern and propose DNA changes:
  `confidence = min(1, occurrences / 5) * 0.6 + avgImpactWeight * 0.4`
  (impact weights: low 0.25, medium 0.5, high 0.75, critical 1)
- Derive **code-fix proposals** from repeated `fix` events via
  `LearningEngine.proposeCodeFixes()`. This is a read-only API — no files are
  touched. MCP tool `bos_code_fixes`.
- Promote a governed **learning record** through
  `observation → lesson → candidate → validated → policy → monitored`
  (`LearningEngine.createRecord()` / `advanceRecord()`). Promotions move exactly
  one stage, never skip or regress, and entering `validated` requires evidence.
  Records carry their transition trail, are exposed through
  `bos_record_learning` (`learningId` + `stage`), and persist in the engine
  snapshot (`learningRecords`).
- Govern a learning-derived **policy version ledger**: immutable
  `policyId@N` versions, SHA-256 content hash, provenance, exact-hash
  validation, human approval, activation/deactivation/rollback, monitoring and
  an append-only audit trail. The ledger lives in the existing `meta` store key
  `policy-ledger` (ADR 0001), not in a new table.
- An active version may carry machine-readable `enforcement`
  (`block`/`escalate`/`require`/`warn` + `match` + `severity`).
  `BehaviorOS.evaluateGovernance()` consults the active set after DNA rules, so
  an activated policy changes the verdict for matching actions. Candidate and
  approved-but-inactive versions have no effect. `getStatus().policies`
  reports `{active, ids, enforced}` to every host.
- When `BEHAVIOR_OS_APPROVAL_KEY` is set, human approval requires an HMAC-SHA256
  token bound to `policyId|versionId|contentHash|rationale`
  (`scripts/policy-approval-token.mjs`); without it, the documented
  `actor.kind === 'human'` contract applies for local development and the
  approval records its verification basis.

`BehaviorOS.proposeEvolution()` is a pure read. `applyEvolution()` writes a
proposal into the active DNA only when **all** of these hold:
`config.evolution.enabled`, the call passes `apply: true`, and — when votes are
supplied — the decision engine approves it. The only mutation possible is adding
a `warn` rule, so evolution can never block an action. It does **not** edit
source files; there is no code auto-fix.

### 10. Mission Layer

Mission lifecycle management:
- Create → Start → Execute → Complete/Fail
- Evidence provenance (`executed` / `reported` / `simulated`) and an optional
  `verificationMode: 'executed'` that refuses reported evidence

## Core Engines (11 Total)

These are the only engines that exist in `packages/core/src/engine/`. Earlier
revisions of this document listed 22 "engines" with synthetic `Ops/sec` figures;
only the eleven below are real, and no throughput numbers are claimed.

| Engine               | File                       | Purpose                                                                                           |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| GovernanceEngine     | `governance-engine.ts`     | Rule evaluation with TTL cache                                                                    |
| QualityEngine        | `quality-engine.ts`        | Quality gate enforcement (gte/lte/eq/neq)                                                         |
| AuditEngine          | `audit-engine.ts`          | Multi-stage audit (simulated or real)                                                             |
| LearningEngine       | `learning-engine.ts`       | Pattern detection + confidence-scored DNA evolution proposals + evidence-gated learning lifecycle |
| MissionEngine        | `mission-engine.ts`        | In-memory mission lifecycle                                                                       |
| PipelineEngine       | `pipeline-engine.ts`       | Ordered gates with synchronous pre-execution blocking                                             |
| DecisionEngine       | `decision-engine.ts`       | Weighted voting/quorum (majority/supermajority/unanimous)                                         |
| RecommendationEngine | `recommendation-engine.ts` | Scored recommendations from learning events                                                       |
| DriftEngine          | `drift-engine.ts`          | Behavioral drift between DNA snapshots                                                            |
| CodeEditEngine       | `code-edit-engine.ts`      | Guarded single-file text edits (dry-run, confinement, hashes)                                     |
| DNALoader            | `dna-loader.ts`            | YAML pattern loading with Zod validation                                                          |

## Persistence (pluggable)

Every store implements the synchronous `Store` interface
(`packages/core/src/persistence/store.ts`), so `BehaviorOS` never depends on a
concrete database. Inject one with
`new BehaviorOS({ persistence: { store } })`; `persistence.path` opens the
built-in SQLite store instead.

**SQLite (default, zero dependency).** Uses the built-in `node:sqlite` module
(Node ≥ 22.5). Nine tables keep state across restarts:

| Table              | Contents                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| `missions`         | one row per mission (+ indexed status/type/priority)                       |
| `learnings`        | one row per learning event                                                 |
| `agents`           | one row per registered agent                                               |
| `audit_log`        | one row per audit report (append-only by convention)                       |
| `pipeline_runs`    | one row per gate-pipeline run / blocked pre-flight                         |
| `decisions`        | one row per voting/quorum outcome                                          |
| `code_fix_results` | one row per applied code-fix result (deduped by `pattern`)                 |
| `code_edits`       | one row per governed code-edit evaluation (dry-runs and refusals included) |
| `meta`             | key/value metadata                                                         |

Enable it with `new BehaviorOS({ persistence: { path: './behavioros.db' } })`, or
set `BEHAVIOROS_DB_PATH` when running the MCP server. Without a path the engine
runs fully in memory; an unusable path degrades to memory instead of throwing.
See `packages/core/src/persistence/sqlite-store.ts`.

**Postgres (optional).** `PostgresStore` stores every document in one table with
a `kind` discriminator. `pg` is **not** a dependency of this package — it is
resolved at `connect()` time via `createRequire`, so an SQLite-only project never
installs a driver. Because `Store` is synchronous and Postgres is not, the
adapter keeps an in-memory mirror: reads come from the mirror loaded at
`connect()` and writes are written through asynchronously. `await flush()`
drains the queue (and rethrows the first write error); `await closeAsync()`
flushes and ends the pool.

Strong consistency for writers is provided by `Store.withTransaction(fn)`: the
callback runs inside `BEGIN` / `COMMIT` / `ROLLBACK` on a dedicated connection,
and the mirror is updated _only_ after the COMMIT succeeds, so a concurrent
reader sees either all writes or none. `BehaviorOS.persistAll()` already calls
`withTransaction` automatically.

## Mission state machine (S1)

Mission status is not free-form. `MissionEngine.transition()` is the only
mutating entry point (`packages/core/src/engine/mission-engine.ts`); the legacy
`start`/`complete`/`fail` helpers delegate to it.

```text
pending ──▶ active ──▶ completed   (terminal)
   │           │  ▲
   │           │  └── paused
   │           ├──▶ failed         (terminal)
   │           └──▶ cancelled      (terminal)
   ├──▶ failed
   └──▶ cancelled
```

- Legal edges are declared once in `ALLOWED_TRANSITIONS`. Terminal states have
  no outgoing edges: reopening is a new mission, not a resurrection.
- A repeated transition to the current state is an idempotent no-op
  (`changed: false`): no version bump, no duplicated evidence, no duplicate
  history entry.
- `expectedVersion` rejects stale concurrent writes with `VERSION_CONFLICT`.
  Every state change and every progress update increments `version`.
- Completion requires each `requiredChecks` gate to have a latest evidence entry
  with `status: 'passed'` and `simulated !== true`. Missing, failed and
  simulated evidence produce `EVIDENCE_MISSING`, `EVIDENCE_FAILED` and
  `EVIDENCE_SIMULATED` respectively, and the mission stays in its previous
  state.
- A mission created with `requiredChecks: []` completes with the explicit basis
  `no-required-checks`. That is recorded on the mission and must never be read
  as a verification.
- `BehaviorOS.transitionMission()` persists the new state with a single
  idempotent upsert. If a synchronous store throws, the in-memory mission is
  restored (including keys added by the failed transition) and the call returns
  `PERSISTENCE_FAILED`. `PostgresStore` is write-through and asynchronous: it
  reports write errors at `flush()`, so the rollback guarantee applies to
  synchronous stores such as SQLite or an injected store. No multi-write
  transaction is claimed.
- Evidence carries `provenance` (`executed` / `reported` / `simulated`) and,
  for executed evidence, an `executionId`. Evidence without a provenance is
  normalized to `reported`; `executed` without an `executionId` is rejected as
  `EVIDENCE_UNVERIFIED`. A mission created with `verificationMode: 'executed'`
  refuses any required gate whose latest evidence is not executed. Evidence
  remains caller-supplied and is not cryptographically attested by the host.
- The OpenCode plugin persists the whole engine snapshot. Every lifecycle
  transition (mission create/start/complete/fail/cancel and learning promotion)
  runs under a per-instance lifecycle lock that covers capture → mutate →
  persist → rollback, so a failed write restores only its own transition and can
  never erase a concurrent one. Storage writes additionally remain serialized
  and cross-instance writes are merged by revision. The residual equal-revision
  race across _separate_ plugin instances requires a backend with compare-and-swap;
  the core kernel and the SQLite path do not share that limitation.

### Exposure

- MCP and OpenCode expose `bos_complete_mission`, `bos_fail_mission` and
  `bos_cancel_mission` with equivalent input contracts.
- `pauseMission` / `resumeMission` are `BehaviorOS` methods; they are not tools
  in S1.
- Simulated audits are forced to `overall: 'warning'` with `simulated: true` and
  a `SIMULATED — no verification executed` summary. They can never be completion
  evidence. The downgrade lives at the `BehaviorOS.runAudit` boundary: a raw
  `AuditEngine` instantiated directly still labels simulated stages `passed`, so
  hosts must consume audit reports through `BehaviorOS` or check `simulated`.

## Task orchestration (S3)

`AutonomousOrchestrator` (`packages/orchestrator/src/orchestrator.ts`) executes a
mission plan through real adapters. `ControlLoop`
(`packages/orchestrator/src/control-loop.ts`) adds durable, evidence-driven
continuation on top of it. Both are libraries, not new tool surfaces: MCP still
exposes 87 tools and the plugin 72.

- `ShellAdapter` spawns a real child process, captures `stdout`/`stderr` and the
  exit code, truncates output, and honours cancellation (SIGTERM, then SIGKILL).
- Adapter output is validated against `AdapterResultSchema` before it can affect
  task or mission state.
- Each task declares acceptance checks and optional `dependsOn` task ids;
  bounded retries, per-task timeouts, loop detection and a per-adapter circuit
  breaker stop runaway plans. A blocked task pauses the mission but independent
  branches continue; dependants are recorded as `DEPENDENCY_BLOCKED`.
- A governance `deny` blocks the run; `escalate` pauses it for human approval.
- In-process idempotency keys replay a completed task instead of executing it
  twice; resuming a mission skips gates already backed by executed evidence.
  Evidence is bound to the task that produced it (`taskId`, with an execution-id
  prefix fallback for older records), so two tasks that happen to share a gate
  name cannot satisfy each other.
- `ControlLoop` persists run state atomically after every task transition:
  mission/run ids, phase, task graph, attempts, failure codes, evidence refs,
  approval state, validation and audit results, next eligible action and
  termination reason. A resumed loop seeds prior executed evidence and skips
  completed tasks instead of dispatching them again. The mission id is persisted
  by a `missionCreated` observer before governance or dispatch, and a mission
  tag carrying the run id lets a later process adopt a mission created just
  before a crash instead of creating a second one.
- The state file is validated on load (task/evidence/error shapes and enums).
  The `done` terminal claim is re-derived on resume; a `failed` state remains
  terminal and is not resurrected.
  Persisted task bodies are also checked against the
  plan (id, phase, adapter, agent, input, acceptance, dependencies) before
  dispatch, so a tampered phase label cannot bypass the plan signature.
  `authorizedPhases` is re-applied on every resume: a caller-supplied list is
  authoritative, an omitted list falls back to the persisted list, and an empty
  list denies every task. A state created without a restriction therefore cannot
  bypass a narrower caller list, and a listed phase requires every task to
  declare that phase.
- A pending approval is scoped as `mission` or `task`; `recordApproval` records a
  human decision and `retryBlocked` reopens a blocked task after an adapter/agent
  fix. Neither bypasses phase or agent authorization. A mission-scoped approval
  is still evaluated against the same DNA on resume: if the escalate rule still
  matches, the mission remains paused; the loop never bypasses governance.
- `ControlLoop` classifies results as `PASS`, `PASS_WITH_LIMITATIONS`, `FAIL`,
  `BLOCKED` or `UNVERIFIED`. Missing, `reported`, `simulated` or non-executed
  evidence can never be a `PASS`; a final independent auditor is mandatory before
  a terminal `done`. A persisted audit narrative is never trusted on resume: the
  loop re-runs the independent auditor (or blocks as unverified when none is
  available) and replaces stale audit-derived limitations.
- Acceptance gates must be unique across tasks; a plan where two tasks claim the
  same gate is rejected, so task evidence can never be attributed to the wrong
  task.
- Tasks may declare a `phase`; `authorizedPhases` prevents an unauthorized phase
  from starting. Boundary: the loop's mission may complete its authorized branch
  while the control state remains blocked on an unauthorized or blocked task.
- Resume is at-least-once for a task interrupted while `running`: completed tasks
  are skipped from executed evidence, but a side-effecting adapter must honour
  its idempotency key if the process died after the side effect and before
  evidence was recorded.
- Events are per mission and exclude secrets; persistence failures are reported,
  not swallowed.
- When `OrchestratorOptions.delegation` is supplied, `DelegationEngine` assigns
  every task before governance/dispatch. Tasks carry `requiredSkills` and
  `mutating` (default `true`, safety-first); a `readonly` agent or
  `explorer`/`auditor` role can never receive a mutating task, and a task with no
  eligible agent is blocked rather than dispatched to the pinned agent.
  `requiredSkills: []` means "no skill constraint" and never falls back to the
  pinned agent's capabilities. Effective mutability is fail-closed: only
  `task.mutating === false` **and** `adapter.mutating === false` is read-only;
  a missing or mutating adapter is always re-checked by the task-scoped
  governance preflight. The shared concurrency budget is enforced by an
  in-process reservation ledger inside the engine (distinct agents,
  `missionId:taskId` keys); the `LoopManager` exposes one engine per manager so
  concurrent loops from the same runtime share the budget. `assignedAgentId`
  is written only by a real dispatch (`attempts > 0`) and cleared by
  `retryBlocked`. Limitation: dispatch inside one mission is sequential; the
  budget is not cross-process; there is no per-file/scope lock.
- 141 tests in `packages/orchestrator/tests/` cover real execution, failure
  injection, dependency/agent blocking, durable resume, phase re-authorization,
  task-bound evidence, approval boundaries, limitations, persisted-audit,
  shared-budget reservations, `mutating:false` bypass, empty `requiredSkills`,
  and `assignedAgentId` resume integrity.
  revalidation, terminal-state guards and real delegation through both
  `AutonomousOrchestrator` and `ControlLoop`. `control-loop.integration.test.ts`
  exercises the public `ControlLoop` → `AutonomousOrchestrator.executeMission`
  path with an in-memory engine and temporary state only.

Boundary: the control-loop state file can contain task inputs and must be
protected like any other execution artifact; `seedEvidence` is trusted caller
input and must only come from such a protected prior run. The orchestrator is
wired into the plugin via `LoopManager`; the plugin does not supply an independent
auditor so the loop never reports overall `PASS` — it stops as `UNVERIFIED`.

## Integration Points

### MCP Server (standalone)

- 87 tools + 2 resources exposed via Model Context Protocol
- Deliberately **not** registered in the OpenCode v2 config (`.mcp.json` is ignored by v2)
- Targeted at external MCP clients: Claude Code, Cursor, Windsurf, VS Code Copilot

### OpenCode v2 Plugin (single native channel)

- 37 `bos_*` tools registered via `ctx.tool.transform()` + `tools.add()` as **direct** tools (`options.codemode: false`)
- Governance hook on `execute.before` (write/edit/bash interception)
- Session context hook surfacing protocol state to the model
- Automatic 7-step protocol progression (`advanceProtocolStep`) tracked in core `AgentState`
- DNA patterns loaded from `dnas/` and merged with built-ins

#### Notification coalescing (producer side)

The plugin posts synthetic session messages for DNA selection, mission creation,
denials and escalations with `delivery: 'queue'`. To keep a long turn chain from
accumulating one message per decision, `notifications.ts` coalesces them before
they reach the host:

- **Identity**: `(sessionID, kind, action, normalized reason)`. Only whitespace
  is normalized; case, punctuation and wording are preserved so two different
  decisions never share a key.
- **Window**: 60 s per session, starting at the first admitted notice.
- **Cap**: at most 3 notices per session per window.
- **Reset**: only the `session.prompt` hook resets a window. OpenCode does not
  run that hook for synthetic messages, so a notice cannot re-enable itself.
  The hook runs before admission, so a prompt that fails preparation reopens
  the window early; that errs toward more notices, never fewer.
- **Persistence**: the window and keys are snapshotted into `ctx.storage`
  (`behavioros:notifications:v1`). `take()` is synchronous, so the duplicate
  check and the record cannot interleave; snapshot writes are serialized.
- **Observability**: each suppression appends one `advisory` governance-log
  entry with the reason and aggregate counters; it never emits another
  synthetic message.

The coalescer is producer-side only. It does **not** acknowledge, expire,
delete or replay host inbox records, and it does not guarantee timely
delivery. Those remain consumer responsibilities in OpenCode.

### CLI

- Project initialization
- DNA compilation
- Validation
- Status checking
- Protocol compliance

## Data Flow

```
User Request
    ↓
OpenCode Plugin / MCP Server / CLI / SDK
    ↓
PipelineEngine.preflight() — pre gates may veto before execution
    ↓
GovernanceEngine (evaluate rules)
    ↓
QualityEngine (check gates)
    ↓
MissionEngine (track progress)
    ↓
AuditEngine (record actions)
    ↓
LearningEngine (detect patterns)
    ↓
Response to Agent
```

## Security Model

1. **DNA-defined boundaries** - Agents can only operate within defined personas
2. **Rule-based governance** - Actions evaluated against explicit rules
3. **Synchronous gate pipeline** - `preflightAction()` runs blocking `pre` gates that veto an action before it executes
4. **Audit trail** - Every governance event logged with timestamp and context
5. **Quality gates** - Evaluate reported metrics against thresholds
6. **Learning from failures** - Tool failures recorded; recurring patterns detected and surfaced
7. **Governed code editing** - Opt-in (`codeEdit.enabled`) + explicit `apply: true`; dry-run by default, workspace-confined, atomic, hashed, and recorded even when refused

> Note: the governance log is in-memory plus a bounded JSON tail in host
> storage, is **tamper-evident** via a SHA-256 hash chain
> (`bos_verify_audit_trail`), and can additionally be written to a durable
> append-only JSONL file (`BEHAVIOR_OS_AUDIT_LOG`) that detects truncation,
> sequence gaps and edits. That is detection, not WORM storage.
> Mission/learning/agent/audit-report state is persisted to SQLite when a
> `persistence.path` is configured. See `docs/CLAIMS.md` for the verified status.

## 7 Real Algorithms

The system ships with **seven** real, measurable algorithms (not synthetic
`Ops/sec` figures). Each is documented in its engine source file:

1. **Confidence scoring** — `LearningEngine.confidenceFor()`: `min(1, n/5)*0.6 + avgImpact*0.4`
2. **Recency decay** — `RecommendationEngine.recencyWeight()`: `max(0, 1 - h/72)`
3. **Recommendation score** — `0.4*recency + 0.3*frequency + 0.3*impact`
4. **Quorum resolution** — `DecisionEngine.resolve()`: majority / supermajority (≥ 2/3) / unanimous
5. **SHA-256 hash chain** — `verifyGovernanceLog()` recomputes the tamper-evident trail
6. **Drift detection** — `DriftEngine.compare()`: symmetric difference of rules + gates
7. **Resource normalization** — `buildGovernanceContext()`: maps resources into condition signals

## Extensibility

### Adding New DNA Patterns

1. Create a YAML file in `dnas/`
2. It is auto-discovered by the CLI, MCP server and plugin (no central registry file)
3. Add a test in the relevant package's `tests/` directory

### Adding MCP Tools

1. Add a `server.registerTool(...)` call in `packages/mcp-server/src/server.ts`
2. Add a Zod input schema in the same call

### Adding OpenCode Plugin Tools

1. Use `ctx.tool.transform()` in plugin setup (`plugins/opencode-v2/src/index.ts`)
2. Register with JSON Schema
3. Implement the execute handler

## Performance Characteristics

No benchmarks are checked into the repository: they are **design targets**, not
measurements. There is no benchmark script — measure whatever you need with your
own harness (vitest or a plain `node` script importing the built package).

- Schema validation: < 1ms per operation (target)
- Governance evaluation: < 10ms for 100 rules (target)
- Audit pipeline: < 100ms for full stack (target)
- Learning pattern detection: < 50ms for 1000 events (target)

## Testing Strategy

- Unit tests: Each engine isolated
- Integration tests: Full pipeline validation
- E2E tests: MCP server interaction
- Coverage target: > 80%
## Known Architectural Boundaries

These are measured gaps, not bugs. They are declared so nothing is mistaken
for marketing or a hidden defect.

- **Simulated audit via direct AuditEngine**: `runSimulated()` now forces
  `overall: 'warning'` and `simulated: true`, but a host that introspects the
  engine's internal `simulate` field could bypass the guard. Always consume
  reports through `BehaviorOS.runAudit()`.
- **Cross-instance equal-revision race**: two OpenCode sessions writing the same
  revision may lose data even after triple-retry. A backend with compare-and-swap
  would eliminate this; the current get/set storage cannot.
- **Notification coalescing producer-side only**: the coalescer bounds the
  producer but never ACKs, expires, or DLQs host inbox records. `totalSent`
  (v2) enables cross-restart loss detection, but lost notices remain unrecoverable.
- **ControlLoop ran without an independent auditor**: `bos_start_loop` now
  dispatches real tasks through `AutonomousOrchestrator` (default `ShellAdapter`)
  and persists durable state under `.behavioros/loops/`, but the plugin wires no
  independent auditor. The loop therefore never reports an overall `PASS`; runs
  stop as `UNVERIFIED` even when every task passes. Hosts that need a terminal
  `done` must resume the run with their own auditor.
- **Loop approval gate is now surfaced as a tool**: `bos_approve_loop` records
  `approved` or `denied` on a loop blocked by `APPROVAL_REQUIRED` and resumes
  dispatch. A subsequent gate may block again.
