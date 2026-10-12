<p align="center">
  <img src="https://raw.githubusercontent.com/ilvan-develop/behavioros/main/website/logo.svg" alt="Behavior-OS Logo" width="140" />
</p>

<h1 align="center">Behavior-OS v2.0</h1>

<p align="center">
  <strong>The Operating System for Autonomous AI Agent Teams</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/tests-366%2B-brightgreen" alt="Tests" /></a>
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
| Agents don't learn from mistakes | Learning engine records events & detects recurring patterns |
| Hard to coordinate multiple agents | 7-step protocol + auto-derived missions for traceable work |
| No quality gates | Quality gates + audit stages (lint → typecheck → security → coverage) |
| Reinventing infrastructure every project | 8 core engines, 15 MCP tools + 2 resources, CLI, SDK — batteries included |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      MISSION LAYER                    │
│   Lifecycle: create → start → execute → complete/fail │
├──────────────────────────────────────────────────────┤
│                     DECISION LAYER                    │
│   Weighted votes → majority / supermajority / quorum  │
├──────────────────────────────────────────────────────┤
│                      LEARNING LAYER                   │
│   Record events → detect recurring patterns           │
├──────────────────────────────────────────────────────┤
│                      QUALITY LAYER                    │
│   Gates: test_coverage / lint / typecheck / security  │
├──────────────────────────────────────────────────────┤
│                      AUDIT LAYER                      │
│   Stages: lint → typecheck → security → coverage      │
│   (simulated by default; real checks opt-in)          │
├──────────────────────────────────────────────────────┤
│                   GATE PIPELINE                       │
│   preflight: governance gate (blocking) → quality     │
├──────────────────────────────────────────────────────┤
│                   GOVERNANCE LAYER                    │
│   Rules: block | escalate | warn | log | transform    │
├──────────────────────────────────────────────────────┤
│                  BEHAVIORAL LAYER                     │
│   Load DNA (YAML) + validate against Zod schemas      │
├──────────────────────────────────────────────────────┤
│                    SCHEMA LAYER                       │
│   Zod v4 schemas for every domain type                │
├──────────────────────────────────────────────────────┤
│                   DNA LAYER (YAML)                    │
│   Personas | governance rules | quality gates         │
└──────────────────────────────────────────────────────┘

> The 9-layer diagram above is documentation of the conceptual stack. Only the
> **8 engines** listed below are implemented in code; there is no separate
> "Behavioral" or "Compiler" engine.
```

### 8 Core Engines Powering the Stack

| Engine | Purpose |
|---|---|
| GovernanceEngine | Rule-based governance evaluation with caching |
| QualityEngine | Quality gate enforcement (gte/lte/eq/neq) |
| AuditEngine | Multi-stage audit pipeline (real or simulated) |
| LearningEngine | Pattern detection + confidence-scored DNA evolution proposals |
| MissionEngine | In-memory mission lifecycle management |
| PipelineEngine | Ordered gates with synchronous pre-execution blocking |
| DecisionEngine | Weighted voting/quorum (majority/supermajority/unanimous) |
| DNALoader | YAML pattern loading with Zod validation |

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

### 21 DNA Patterns

These are the 21 patterns actually shipped in `dnas/*.yaml`:

| Pattern (file) | Domain |
|---|---|
| **ai-ml-pipeline** | ML training, datasets, drift, inference |
| **blockchain-web3** | Smart contracts, on-chain, wallets |
| **cloud-native** | Kubernetes, containers, IaC |
| **data-engineering** | ETL, warehouses, data quality, lineage |
| **devops-pipeline** | CI/CD, releases, rollbacks |
| **enterprise-governance** | Compliance, change control, audit |
| **enterprise-sox** | SOX, segregation of duties, internal controls |
| **financial-compliance** | KYC/AML, transaction monitoring |
| **fintech-trading** | Order books, latency, risk limits |
| **gaming-studio** | Game pipelines, shaders, anti-cheat |
| **healthcare-hipaa** | HIPAA, PHI, patient records |
| **iot-embedded** | Firmware, sensors, RTOS |
| **lean-factory** | Kaizen, waste reduction, value stream |
| **legacy-modernization** | Strangler patterns, COBOL migration |
| **military-operations** | Chain of command, OPSEC, mission focus |
| **mobile-app** | iOS/Android, app stores |
| **open-source** | PRs, licensing, changelog/DCO |
| **quantum-computing** | Qubits, circuits, Qiskit |
| **research-lab** | Experiments, reproducibility |
| **startup-agile** | Sprints, MVPs, backlogs |
| **surgical-team** | Zero-defect, sterile-field, production changes |

> There is **no** `eaarg`, `e-commerce`, `gaming-platform`, `nextjs-nestjs`,
> `python-go-microservices`, or `complex-monorepo` DNA file in this repository.
> Patterns are plain YAML validated by Zod — there is no separate "SkillEngine".

### MCP Server — 15 Tools + 2 Resources

Connect Behavior-OS to any MCP-capable client (Claude Code, Cursor, VS Code, Windsurf):

| Category | Tools |
|---|---|
| **Governance** | `bos_select_dna`, `bos_list_dna`, `bos_evaluate_governance`, `bos_preflight` |
| **Mission** | `bos_create_mission`, `bos_start_mission`, `bos_list_missions` |
| **Quality** | `bos_check_quality`, `bos_run_audit` |
| **Decision** | `bos_decide` |
| **Evolution** | `bos_evolution` |
| **Learning** | `bos_record_learning`, `bos_get_insights` |
| **Status** | `bos_get_status`, `bos_get_state`, `bos_verify_audit_trail` |

Resources: `behavioros://protocol/steps`, `behavioros://dna/catalog`

### Persistence (opt-in)

State survives restarts. The default store uses the built-in `node:sqlite` module
(Node ≥ 22.5, **no external dependency**): `missions`, `learnings`, `agents`,
`audit_log`, `pipeline_runs`, `decisions` and a key/value `meta` table.

```ts
const bos = new BehaviorOS({ persistence: { path: './behavioros.db' } });
```

For the MCP server, set `BEHAVIOROS_DB_PATH` instead. Without a path the engine
runs fully in memory; an unusable path degrades to memory rather than throwing.

Any store implementing the `Store` interface can be injected — for example
`PostgresStore` (which resolves the optional `pg` driver lazily and keeps an
in-memory mirror with async write-through):

```ts
const store = new PostgresStore({ connectionString: process.env.DATABASE_URL });
await store.connect();
const bos = new BehaviorOS({ persistence: { store } });
```

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

Counted from the repository (not aspirational). Run `pnpm test` for the live result.

| Metric | Value |
|---|---|
| Test files (`*.test.ts`) | 45 |
| Test cases (`it`/`test` blocks) | 366 |
| Typecheck | `pnpm typecheck` (0 errors) |
| Build | `pnpm build` (ESM + DTS) |
| Coverage | `pnpm test:coverage` |

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

### OpenCode v2 (recommended — native plugin)

The `@behavior-os/opencode-plugin` is the native OpenCode v2 integration. It is
auto-loaded from `.opencode/plugins/behavioros.ts` and exposes the full 14-tool
surface (`bos_*`) plus governance hooks (`tool:execute.before`) and session
context — no MCP server registration required.

The MCP server is intentionally **not** registered inside OpenCode so sessions
see a single, non-duplicated tool catalog. For other MCP-capable hosts use the
sections above.

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
| `@behavior-os/core` | 8 engines + EngineRegistry | 2.0.0 |
| `@behavior-os/sdk` | High-level TypeScript SDK | 2.0.0 |
| `@behavior-os/cli` | CLI: init, compile, validate, status | 2.0.0 |
| `@behavior-os/mcp-server` | MCP server with 15 tools + 2 resources | 2.0.0 |
| `@behavior-os/opencode-plugin` | OpenCode v2 plugin with 14 tools + hooks | 2.0.0 |

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Created with by <strong>Ilvan Joaquim</strong> from Angola 🇦🇴<br>
  <a href="https://github.com/ilvan-develop/behavioros">GitHub</a> ·
  <a href="./docs/PROTOCOL.md">Protocol</a> ·
  <a href="./docs/ARCHITECTURE.md">Architecture</a>
</p>
