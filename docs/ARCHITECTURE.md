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

### 5. Decision Layer
Voting-based decisions with configurable quorum and thresholds.

### 6. Audit Layer
Multi-stage audit pipeline:
1. Lint check
2. Type check
3. Security scan
4. Coverage analysis
5. Performance metrics

### 7. Quality Layer
Quality gates enforcement:
- Test coverage ≥ 80%
- Zero lint errors
- Zero security vulnerabilities

### 8. Learning Layer
Pattern detection and auto-fix application:
- Record events
- Detect patterns
- Apply fixes automatically

### 9. Mission Layer
Mission lifecycle management:
- Create → Start → Execute → Complete/Fail

## Core Engines (22 Total)

| Engine | Purpose | Ops/sec |
|--------|---------|---------|
| AutonomousDecomposer | Task decomposition | 14.6M |
| AITMPLAdapter | AI template adapter | 15.9M |
| DecisionEngine | Voting-based decisions | 14.1M |
| QualityEngine | Quality gate enforcement | 14.1M |
| LearningEngine | Pattern detection | 13.9M |
| LoggingEngine | Action logging | 12.7M |
| DistributedMemory | Cross-agent memory | 10.9M |
| DNALoader | DNA pattern loading | 10.4M |
| CognitiveIndex | Cognitive indexing | 10.6M |
| SecretsEngine | Secret management | 10.0M |
| MissionEngine | Mission lifecycle | 8.4M |
| EvaluationEngine | Governance evaluation | 8.7M |
| AuditEngine | Audit pipeline | 1.8M |
| PipelineEngine | Pipeline orchestration | 1.6M |
| GovernanceEngine | Rule evaluation | 1.3M |
| ContextRecoveryEngine | Context recovery | 487K |
| LocalRuntime | Local execution | 2.9M |
| Registry | Service registry | 9.6M |
| AIResourceManager | Resource management | 9.8M |
| CapabilityCatalog | Capability matching | 7.3M |
| QueueManager | Task queuing | 7.7M |
| KnowledgeGraph | Knowledge graph | 8.6M |

## Integration Points

### MCP Server (standalone)
- 11 tools + 2 resources exposed via Model Context Protocol
- Deliberately **not** registered in the OpenCode v2 config (`.mcp.json` is ignored by v2)
- Targeted at external MCP clients: Claude Code, Cursor, Windsurf, VS Code Copilot

### OpenCode v2 Plugin (single native channel)
- 12 `bos_*` tools registered via `ctx.tool.transform()` + `tools.add()`
- Governance hook on `execute.before` (write/edit/bash interception)
- Session context hook surfacing protocol state to the model
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
3. **Audit trail** - Every action logged with timestamp and context
4. **Quality gates** - Prevent deployment without passing checks
5. **Learning from failures** - Patterns detected and auto-corrected

## Extensibility

### Adding New DNA Patterns
1. Create YAML in `dnas/`
2. Register in `packages/dnas/src/index.ts`
3. Add tests in `packages/core/tests/dna/`

### Adding MCP Tools
1. Define tool in `packages/mcp-server/src/tools/`
2. Register in server
3. Add schema validation

### Adding OpenCode Plugin Tools
1. Use `ctx.tool.transform()` in plugin setup
2. Register with JSON Schema
3. Implement execute handler

## Performance Characteristics

- Schema validation: < 1ms per operation
- Governance evaluation: < 10ms for 100 rules
- Audit pipeline: < 100ms for full stack
- Learning pattern detection: < 50ms for 1000 events

## Testing Strategy

- Unit tests: Each engine isolated
- Integration tests: Full pipeline validation
- E2E tests: MCP server interaction
- Coverage target: > 80%
