<p align="center">
  <img src="https://raw.githubusercontent.com/ilvan-develop/behavioros/main/website/logo.svg" alt="Behavior-OS Logo" width="140" />
</p>

<h1 align="center">Behavior-OS v2.0</h1>

<p align="center">
  <strong>The Operating System for Autonomous AI Agent Teams</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/tests-5%2C200%2B-brightgreen" alt="Tests" /></a>
  <a href="#"><img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version" /></a>
  <a href="#"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="Node" /></a>
  <a href="#"><img src="https://img.shields.io/badge/typescript-strict-3178C6" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/pnpm-workspace-F69220" alt="pnpm" /></a>
</p>

---

Behavior-OS is a **behavioral governance framework** that gives AI agent teams DNA-driven rules, deterministic pipelines, and autonomous orchestration. Think of it as an operating system for AI agents — it defines *how* agents think, decide, collaborate, and learn.

## Quick Demo

```bash
# Install
pnpm install

# Initialize project
pnpm cli:init -- --directory ./my-project

# Run tests
pnpm test

# Build all packages
pnpm build
```

## Why Behavior-OS?

| Without Behavior-OS | With Behavior-OS |
|---|---|
| Agents act unpredictably | DNA patterns enforce deterministic behavior |
| No audit trail | Every action logged & auditable |
| Manual governance review | Automated rule evaluation (block/escalate/warn) |
| Agents don't learn from mistakes | Learning engine detects patterns & auto-applies fixes |
| Hard to coordinate multiple agents | 7-step protocol + handoff protocol for seamless collaboration |
| No quality gates | Lint → typecheck → security → coverage gates enforced automatically |
| Reinventing infrastructure every project | 22 engines, 45+ MCP tools, CLI, SDK — batteries included |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      MISSION LAYER                    │
│   Lifecycle: create → start → execute → complete      │
├──────────────────────────────────────────────────────┤
│                      LEARNING LAYER                   │
│   Record events → detect patterns → auto-apply fixes  │
├──────────────────────────────────────────────────────┤
│                      QUALITY LAYER                    │
│   Gates: coverage ≥ 80% | lint = 0 | typecheck = 0    │
├──────────────────────────────────────────────────────┤
│                      AUDIT LAYER                      │
│   Stages: lint → typecheck → security → coverage      │
├──────────────────────────────────────────────────────┤
│                    DECISION LAYER                     │
│   Voting-based decisions | configurable quorum        │
├──────────────────────────────────────────────────────┤
│                   GOVERNANCE LAYER                    │
│   Rules: block | escalate | warn | log                │
├──────────────────────────────────────────────────────┤
│                  BEHAVIORAL LAYER                     │
│   Load DNA | validate | compose multi-package patterns│
├──────────────────────────────────────────────────────┤
│                    SCHEMA LAYER                       │
│   Zod v4.4.3 schemas for every type                   │
├──────────────────────────────────────────────────────┤
│                   DNA LAYER (YAML)                    │
│   Personas | governance rules | quality gates         │
└──────────────────────────────────────────────────────┘
```

### 22 Engines Powering the Stack

| Engine | Ops/s | Engine | Ops/s |
|---|---|---|---|
| AutonomousDecomposer | 14.6M | AuditEngine | 1.8M |
| AITMPLAdapter | 15.9M | PipelineEngine | 1.6M |
| DecisionEngine | 14.1M | GovernanceEngine | 1.3M |
| QualityEngine | 14.1M | ContextRecoveryEngine | 487K |
| LearningEngine | 13.9M | LocalRuntime | 2.9M |
| LoggingEngine | 12.7M | Registry | 9.6M |
| DistributedMemory | 10.9M | AIResourceManager | 9.8M |
| DNALoader | 10.4M | CapabilityCatalog | 7.3M |
| CognitiveIndex | 10.6M | QueueManager | 7.7M |
| SecretsEngine | 10.0M | KnowledgeGraph | 8.6M |
| MissionEngine | 8.4M | EvaluationEngine | 8.7M |

## Features Deep Dive

### DNA Pattern System

Behavioral blueprints in YAML that define agent roles, governance rules, quality gates, and workflows.

```yaml
# dnas/surgical-team.yaml
personas:
  - role: architect
    name: Lead Surgeon
    authority: architect
    boundaries:
      - id: max-procedures
        type: max_modules
        value: 1
    skills: [surgical-procedure, team-leadership, clinical-decision]

governance:
  - id: sterile-field
    level: critical
    action: block
    conditions: [type:sterile-procedure, type:instrument-handling]

quality:
  - id: zero-defect
    type: test_coverage
    threshold: 100
```

### The 12 DNA Patterns

| Pattern | Description | Best For |
|---|---|---|
| **Surgical Team** | Zero-defect, sterile field, timeout verification, SBAR handoffs | Critical systems, production deploys |
| **Enterprise Governance** | Compliance, audit trails, access control, change management | Regulated industries |
| **Military Operations** | Chain of command, mission focus, after-action reviews | High-stakes coordination |
| **Lean Factory** | Kaizen events, 5S methodology, value stream mapping | Continuous improvement |
| **Healthcare Operations** | HIPAA compliance, patient data protection | Healthcare apps |
| **Autonomous Orchestrator** | Self-managing pipelines, auto-scaling agents | Fully autonomous operations |
| **E-Commerce Platform** | Transactional governance for multi-vendor marketplaces | Payments, checkout, marketplace ops |
| **Gaming Platform** | Matchmaking, in-game economy, anti-cheat governance | Multiplayer games |
| **Next.js + NestJS Fullstack** | Stack-specific conventions for a common fullstack pairing | Next.js/NestJS projects |
| **Python/Go Microservices** | Stack-specific conventions for polyglot microservices | Python/Go backends |
| **Complex Monorepo** | Cross-package governance for large monorepos | Monorepo maintainers |
| **EAARG** (Enterprise Agent Architecture Review) | 18-layer framework mapped to enterprise skills | Deep architecture review |

### SkillEngine — Two-Stage Routing

```
Request → DNA Match → Capability Match → Delegate → Validate
```

Skills are matched in two stages: first by DNA pattern compatibility, then by capability signature. 24 skills registered across 6 agent types.

### MCP Server — 45+ Tools + 9 Resources

Connect Behavior-OS to any AI agent platform via Model Context Protocol:

| Category | Tools |
|---|---|
| **Mission** | `create-mission`, `update-progress`, `list-missions`, `list-agents`, `get-status` |
| **Governance** | `evaluate-governance`, `bos_select_dna`, `bos_resolve_conflict`, `bos_check_escalation` |
| **Audit** | `run-audit`, `bos_run_audit`, `bos_lsp_diagnostics`, `bos_lsp_validate` |
| **Learning** | `record-learning`, `bos_get_insights`, `bos_resolve_truth`, `bos_list_patterns` |
| **Pipeline** | `start-pipeline`, `get-pipeline-status`, `validate-layer`, `approve-layer` |
| **CI/CD** | `cicd-run-audit`, `cicd-get-audit-history`, `cicd-record-learning` |
| **Ecosystem** | `bos-ecosystem-status`, `bos-ecosystem-install`, `bos-ecosystem-doctor` |
| **Skills** | `bos-skills-list`, `bos-skills-validate` |
| **Agent** | `bos-agent-metrics`, `bos-agent-handoff`, `bos-autonomous-task` |

### CLI Reference

| Command | Description |
|---|---|
| `npx @behavior-os/cli init` | Scaffold a new Behavior-OS project |
| `npx @behavior-os/cli compile` | Compile DNA packages |
| `npx @behavior-os/cli validate` | Validate DNA configurations |
| `npx @behavior-os/cli status` | Show system status & health |
| `npx @behavior-os/cli diff` | Detect behavioral drift between DNA versions |
| `npx @behavior-os/cli simulate` | Simulate governance decisions |
| `npx @behavior-os/cli deploy` | Deploy with quality gates |
| `npx @behavior-os/cli ecosystem status` | Show ecosystem status |
| `npx @behavior-os/cli agent list` | List all agents |
| `npx @behavior-os/cli autonomous run` | Run fully autonomous task |
| `npx @behavior-os/cli protocol check` | Check 7-step protocol compliance |
| `npx @behavior-os/cli drift-check` | Compare current vs baseline behavior |

## Test Status

| Package | Tests | Status |
|---|---|---|
| `@behavior-os/schemas` | 120 | ✅ All passing |
| `@behavior-os/core` | ~5,000+ | ✅ All passing |
| `@behavior-os/mcp-server` | 112 | ✅ All passing |
| **Total** | **~5,200+** | **✅ 0 failures** |
| **Typecheck** | All packages | **✅ 0 errors** |
| **Build** | ESM + CJS + DTS | **✅ <3s per package** |
| **Coverage** | Core engine | **✅ >80%** |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

```typescript
import { BehaviorOS } from '@behavior-os/sdk'

const bos = new BehaviorOS({
  dnaPath: './dnas/enterprise-governance.yaml',
  quality: { enabled: true, minCoverage: 80 },
  audit: { enabled: true },
  learning: { enabled: true },
})

const mission = await bos.createMission({
  title: 'Implement payment module',
  type: 'feature',
  priority: 'high',
})

const status = bos.getStatus()
// → { engine: true, dna: 'Enterprise Governance', missions: 1, agents: 5, ... }
```

## MCP Setup

### Claude Code

Create `.mcp.json`:
```json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"],
      "env": {
        "BEHAVIOROS_DNA_PATH": "./dnas/enterprise-governance.yaml"
      }
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` with the same config as Claude Code.

### VS Code + GitHub Copilot

Create `.vscode/mcp.json` with the same config as Cursor.

### OpenCode v2

Add to `opencode.json`:
```json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"],
      "env": {
        "BEHAVIOROS_DNA_PATH": "./dnas/enterprise-governance.yaml",
        "BEHAVIOROS_PROJECT": "my-project",
        "BEHAVIOROS_LOG_LEVEL": "info"
      }
    }
  },
  "plugins": [
    {
      "path": "./plugins/opencode-v2",
      "enabled": true
    }
  ]
}
```

### Windsurf

Add to `.windsurfrules`:
```yaml
mcpServers:
  behavioros:
    command: node
    args: [packages/mcp-server/dist/server.js]
    env:
      BEHAVIOROS_DNA_PATH: "./dnas/enterprise-governance.yaml"
```

## Packages

| Package | Description | Version |
|---|---|---|
| `@behavior-os/schemas` | Zod v4.4.3 schemas for all types | 2.0.0 |
| `@behavior-os/core` | 22 engines + EngineRegistry | 2.0.0 |
| `@behavior-os/sdk` | High-level TypeScript SDK | 2.0.0 |
| `@behavior-os/cli` | CLI: init, compile, validate, status | 2.0.0 |
| `@behavior-os/mcp-server` | MCP server with 45+ tools + 9 resources | 2.0.0 |
| `@behavior-os/opencode-plugin` | OpenCode v2 plugin with 7 tools | 2.0.0 |

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Created with by <strong>Ilvan Joaquim</strong> from Angola 🇦🇴<br>
  <a href="https://github.com/ilvan-develop/behavioros">GitHub</a> ·
  <a href="./docs/PROTOCOL.md">Protocol</a> ·
  <a href="./docs/ARCHITECTURE.md">Architecture</a>
</p>
