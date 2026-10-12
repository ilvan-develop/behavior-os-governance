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
│  Record → Detect Patterns → Auto-Fix                        │
│  Continuous improvement engine                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   QUALITY LAYER                              │
│  Gates: coverage ≥80% | lint = 0 | typecheck = 0            │
│  Automated quality enforcement                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT LAYER                               │
│  Stages: lint → typecheck → security → coverage              │
│  Immutable audit reports with chain of custody              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   DECISION LAYER                             │
│  Voting-based decisions | configurable quorum                │
│  Multi-agent consensus engine                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  GOVERNANCE LAYER                            │
│  Rules: block | escalate | warn | log                       │
│  Real-time policy enforcement                               │
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
Generates immutable audit reports:
- Records all governance decisions
- Tracks quality gate evaluations
- Maintains chain of custody
- Supports forensic analysis

### Learning Engine
Improves system over time:
- Records insights from completions
- Detects recurring patterns
- Suggests auto-fixes
- Tracks impact metrics

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
- 11 registered tools
- Resource templates
- Prompt management
- JSON-RPC protocol support

### OpenCode v2 Plugin (single native channel)
- 12 `bos_*` tools registered via `ctx.tool.transform()` + `tools.add()` as **direct** tools (`options.codemode: false`)
- `execute.before` governance hook intercepting write/edit/bash actions
- Session context hook injecting protocol state
- DNA patterns loaded from `dnas/` and merged with built-ins
- Native TypeScript integration via `.opencode/plugins/` auto-discovery

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
[Pattern Found] → Suggest Fix
    ↓
State Update → Dashboard
```

## State Management

Agent state is persisted in `.agent_state.json`:
- Current protocol step
- Selected DNA pattern
- Active mission
- Step history
- Timestamps

## Configuration

| Config | Default | Description |
|--------|---------|-------------|
| enforce | PERMISSIVE | Governance mode |
| logLevel | info | Logging verbosity |
| dataDir | ~/.behavioros | Storage location |
| port | 3000 | Dashboard port |

## Extensibility

### Adding New DNA Patterns
1. Create YAML in `dnas/`
2. Register in `packages/dnas/src/index.ts`
3. Add validation in `packages/schemas/src/dna.ts`
4. Write tests in `packages/core/tests/dna/`

### Adding New MCP Tools
1. Define tool in `packages/mcp-server/src/tools/`
2. Register in server.ts
3. Add schema in `packages/schemas/src/mcp.ts`
4. Write integration tests

### Adding New Engines
1. Implement engine class
2. Export from `packages/core/src/engine/index.ts`
3. Add to BehaviorOS constructor
4. Write unit tests
