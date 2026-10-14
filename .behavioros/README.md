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
`packages/core/src/engine/behavior-os.ts` (`PROTOCOL_TOOL_STEPS`):

| Step | Tool | Name |
|------|------|------|
| 1 | `bos_select_dna` | Select DNA |
| 2 | `bos_list_dna` | Confirm DNA rules |
| 3 | `bos_get_state` | Resolve state |
| 4 | `bos_create_mission` | Create mission |
| 5 | `bos_start_mission` | Start mission |
| 6 | `bos_run_audit` | Run audit |
| 7 | `bos_record_learning` | Record learning |

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
