# Behavior-OS Architecture Deep Dive

## System Overview

Behavior-OS is a behavioral governance platform that provides:
- **DNA-driven patterns** for consistent AI agent behavior
- **Multi-layer governance** with block/escalate/warn/log enforcement
- **Quality gates** ensuring code and process standards
- **Audit trails** for compliance and debugging
- **Learning systems** that improve over time
- **MCP integration** for seamless tool interaction

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MISSION LAYER                             │
│  Create → Start → Execute → Complete/Fail                    │
│  Lifecycle management with full audit trail                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   LEARNING LAYER                             │
│  Record → Detect Patterns → Insights/Recommendations         │
│  Fix & evolution proposals (applied only with opt-in+apply)   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   QUALITY LAYER                              │
│  Gates evaluated against caller-supplied metrics             │
│  (coverage · lint · typecheck · security, per DNA)           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT LAYER                               │
│  Stages: lint → typecheck → security → coverage              │
│  Audit reports + SHA-256 hash-chained governance log         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   DECISION LAYER                             │
│  Weighted voting + quorum (in-process)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  GOVERNANCE LAYER                            │
│  Rules: block | escalate | warn | log | transform            │
│  Verdicts: allow | deny | escalate | transform               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 BEHAVIORAL LAYER                             │
│  Load DNA | Validate | Compose multi-package patterns        │
│  DNA composition engine                                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   SCHEMA LAYER                               │
│  Zod v4.4.3 schemas for every type                          │
│  Runtime type validation                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    DNA LAYER                                 │
│  Personas | Governance Rules | Quality Gates                 │
│  YAML-based pattern definitions                              │
└─────────────────────────────────────────────────────────────┘
```

## Engine Details

### Governance Engine

Evaluates agent actions against DNA rules:
1. Loads matching DNA pattern
2. Evaluates each governance rule against action context
3. Determines verdict based on highest severity rule
4. Returns decision with reasoning

**Verdict Types:**
- `allow`: Action permitted
- `deny`: Action blocked
- `escalate`: Requires human review
- `transform`: Action modified before execution

### Quality Engine

Enforces quality gates:
- `test_coverage`: Minimum test coverage percentage
- `lint`: Maximum allowed lint errors
- `typecheck`: Maximum type errors
- `security`: Maximum security vulnerabilities
- Custom operators: `gte`, `lte`, `eq`

### Audit Engine

Generates audit reports with a per-stage result:
- Records governance decisions and quality-gate evaluations
- Persisted reports are listed with `bos_list_audit_reports` (requires persistence)
- The governance log is a SHA-256 hash chain: tamper **detection**, not WORM
  storage (see [`CLAIMS.md`](CLAIMS.md#cadeia-de-auditoria-tamper-evidence))

### Learning Engine

Improves the system over time:
- Records insights, patterns, fixes, failures and optimizations
- Detects recurring patterns and scores recommendations by recency, frequency and impact
- Proposes code fixes and DNA evolution — applying either needs `enabled: true` **and**
  an explicit `apply: true` (plus approved votes when votes are supplied)

### Mission Engine

Manages mission lifecycle:
- State machine: pending → active → completed/failed
- Progress tracking
- Priority-based queuing
- Timeline management

## Schema Layer

All data is validated through Zod v4.4.3 schemas:
- **DNA**: Pattern definitions with personas, rules, gates
- **Mission**: Lifecycle state with metadata
- **GovernanceDecision**: Evaluation results
- **AuditReport**: Immutable records
- **LearningEvent**: Insights and patterns

## Integration Points

### MCP Server (standalone for external clients)

- 86 registered tools + 2 resources (`behavioros://protocol/steps`, `behavioros://dna/catalog`)
- JSON-RPC over stdio

### OpenCode v2 Plugin (single native channel)

- 32 `bos_*` tools registered via `ctx.tool.transform()` as **direct** tools (`options.codemode: false`)
- `permission:evaluate` hook is the only typed denial path (mutating actions are refused here)
- `tool:execute.before` / `tool:execute.after` hooks are advisory telemetry (they never throw)
- Session context hook injecting protocol state
- DNA patterns loaded from `dnas/` (or `BEHAVIOROS_DNA_PATH`) and merged with built-ins
- Native TypeScript integration: `.opencode/plugins/behavioros.ts` re-exports the built package

### IDE Integrations

- **Claude Code**: MCP server via `.mcp.json`
- **Cursor**: Protocol rules via `.cursor/rules/`
- **Windsurf**: Rules via `.windsurfrules`
- **VS Code Copilot**: Instructions via `.github/copilot-instructions.md`

## Data Flow

```
Agent Action
    ↓
Governance Engine (evaluate rule)
    ↓
[Allow] → Action Proceeds
[Deny] → Block with Reason
[Escalate] → Human Review
[Transform] → Modified Action
    ↓
Quality Engine (check gates)
    ↓
[Pass] → Continue
[Fail] → Alert & Report
    ↓
Audit Engine (record event)
    ↓
Learning Engine (detect patterns)
    ↓
[Pattern Found] → Insight / Recommendation (fixes are opt-in)
    ↓
Agent state update (`.behavioros/state.json` via the CLI; `ctx.storage` in the plugin)
```

## State Management

The CLI keeps its state in `.behavioros/state.json`:
- Current protocol step
- Selected DNA pattern
- Active mission
- Step history
- Timestamps

The OpenCode plugin does not use that file: it persists the same shape in the
host's storage (`ctx.storage`, key `behavioros:state`) and re-injects it into each
session.

## Configuration

`new BehaviorOS(config)` accepts the keys declared in
`packages/core/src/engine/behavior-os.ts`:

| Config        | Values                                                      | Notes                                                   |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `dnaPath`     | string                                                      | Path to the DNA YAML to load at construction            |
| `governance`  | `{ enabled?, level?: 'strict' \| 'moderate' \| 'lenient' }` | Rule evaluation                                         |
| `quality`     | `{ enabled?, minCoverage? }`                                | Quality gates                                           |
| `audit`       | `{ enabled? }`                                              | Audit pipeline                                          |
| `learning`    | `{ enabled? }`                                              | Learning events                                         |
| `persistence` | `{ path?, store?, autoHydrate? }`                           | SQLite by `path`, or any injected `Store`               |
| `pipeline`    | `{ enabled?, gates? }`                                      | Synchronous gate pipeline (default: 1 `pre` + N `post`) |
| `decision`    | `{ policy?, quorum? }`                                      | Defaults for `decide()`                                 |
| `evolution`   | `{ enabled?, minConfidence? }`                              | Applying proposals also needs `apply: true`             |
| `codeEdit`    | `{ enabled?, root?, extensions? }`                          | Writing also needs `apply: true`                        |

There is no dashboard, no `port` and no `dataDir` option.

## Extensibility

### Adding New DNA Patterns

1. Add `dnas/<name>.yaml`
2. Validate it against `DNASchema` (the `packages/core/tests/dnas.test.ts` suite fails otherwise)
3. Update the pattern lists/counts that mention 21 (README, `docs/CLAIMS.md`, …)

### Adding New MCP Tools

1. Register the tool in `packages/mcp-server/src/server.ts` (`server.registerTool`)
2. Add its Zod `inputSchema` in the same call
3. Update the tool-count assertions in `packages/mcp-server/tests/mcp.test.ts`

### Adding New Engines

1. Implement engine class in `packages/core/src/engine/`
2. Export from `packages/core/src/engine/index.ts`
3. Add it to the `BehaviorOS` facade (`behavior-os.ts`)
4. Write unit tests in `packages/core/tests/*.test.ts`
