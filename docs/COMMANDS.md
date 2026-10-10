# Behavior-OS Command Reference

## Core Commands

### DNA Management
```bash
# Load a DNA pattern
bos_select_dna --pattern surgical-team

# Display current DNA
bos_display_dna

# Validate DNA
bos_validate_dna --pattern ./path/to/dna.yaml
```

### Mission Management
```bash
# Create a mission
bos_create_mission --title "Deploy feature" --type feature --priority high

# Start a mission
bos_start_mission --id <mission-id>

# Complete a mission
bos_complete_mission --id <mission-id> --result "Success"

# Fail a mission
bos_fail_mission --id <mission-id> --reason "Something went wrong"

# List missions
bos_list_missions --status active
```

### Governance
```bash
# Evaluate governance rule
bos_evaluate_governance --action deploy --agent devops-agent --context production=true

# Check quality gates
bos_check_quality --metrics test_coverage=90 lint_errors=0
```

### Audit
```bash
# Run audit
bos_run_audit --mission <mission-id> --agent <agent-id>

# Get audit report
bos_get_audit_report --id <audit-id>
```

### Learning
```bash
# Record learning
bos_record_learning --type insight --source post-mortem --content "Learned X" --impact high
```

## CLI Commands

### Init
```bash
# Initialize a new Behavior-OS project
npx @behavior-os/cli init --directory ./my-project

# Options:
#   --project-name      Name of the project (default: "my-project")
#   --dna-pattern       DNA pattern to use (default: "enterprise-governance")
#   --framework         Framework to scaffold (default: "none")
#   --no-git            Skip git initialization
```

### Compile
```bash
# Compile DNA patterns
npx @behavior-os/cli compile --patterns ./dnas/*.yaml

# Options:
#   --output            Output directory (default: "./dist")
#   --watch             Watch for changes
#   --validate          Validate before compile
```

### Validate
```bash
# Validate a DNA pattern
npx @behavior-os/cli validate --pattern ./dnas/surgical-team.yaml

# Validate all patterns
npx @behavior-os/cli validate --all
```

### Status
```bash
# Check system status
npx @behavior-os/cli status

# Check protocol compliance
npx @behavior-os/cli protocol check
```

### Diff
```bash
# Compare DNA versions
npx @behavior-os/cli diff --base ./dnas/v1.yaml --current ./dnas/v2.yaml
```

### Simulate
```bash
# Simulate agent behavior
npx @behavior-os/cli simulate --dna surgical-team --agent devops-agent --actions deploy,test

# Options:
#   --steps            Number of simulation steps (default: 10)
```

### Deploy
```bash
# Deploy with governance checks
npx @behavior-os/cli deploy --target production --verify

# Options:
#   --verify           Run quality gates before deploy
#   --dry-run          Preview deploy without executing
```

### Protocol
```bash
# Check protocol compliance
npx @behavior-os/cli protocol check

# Show protocol status
npx @behavior-os/cli protocol status
```

### Dashboard
```bash
# Start observability dashboard
npx @behavior-os/cli dashboard --port 3000
```

### Config
```bash
# Initialize configuration
npx @behavior-os/cli config init

# Get configuration
npx @behavior-os/cli config get

# Set configuration
npx @behavior-os/cli config set key value
```

### Check
```bash
# Run comprehensive health check
npx @behavior-os/cli check

# Check dependencies
npx @behavior-os/cli check deps
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BOS_LOG_LEVEL` | Logging level | info |
| `BOS_DATA_DIR` | Data directory | ~/.behavioros |
| `BOS_ENFORCE` | Governance mode | PERMISSIVE |
| `BOS_PORT` | Dashboard port | 3000 |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic error |
| 2 | Validation failed |
| 3 | Governance block |
| 4 | Configuration error |

## Examples

### Quick Start
```bash
# 1. Initialize
npx @behavior-os/cli init --project-name my-app --dna-pattern surgical-team

# 2. Create mission
npx @behavior-os/cli create-mission --title "Setup API" --type feature --priority high

# 3. Run protocol
npx @behavior-os/cli protocol check

# 4. Check status
npx @behavior-os/cli status
```

### Development Workflow
```bash
# While developing
npx @behavior-os/cli compile --watch

# Test governance
npx @behavior-os/cli simulate --dna enterprise-governance --actions deploy,rollback

# Run full check
npx @behavior-os/cli check --all
```

### Production Deployment
```bash
# Deploy with verification
npx @behavior-os/cli deploy --target production --verify --env prod

# Check post-deployment
npx @behavior-os/cli status --verbose
```
