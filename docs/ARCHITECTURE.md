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

### 6. Decision Layer — not implemented
There is **no** voting/quorum engine in this codebase. All decisions are made by
`GovernanceEngine` rule evaluation (section 4). This slot is documented only to
make its absence explicit; it is not shipped behavior.

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

> Fixes are **not** applied automatically; a human/agent must act on a
> recommendation. There is no confidence-threshold auto-apply.

### 10. Mission Layer
Mission lifecycle management:
- Create → Start → Execute → Complete/Fail

## Core Engines (7 Total)

These are the only engines that exist in `packages/core/src/engine/`. Earlier
revisions of this document listed 22 "engines" with synthetic `Ops/sec` figures;
only the seven below are real, and no throughput numbers are claimed.

| Engine | File | Purpose |
|--------|------|---------|
| GovernanceEngine | `governance-engine.ts` | Rule evaluation with TTL cache |
| QualityEngine | `quality-engine.ts` | Quality gate enforcement (gte/lte/eq/neq) |
| AuditEngine | `audit-engine.ts` | Multi-stage audit (simulated or real) |
| LearningEngine | `learning-engine.ts` | Pattern detection from learning events |
| MissionEngine | `mission-engine.ts` | In-memory mission lifecycle |
| PipelineEngine | `pipeline-engine.ts` | Ordered gates with synchronous pre-execution blocking |
| DNALoader | `dna-loader.ts` | YAML pattern loading with Zod validation |

## Persistence (SQLite)

Opt-in SQLite persistence in the core package, using the built-in `node:sqlite`
module (Node ≥ 22.5) so **no external dependency** is needed. Six tables keep
state across restarts:

| Table | Contents |
|---|---|
| `missions` | one row per mission (+ indexed status/type/priority) |
| `learnings` | one row per learning event |
| `agents` | one row per registered agent |
| `audit_log` | one row per audit report (append-only by convention) |
| `pipeline_runs` | one row per gate-pipeline run / blocked pre-flight |
| `meta` | key/value metadata |

Enable it with `new BehaviorOS({ persistence: { path: './behavioros.db' } })`, or
set `BEHAVIOROS_DB_PATH` when running the MCP server. Without a path the engine
runs fully in memory; an unusable path degrades to memory instead of throwing.
See `packages/core/src/persistence/sqlite-store.ts`.

## Integration Points

### MCP Server (standalone)
- 13 tools + 2 resources exposed via Model Context Protocol
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
