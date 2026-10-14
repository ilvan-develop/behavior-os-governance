# Behavior-OS Runtime State

This directory holds the **local** CLI state for a project.

## Files

| File | Written by | Purpose |
|------|-----------|---------|
| `state.json` | `behavioros init`, `behavioros autonomous` | Local protocol state (`currentStep`, `selectedDna`, `activeMission`, `stepHistory`) |
| `baseline.json` | `behavioros diff` | DNA snapshot used by `behavioros drift-check` |

Nothing regenerates **this** README: it is a static document. The OpenCode plugin
does not use these files — it persists its state through `ctx.storage`
(`behavioros:state`).

## Protocol steps

The 7 steps and the tool that completes each one are defined once, in
`PROTOCOL_STEPS` (`packages/core/src/engine/behavior-os.ts`); the MCP resource
`behavioros://protocol/steps` and the OpenCode plugin serve that same list:

| Step | Tool | Name |
|------|------|------|
| 1 | `bos_select_dna` | Select DNA Pattern |
| 2 | `bos_list_dna` | Confirm DNA Rules |
| 3 | `bos_get_state` | Resolve State |
| 4 | `bos_create_mission` | Create Mission |
| 5 | `bos_start_mission` | Start Mission |
| 6 | `bos_run_audit` | Run Audit |
| 7 | `bos_record_learning` | Record Learning |

## Inspecting it

```bash
npx @behavior-os/cli status      # engine status + state.json summary
npx @behavior-os/cli protocol    # which steps appear in stepHistory
npx @behavior-os/cli drift-check # currentStep/selectedDna vs baseline.json
```

## Updating it

```typescript
const bos = new BehaviorOS();
bos.updateState({ currentStep: 3, selectedDna: 'surgical-team' });
```

`updateState` changes the in-memory engine state; `state.json` is only rewritten
by the CLI commands listed above.
