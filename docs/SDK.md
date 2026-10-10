# Behavior-OS SDK Reference

## Installation

```bash
pnpm add @behavior-os/core @behavior-os/sdk
pnpm add -g @behavior-os/cli
```

## Quick Start

```typescript
import { BehaviorOS } from '@behavior-os/sdk'

const bos = new BehaviorOS({
  dnaPath: './dnas/enterprise-governance.yaml',
  quality: { enabled: true, minCoverage: 80 },
  audit: { enabled: true },
  learning: { enabled: true },
})

// Load DNA pattern
await bos.loadDNA(yourDNA)

// Evaluate governance
const decision = bos.evaluateGovernance('deploy-production', {
  agent: 'devops-agent',
  scope: 'production',
})

// Create mission
const mission = await bos.createMission({
  title: 'Implement payment module',
  type: 'feature',
  priority: 'high',
})

// Run audit
const report = bos.runAudit({
  missionId: mission.id,
  agentId: 'devops-agent',
})

// Record learning
bos.recordLearning({
  type: 'insight',
  source: 'post-mortem',
  content: 'Blue-green deployment reduced rollback time by 40%',
  impact: 'high',
})
```

## API Reference

### BehaviorOS Class

#### Constructor
```typescript
new BehaviorOS(config?: BehaviorOSConfig)
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `loadDNA(dna)` | `Promise<void>` | Load a DNA pattern |
| `getDNA()` | `DNA \| null` | Get current DNA |
| `evaluateGovernance(action, context)` | `GovernanceDecision` | Evaluate governance rules |
| `checkQuality(metrics)` | `{passed, details}` | Check quality gates |
| `runAudit(options)` | `AuditReport` | Run audit pipeline |
| `createMission(options)` | `Mission` | Create new mission |
| `startMission(id)` | `Mission \| null` | Start mission |
| `recordLearning(options)` | `LearningEvent` | Record learning event |
| `getInsights(limit)` | `LearningEvent[]` | Get high-impact insights |
| `getStatus()` | `Status` | Get system status |
| `getState()` | `AgentState` | Get protocol state |
| `updateState(updates)` | `void` | Update protocol state |

### Types

#### DNA
```typescript
interface DNA {
  name: string
  version: string
  description: string
  personas: Persona[]
  governance: GovernanceRule[]
  quality: QualityGate[]
  workflows?: Workflow[]
}
```

#### GovernanceDecision
```typescript
interface GovernanceDecision {
  id: string
  action: string
  verdict: 'allow' | 'deny' | 'escalate' | 'transform'
  reason: string
  rulesEvaluated: string[]
  timestamp: string
  agentId: string
  missionId?: string
}
```

#### Mission
```typescript
interface Mission {
  id: string
  title: string
  description?: string
  type: 'feature' | 'bugfix' | 'deployment' | 'research' | 'refactor' | 'audit' | 'incident'
  priority: 'critical' | 'high' | 'medium' | 'low'
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  dnaPattern: string
  createdBy: string
  assignedTo?: string[]
  createdAt: string
  updatedAt: string
  progress: number
  tags?: string[]
}
```

#### AgentState
```typescript
interface AgentState {
  currentStep: number
  selectedDna: string | null
  activeMission: string | null
  stepHistory: Record<string, any>[]
  createdAt: string
  updatedAt: string
}
```

### Governance Verdicts

| Verdict | Description |
|---------|-------------|
| `allow` | Action is permitted |
| `deny` | Action is blocked |
| `escalate` | Action requires human review |
| `transform` | Action can proceed with modifications |

### DNA Actions

| Action | Effect |
|--------|--------|
| `block` | Completely prevents the action |
| `escalate` | Requires approval before proceeding |
| `warn` | Allows but logs a warning |
| `log` | Records only, no restriction |

## CLI Usage

```bash
# Initialize project
npx @behavior-os/cli init --directory ./my-project --dna enterprise-governance

# Compile DNA patterns
npx @behavior-os/cli compile

# Validate configuration
npx @behavior-os/cli validate

# Check system status
npx @behavior-os/cli status

# Detect behavioral drift
npx @behavior-os/cli diff

# Simulate governance decisions
npx @behavior-os/cli simulate --action deploy --agent devops-agent

# Deploy with quality gates
npx @behavior-os/cli deploy

# Check protocol compliance
npx @behavior-os/cli protocol check

# Compare behavior baselines
npx @behavior-os/cli drift-check
```

## MCP Integration

### Claude Code
Add to `.mcp.json`:
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

### OpenCode v2
Add to `opencode.json`:
```json
{
  "mcpServers": {
    "behavioros": {
      "command": "node",
      "args": ["packages/mcp-server/dist/server.js"]
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

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

## License

MIT
