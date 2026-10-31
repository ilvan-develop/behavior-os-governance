# Behavior-OS Quick Start

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0
- Git

## Installation

```bash
# Clone the repository
git clone https://github.com/ilvan-develop/behavior-os.git
cd behavior-os

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Initialize a New Project

```bash
# Initialize with enterprise governance (the default pattern)
npx @behavior-os/cli init --dna enterprise-governance

# Initialize with surgical team (zero-defect)
npx @behavior-os/cli init --dna surgical-team
```

## Core Concepts

### DNA Patterns

DNA patterns define the behavioral rules for AI agents. Each DNA includes:
- **Personas**: Agent roles and responsibilities
- **Governance Rules**: Block/escalate/warn/log policies
- **Quality Gates**: Test coverage, linting, security thresholds

### The 7-Step Protocol

1. **Select DNA Pattern** (`bos_select_dna`) — choose the behavioural pattern
2. **Confirm DNA Rules** (`bos_list_dna`) — see what the pattern allows
3. **Resolve State** (`bos_get_state`) — read the current protocol state
4. **Create Mission** (`bos_create_mission`) — define the task
5. **Start Mission** (`bos_start_mission`) — begin the mission
6. **Run Audit** (`bos_run_audit`) — validate compliance
7. **Record Learning** (`bos_record_learning`) — feed the learning engine

### Mission Lifecycle

```
pending → active → completed
                  → failed
                  → cancelled
```

## Quick Example

```typescript
import { BehaviorOS } from '@behavior-os/core';

const bos = new BehaviorOS();

// Load a DNA pattern from the dnas/ directory (validated against DNASchema)
const dna = await bos.loadDNAFromDirectory('./dnas/surgical-team.yaml');
await bos.loadDNA(dna);

// Create and manage mission
const mission = bos.createMission({
  title: 'Implement feature',
  type: 'feature',
  priority: 'high',
});

// Evaluate governance before action
const decision = bos.evaluateGovernance('deploy', {
  agent: 'devops-agent',
  context: { production: true },
});

if (decision.verdict === 'deny') {
  console.log('Action blocked:', decision.reason);
}

// Complete mission with audit
bos.completeMission(mission.id, {
  requiredChecks: ['test', 'typecheck'],
  verificationMode: 'real',
});
const report = await bos.runAudit({ missionId: mission.id, agentId: 'devops-agent' });
```

## CLI Commands

Run `npx @behavior-os/cli --help` for the full list (13 commands, exit code `0`/`1`).

```bash
# Scaffold a project (dnas/, .behavioros/state.json, .mcp.json, sample DNA)
npx @behavior-os/cli init --dna surgical-team

# Validate the layout and every DNA pattern in dnas/
npx @behavior-os/cli validate

# Engine status (DNA, missions, agents) + .behavioros/state.json
npx @behavior-os/cli status

# Check the 7 protocol steps against the local state
npx @behavior-os/cli protocol

# Print the deployment gate plan and run the real pre-flight (does not deploy)
npx @behavior-os/cli deploy
```

## Integrations

### Claude Code

`behavioros init` writes exactly this `.mcp.json` into the scaffolded project:

```json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["<mcp-server>/dist/server.js"],
      "env": {
        "BEHAVIOROS_DNA_PATH": "./dnas/enterprise-governance.yaml"
      }
    }
  }
}
```

### Cursor IDE

Add to `.cursor/rules/`: `protocol.mdc` and `skill.mdc` (this repository ships
both under `.cursor/rules/`). The MCP server goes in `.cursor/mcp.json` with the
same shape as the Claude Code config above.

### OpenCode v2

OpenCode discovers local plugins from `.opencode/plugins/`. This repository
carries `.opencode/plugins/behavioros.ts`, a one-line loader that re-exports the
built package (`pnpm build` emits `plugins/opencode-v2/dist/index.js`):

```json
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["docs/PROTOCOL.md", "docs/ARCHITECTURE.md"]
}
```

The plugin exposes the 70 `bos_*` tools directly; the MCP server is deliberately
not registered inside OpenCode so a session sees a single tool catalog.

## Next Steps

- Read the [Full Documentation](./docs/)
- Explore [DNA Patterns](./dnas/)
- Check [Architecture Guide](./docs/ARCHITECTURE.md)
- Join the [Community](https://github.com/ilvan-develop/behavior-os/discussions)
