# Behavior-OS Protocol

## 7-Step Protocol

Step names and the tool that completes each step are fixed by
`PROTOCOL_TOOL_STEPS` in `packages/core/src/engine/behavior-os.ts`.

### Step 1: Select DNA
Use `bos_select_dna` with any of the 21 patterns in `dnas/*.yaml`, e.g.
`surgical-team`, `enterprise-governance`, `military-operations`, `lean-factory`.

### Step 2: Confirm DNA rules
Use `bos_list_dna` to list the available patterns.

### Step 3: Resolve state
Use `bos_get_state` to read the current protocol state.

### Step 4: Create mission
`bos_create_mission` — title, type, priority.

### Step 5: Start mission
`bos_start_mission`.

### Step 6: Run audit
`bos_run_audit`. The audit identity comes from the DNA persona or a registered
agent, never from the model name.

### Step 7: Record learning
`bos_record_learning`.

## Rules

1. Select a DNA before any governed action; without one the gate pipeline reports
   `skipped` (not an implicit allow).
2. Read state with `bos_get_state`; the OpenCode plugin also restores persisted
   state from `ctx.storage`.
3. Run `bos_run_audit` before completion.
4. Record a learning after every mission.
5. Do **not** delegate file operations — there is no such rule. File changes go
   through the governed path: `bos_code_edit` is a dry run unless code editing is
   enabled (`BEHAVIOROS_CODE_EDIT=true`) and `apply: true`.

Full detail: [`docs/PROTOCOL.md`](../docs/PROTOCOL.md), verified inventory in
[`docs/CLAIMS.md`](../docs/CLAIMS.md).
