# Behavior-OS Runtime State

This file is auto-generated and managed by Behavior-OS.
Do not edit manually — use the CLI or SDK to update.

## Protocol Steps

| Step | Name | Status |
|------|------|--------|
| 1 | Select DNA Pattern | ${STEP_1_STATUS} |
| 2 | Display DNA Block | ${STEP_2_STATUS} |
| 3 | Resolve Truth | ${STEP_3_STATUS} |
| 4 | Create Mission | ${STEP_4_STATUS} |
| 5 | Delegate | ${STEP_5_STATUS} |
| 6 | Run Audit | ${STEP_6_STATUS} |
| 7 | Record Learning | ${STEP_7_STATUS} |

## State Schema

```typescript
interface AgentState {
  currentStep: number;
  selectedDna: string | null;
  activeMission: string | null;
  stepHistory: Array<{
    step: number;
    tool: string;
    result: any;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

## Update via CLI

```bash
npx @behavior-os/cli status          # View current state
npx @behavior-os/cli protocol check  # Check compliance
```

## Update via SDK

```typescript
const bos = new BehaviorOS();
const state = bos.getState();
bos.updateState({ currentStep: 3, selectedDna: "surgical-team" });
```
