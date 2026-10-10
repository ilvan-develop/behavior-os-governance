# Behavior-OS Protocol

## 7-Step Protocol

### Step 1: Select DNA Pattern
```bash
bos_select_dna --pattern <name>
```
Choose from: surgical-team, enterprise-governance, military-operations, lean-factory

### Step 2: Display DNA Block
Show the selected DNA pattern to verify governance rules are active.

### Step 3: Resolve Truth
```bash
bos_resolve_truth --mission <id>
```
Verify requirements and constraints.

### Step 4: Create Mission
```bash
bos_create_mission --title "<title>" --type <type> --priority <priority>
```

### Step 5: Delegate
Execute work using delegation tools.

### Step 6: Run Audit
```bash
bos_run_audit --mission <id> --agent <agent-id>
```

### Step 7: Record Learning
```bash
bos_record_learning --type insight --source "post-mortem" --content "<insight>" --impact high
```

## Critical Rules

1. **Read state first**: Always check `.behavioros/state.json` at session start
2. **Write state after**: Update state after each protocol step
3. **DNA selection**: Must call `bos_select_dna` before every task
4. **Display DNA**: Show DNA block to human for verification
5. **No direct edits**: Always delegate file operations
6. **Audit required**: Run audit before marking mission complete
7. **Learn always**: Record learning at end of every mission
