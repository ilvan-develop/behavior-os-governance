# Behavior-OS Quick Start

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0
- Git

## Installation

```bash
# Clone the repository
git clone https://github.com/ilvan-develop/behavioros.git
cd behavioros

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## Initialize a New Project

```bash
# Initialize with enterprise governance
npx @behavior-os/cli init --project-name my-app --dna-pattern enterprise-governance

# Initialize with surgical team (zero-defect)
npx @behavior-os/cli init --project-name my-app --dna-pattern surgical-team
```

## Core Concepts

### DNA Patterns

DNA patterns define the behavioral rules for AI agents. Each DNA includes:
- **Personas**: Agent roles and responsibilities
- **Governance Rules**: Block/escalate/warn/log policies
- **Quality Gates**: Test coverage, linting, security thresholds

### The 7-Step Protocol

1. **Select DNA** — Choose behavioral pattern
2. **Display DNA Block** — Verify governance rules
3. **Resolve Truth** — Verify requirements
4. **Create Mission** — Define the task
5. **Delegate** — Execute work
6. **Run Audit** — Validate compliance
7. **Record Learning** — Improve system

### Mission Lifecycle

```
pending → active → completed
                  → failed
                  → cancelled
```

## Quick Example

```typescript
import { BehaviorOS } from "@behavior-os/core";

const bos = new BehaviorOS();

// Load DNA pattern
await bos.loadDNA({
  name: "Surgical Team",
  version: "1.0.0",
  description: "Zero-defect governance",
  personas: [],
  governance: [
    {
      id: "code-review",
      level: "critical",
      action: "block",
      conditions: [{ type: "production", value: true }],
    }
  ],
  quality: [
    { id: "coverage", type: "test_coverage", threshold: 80 }
  ]
});

// Create and manage mission
const mission = bos.createMission({
  title: "Implement feature",
  type: "feature",
  priority: "high",
});

// Evaluate governance before action
const decision = bos.evaluateGovernance("deploy", {
  agent: "devops-agent",
  context: { production: true }
});

if (decision.verdict === "deny") {
  console.log("Action blocked:", decision.reason);
}

// Complete mission with audit
bos.completeMission(mission.id);
const report = bos.runAudit({ missionId: mission.id, agentId: "devops-agent" });
```

## CLI Commands

```bash
# Check status
npx @behavior-os/cli status

# Run protocol check
npx @behavior-os/cli protocol check

# Validate DNA patterns
npx @behavior-os/cli validate --pattern ./dnas/surgical-team.yaml

# Start observability dashboard
npx @behavior-os/cli dashboard --port 3000
```

## Integrations

### Claude Code
```json
// .mcp.json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"]
    }
  }
}
```

### Cursor IDE
Add to `.cursor/rules/`:
```
protocol.mdc
skill.mdc
```

### OpenCode v2
```json
// opencode.json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"]
    }
  },
  "plugins": {
    "behavioros": {
      "path": "./plugins/opencode-v2/dist/index.js"
    }
  }
}
```

## Next Steps

- Read the [Full Documentation](./docs/)
- Explore [DNA Patterns](./dnas/)
- Check [Architecture Guide](./docs/ARCHITECTURE.md)
- Join the [Community](https://github.com/ilvan-develop/behavioros/discussions)
