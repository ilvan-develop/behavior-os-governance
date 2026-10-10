# Behavior-OS CLI Reference

## Commands

### init
Initialize a new Behavior-OS project.

```bash
npx @behavior-os/cli init [options]
```

**Options:**
- `-d, --directory <path>` - Target directory (default: ".")
- `--dna <pattern>` - Initial DNA pattern (default: "enterprise-governance")

**Example:**
```bash
npx @behavior-os/cli init --directory ./my-project --dna surgical-team
```

### compile
Compile DNA patterns and validate configuration.

```bash
npx @behavior-os/cli compile [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

### validate
Validate DNA configurations and project structure.

```bash
npx @behavior-os/cli validate [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

### status
Show system status and health information.

```bash
npx @behavior-os/cli status [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

### diff
Detect behavioral drift between DNA versions.

```bash
npx @behavior-os/cli diff [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

### simulate
Simulate governance decisions for testing.

```bash
npx @behavior-os/cli simulate [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")
- `--action <action>` - Action to simulate (default: "deploy")
- `--agent <agent>` - Agent ID (default: "test-agent")

**Example:**
```bash
npx @behavior-os/cli simulate --action deploy-production --agent devops-1
```

### deploy
Deploy with quality gates validation.

```bash
npx @behavior-os/cli deploy [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")
- `--mission-id <id>` - Mission ID to deploy

### ecosystem
Show ecosystem component information.

```bash
npx @behavior-os/cli ecosystem
```

**Output:**
- Registered skills count
- Available MCP servers
- Built-in DNA patterns
- Design systems available

### agent
Manage agents in the system.

```bash
npx @behavior-os/cli agent [command]
```

**Commands:**
- `list` - List all agents
- `register` - Register a new agent
- `metrics` - Get agent metrics

### autonomous
Run fully autonomous task with protocol enforcement.

```bash
npx @behavior-os/cli autonomous run [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")
- `-t, --task <task>` - Task description (required)

**Example:**
```bash
npx @behavior-os/cli autonomous run --task "Implement user authentication"
```

### protocol
Check 7-step protocol compliance.

```bash
npx @behavior-os/cli protocol check [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

**Output:**
- Protocol step completion status
- Current step indicator
- Pending actions

### drift-check
Compare current behavior vs baseline.

```bash
npx @behavior-os/cli drift-check [options]
```

**Options:**
- `-d, --directory <path>` - Project directory (default: ".")

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BEHAVIOROS_DNA_PATH` | Path to DNA file | "./dnas/enterprise-governance.yaml" |
| `BEHAVIOROS_PROJECT` | Project identifier | undefined |
| `BEHAVIOROS_LOG_LEVEL` | Logging level | "info" |
| `BEHAVIOROS_STATE_DIR` | State directory | ".behavioros" |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | Validation failed |
| 2 | Configuration error |
| 3 | Runtime error |

## Hooks

### Pre-flight Checks
Before any command, the CLI performs:
1. Node.js version check (>= 22)
2. pnpm version check (>= 9)
3. DNA file validation
4. State file existence

### Post-flight Actions
After command execution:
1. State file update
2. Audit log entry
3. Learning event capture (if applicable)
