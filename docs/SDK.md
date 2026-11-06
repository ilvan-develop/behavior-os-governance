# Behavior-OS SDK Reference

## Installation

```bash
pnpm add @behavior-os/core @behavior-os/sdk
pnpm add -g @behavior-os/cli
```

## Quick Start

```typescript
import { BehaviorOS } from '@behavior-os/sdk';

const bos = new BehaviorOS({
  dnaPath: './dnas/enterprise-governance.yaml',
  quality: { enabled: true, minCoverage: 80 },
  audit: { enabled: true },
  learning: { enabled: true },
});

// Load DNA pattern
await bos.loadDNA(yourDNA);

// Evaluate governance
const decision = bos.evaluateGovernance('deploy-production', {
  agent: 'devops-agent',
  scope: 'production',
});

// Create mission (synchronous — no await)
const mission = bos.createMission({
  title: 'Implement payment module',
  type: 'feature',
  priority: 'high',
});

// Run audit
const report = bos.runAudit({
  missionId: mission.id,
  agentId: 'devops-agent',
});

// Record learning
bos.recordLearning({
  type: 'insight',
  source: 'post-mortem',
  content: 'Blue-green deployment reduced rollback time by 40%',
  impact: 'high',
});
```

## API Reference

### BehaviorOS Class

#### Constructor

```typescript
new BehaviorOS(config?: BehaviorOSConfig)
```

#### Methods

| Method                                | Returns                   | Description                                                                         |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `loadDNA(dna)`                        | `Promise<void>`           | Load a DNA pattern                                                                  |
| `getDNA()`                            | `DNA \| null`             | Get current DNA                                                                     |
| `evaluateGovernance(action, context)` | `GovernanceDecision`      | Evaluate governance rules                                                           |
| `checkQuality(metrics)`               | `{passed, details}`       | Check quality gates                                                                 |
| `runAudit(options)`                   | `AuditReport`             | Run audit pipeline                                                                  |
| `createMission(options)`              | `Mission`                 | Create new mission (`requiredChecks?` declares evidence gates)                      |
| `startMission(id)`                    | `Mission \| null`         | Legacy start wrapper                                                                |
| `transitionMission(id, to, options?)` | `MissionTransitionResult` | Validated transition with optional `evidence`, `expectedVersion`, `actor`, `reason` |
| `completeMission(id, options?)`       | `Mission \| null`         | Legacy completion wrapper (evidence-gated)                                          |
| `failMission(id, reason?, options?)`  | `Mission \| null`         | Legacy failure wrapper                                                              |
| `pauseMission(id, options?)`          | `MissionTransitionResult` | Pause an active mission                                                             |
| `resumeMission(id, options?)`         | `MissionTransitionResult` | Resume a paused mission                                                             |
| `cancelMission(id, options?)`         | `MissionTransitionResult` | Cancel a non-terminal mission                                                       |
| `recordLearning(options)`             | `LearningEvent`           | Record learning event                                                               |
| `getInsights(limit)`                  | `LearningEvent[]`         | Get high-impact insights                                                            |
| `getStatus()`                         | `Status`                  | Get system status                                                                   |
| `getState()`                          | `AgentState`              | Get protocol state                                                                  |
| `updateState(updates)`                | `void`                    | Update protocol state                                                               |

### Types

#### DNA

```typescript
interface DNA {
  name: string;
  version: string;
  description: string;
  personas: Persona[];
  governance: GovernanceRule[];
  quality: QualityGate[];
  workflows?: Workflow[];
}
```

#### GovernanceDecision

```typescript
interface GovernanceDecision {
  id: string;
  action: string;
  verdict: 'allow' | 'deny' | 'escalate' | 'transform';
  reason: string;
  rulesEvaluated: string[];
  timestamp: string;
  agentId: string;
  missionId?: string;
}
```

#### Mission

```typescript
interface Mission {
  id: string;
  title: string;
  description?: string;
  type: 'feature' | 'bugfix' | 'deployment' | 'research' | 'refactor' | 'audit' | 'incident';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  dnaPattern: string;
  createdBy: string;
  assignedTo?: string[];
  createdAt: string;
  updatedAt: string;
  progress: number;
  tags?: string[];
  version?: number;
  requiredChecks?: string[];
  evidence?: MissionEvidence[];
  transitions?: MissionTransition[];
  completionBasis?: 'evidence' | 'no-required-checks';
  lastTransitionReason?: string;
}

interface MissionEvidence {
  gate: string;
  status: 'passed' | 'failed' | 'skipped';
  source: string;
  detail?: string;
  simulated?: boolean;
  recordedAt: string;
}

interface MissionTransition {
  from: Mission['status'];
  to: Mission['status'];
  at: string;
  actor: string;
  reason?: string;
  version: number;
}
```

#### AgentState

```typescript
interface AgentState {
  currentStep: number;
  selectedDna: string | null;
  activeMission: string | null;
  stepHistory: Record<string, any>[];
  createdAt: string;
  updatedAt: string;
}
```

### Governance Verdicts

| Verdict     | Description                           |
| ----------- | ------------------------------------- |
| `allow`     | Action is permitted                   |
| `deny`      | Action is blocked                     |
| `escalate`  | Action requires human review          |
| `transform` | Action can proceed with modifications |

### DNA Actions

| Action     | Effect                              |
| ---------- | ----------------------------------- |
| `block`    | Completely prevents the action      |
| `escalate` | Requires approval before proceeding |
| `warn`     | Allows but logs a warning           |
| `log`      | Records only, no restriction        |

## CLI Usage

```bash
# Initialize project (creates dnas/, .behavioros/state.json, .mcp.json)
npx @behavior-os/cli init --directory ./my-project --dna enterprise-governance

# Parse and validate every DNA pattern in dnas/
npx @behavior-os/cli compile

# Validate the project layout plus every DNA pattern
npx @behavior-os/cli validate

# Show engine status plus .behavioros/state.json
npx @behavior-os/cli status

# Compare dnas/*.yaml with .behavioros/baseline.json
npx @behavior-os/cli diff

# Evaluate one action against the loaded DNA rules
npx @behavior-os/cli simulate --action deploy --agent devops-agent

# Print the deployment gate plan + a real pre-flight (does not deploy)
npx @behavior-os/cli deploy

# Check the 7 steps against the local state file
npx @behavior-os/cli protocol

# Compare selectedDna/currentStep with the baseline
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

Inside this repository OpenCode discovers `.opencode/plugins/behavioros.ts`, which
re-exports the built package. The MCP server is deliberately **not** registered in
OpenCode, so a session sees one tool catalog (the plugin's 91 `bos_*` tools):

```json
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["docs/PROTOCOL.md", "docs/ARCHITECTURE.md"]
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
