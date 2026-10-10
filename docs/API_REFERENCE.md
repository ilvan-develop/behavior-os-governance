# Behavior-OS API Reference

## Core API

### BehaviorOS Class

```typescript
class BehaviorOS {
  // DNA Management
  loadDNA(dna: DNA): Promise<void>
  getDNA(): DNA | null
  listDNAPatterns(): string[]

  // Governance
  evaluateGovernance(action: string, context: Record<string, any>): GovernanceDecision

  // Mission Management
  createMission(config: CreateMissionConfig): Mission
  startMission(missionId: string): Mission | null
  completeMission(missionId: string): Mission | null
  failMission(missionId: string, reason: string): Mission | null
  getMission(missionId: string): Mission | null
  listMissions(filters?: MissionFilters): Mission[]

  // Audit
  runAudit(options: RunAuditOptions): AuditReport
  getAuditReport(reportId: string): AuditReport | null

  // Learning
  recordLearning(event: LearningEventConfig): LearningEvent
  getInsights(limit?: number): LearningEvent[]
  getPatterns(): LearningPattern[]

  // State
  getState(): AgentState
  updateState(state: Partial<AgentState>): void
  getStatus(): SystemStatus
}
```

### CreateMissionConfig

```typescript
interface CreateMissionConfig {
  title: string;
  type: MissionType;
  priority: MissionPriority;
  dnaPattern?: string;
  createdBy: string;
  metadata?: Record<string, any>;
}
```

### MissionFilters

```typescript
interface MissionFilters {
  status?: MissionStatus;
  priority?: MissionPriority;
  type?: MissionType;
  createdBy?: string;
}
```

### RunAuditOptions

```typescript
interface RunAuditOptions {
  missionId: string;
  agentId: string;
  stages?: AuditStage[];
}
```

### LearningEventConfig

```typescript
interface LearningEventConfig {
  type: LearningType;
  source: string;
  content: string;
  impact: LearningImpact;
  relatedMission?: string;
  metadata?: Record<string, any>;
}
```

## SDK API

### BehaviorOSSDK

```typescript
class BehaviorOSSDK {
  constructor(options?: SDKOptions)
  
  // Mission Management
  createMission(config: CreateMissionConfig): Promise<Mission>
  startMission(missionId: string): Promise<Mission | null>
  completeMission(missionId: string): Promise<Mission | null>
  failMission(missionId: string, reason: string): Promise<Mission | null>
  getMission(missionId: string): Promise<Mission | null>
  listMissions(filters?: MissionFilters): Promise<Mission[]>

  // Governance
  evaluateGovernance(
    action: string, 
    context: Record<string, any>,
    agentId?: string
  ): Promise<GovernanceDecision>

  // Learning
  recordLearning(event: LearningEventConfig): Promise<LearningEvent>
  getInsights(limit?: number): Promise<LearningEvent[]>
  getPatterns(): Promise<LearningPattern[]>

  // Status
  getStatus(): Promise<SystemStatus>
  getState(): Promise<AgentState>

  // Configuration
  loadConfig(config: Config): Promise<void>
  saveConfig(config: Config): Promise<void>
}
```

### SDKOptions

```typescript
interface SDKOptions {
  dataDir?: string;
  enforceMode?: 'ENFORCE' | 'PERMISSIVE' | 'MONITOR';
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}
```

## MCP Tools

### Governance Tools

| Tool | Description |
|------|-------------|
| bos_evaluate_governance | Evaluate action against governance rules |
| bos_select_dna | Select a DNA pattern |
| bos_get_dna_pattern | Retrieve a DNA pattern |
| bos_list_dna_patterns | List all available patterns |

### Mission Tools

| Tool | Description |
|------|-------------|
| bos_create_mission | Create a new mission |
| bos_start_mission | Start a mission |
| bos_complete_mission | Complete a mission |
| bos_fail_mission | Fail a mission |
| bos_list_missions | List missions |
| bos_get_mission | Get mission details |

### Audit Tools

| Tool | Description |
|------|-------------|
| bos_run_audit | Run audit for mission |
| bos_get_audit_report | Get audit report |
| bos_check_quality | Check quality gates |

### Learning Tools

| Tool | Description |
|------|-------------|
| bos_record_learning | Record learning event |
| bos_get_insights | Get insights |
| bos_get_patterns | Get detected patterns |

## CLI Commands

### init

Initialize a new Behavior-OS project.

```bash
npx @behavior-os/cli init [options]

Options:
  --directory <dir>          Project directory
  --project-name <name>      Project name
  --dna-pattern <pattern>    DNA pattern to use
  --framework <framework>    Framework to scaffold
  --no-git                   Skip git initialization
```

### compile

Compile DNA patterns.

```bash
npx @behavior-os/cli compile [options]

Options:
  --patterns <paths>         Pattern files to compile
  --output <dir>             Output directory
  --watch                    Watch for changes
  --validate                 Validate before compile
```

### validate

Validate a DNA pattern.

```bash
npx @behavior-os/cli validate [options]

Options:
  --pattern <path>           Pattern file to validate
  --all                      Validate all patterns
```

### status

Check system status.

```bash
npx @behavior-os/cli status [options]

Options:
  --verbose                  Show detailed status
  --json                     Output as JSON
```

### protocol

Protocol commands.

```bash
npx @behavior-os/cli protocol check
npx @behavior-os/cli protocol status
```

### create-mission

Create a mission.

```bash
npx @behavior-os/cli create-mission [options]

Options:
  --title <title>            Mission title
  --type <type>              Mission type
  --priority <priority>      Priority level
  --dna-pattern <pattern>    DNA pattern
  --created-by <agent>       Agent name
```

### simulate

Simulate agent behavior.

```bash
npx @behavior-os/cli simulate [options]

Options:
  --dna <pattern>            DNA pattern
  --agent <agent>            Agent name
  --actions <actions>        Actions to simulate
  --steps <count>            Number of steps
```

### deploy

Deploy with governance checks.

```bash
npx @behavior-os/cli deploy [options]

Options:
  --target <target>          Deployment target
  --verify                   Run quality gates
  --dry-run                  Preview without executing
  --env <environment>        Environment
```

### dashboard

Start observability dashboard.

```bash
npx @behavior-os/cli dashboard [options]

Options:
  --port <port>              Port number
```

### check

Run health check.

```bash
npx @behavior-os/cli check [options]

Options:
  --all                      Run all checks
  --deps                     Check dependencies
```
