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
**synchronously** and may be *blocking*: a blocking `failed` halts the run and
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

> Audits are **simulated by default** and always pass. Real checks run only when
> explicitly requested (`simulate: false`) and shell out to `pnpm lint:check`,
> `pnpm typecheck`, `pnpm audit --audit-level=high`, and the coverage report.

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

`BehaviorOS.proposeEvolution()` is a pure read. `applyEvolution()` writes a
proposal into the active DNA only when **all** of these hold:
`config.evolution.enabled`, the call passes `apply: true`, and — when votes are
supplied — the decision engine approves it. The only mutation possible is adding
a `warn` rule, so evolution can never block an action. It does **not** edit
source files; there is no code auto-fix.

### 10. Mission Layer
Mission lifecycle management:
- Create → Start → Execute → Complete/Fail

## Core Engines (10 Total)

These are the only engines that exist in `packages/core/src/engine/`. Earlier
revisions of this document listed 22 "engines" with synthetic `Ops/sec` figures;
only the ten below are real, and no throughput numbers are claimed.

| Engine | File | Purpose |
|--------|------|---------|
| GovernanceEngine | `governance-engine.ts` | Rule evaluation with TTL cache |
| QualityEngine | `quality-engine.ts` | Quality gate enforcement (gte/lte/eq/neq) |
| AuditEngine | `audit-engine.ts` | Multi-stage audit (simulated or real) |
| LearningEngine | `learning-engine.ts` | Pattern detection + confidence-scored DNA evolution proposals |
| MissionEngine | `mission-engine.ts` | In-memory mission lifecycle |
| PipelineEngine | `pipeline-engine.ts` | Ordered gates with synchronous pre-execution blocking |
| DecisionEngine | `decision-engine.ts` | Weighted voting/quorum (majority/supermajority/unanimous) |
| RecommendationEngine | `recommendation-engine.ts` | Scored recommendations from learning events |
| DriftEngine | `drift-engine.ts` | Behavioral drift between DNA snapshots |
| DNALoader | `dna-loader.ts` | YAML pattern loading with Zod validation |
| DNALoader | `dna-loader.ts` | YAML pattern loading with Zod validation |

## Persistence (pluggable)

Every store implements the synchronous `Store` interface
(`packages/core/src/persistence/store.ts`), so `BehaviorOS` never depends on a
concrete database. Inject one with
`new BehaviorOS({ persistence: { store } })`; `persistence.path` opens the
built-in SQLite store instead.

**SQLite (default, zero dependency).** Uses the built-in `node:sqlite` module
(Node ≥ 22.5). Seven tables keep state across restarts:

| Table | Contents |
|---|---|
| `missions` | one row per mission (+ indexed status/type/priority) |
| `learnings` | one row per learning event |
| `agents` | one row per registered agent |
| `audit_log` | one row per audit report (append-only by convention) |
| `pipeline_runs` | one row per gate-pipeline run / blocked pre-flight |
| `decisions` | one row per voting/quorum outcome |
| `meta` | key/value metadata |

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
and the mirror is updated *only* after the COMMIT succeeds, so a concurrent
reader sees either all writes or none. `BehaviorOS.persistAll()` already calls
`withTransaction` automatically.

## Integration Points

### MCP Server (standalone)
- 23 tools + 2 resources exposed via Model Context Protocol
- Deliberately **not** registered in the OpenCode v2 config (`.mcp.json` is ignored by v2)
- Targeted at external MCP clients: Claude Code, Cursor, Windsurf, VS Code Copilot

### OpenCode v2 Plugin (single native channel)
- 14 `bos_*` tools registered via `ctx.tool.transform()` + `tools.add()` as **direct** tools (`options.codemode: false`)
- Governance hook on `execute.before` (write/edit/bash interception)
- Session context hook surfacing protocol state to the model
- Automatic 7-step protocol progression (`advanceProtocolStep`) tracked in core `AgentState`
- DNA patterns loaded from `dnas/` and merged with built-ins

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

> Note: the governance log is in-memory plus a bounded JSON tail in host
> storage, and is now **tamper-evident** via a SHA-256 hash chain
> (`bos_verify_audit_trail`). Mission/learning/agent/audit-report state is
> persisted to SQLite when a `persistence.path` is configured. See
> `docs/CLAIMS.md` for the verified status.

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

No benchmarks are checked into the repository. The numbers below are **design
targets**, not measurements; verify locally with `pnpm benchmark`.

- Schema validation: < 1ms per operation (target)
- Governance evaluation: < 10ms for 100 rules (target)
- Audit pipeline: < 100ms for full stack (target)
- Learning pattern detection: < 50ms for 1000 events (target)

## Testing Strategy

- Unit tests: Each engine isolated
- Integration tests: Full pipeline validation
- E2E tests: MCP server interaction
- Coverage target: > 80%
