---
name: Verification First
description: Prove a change with real command output before claiming success. Use for every implementation, fix, audit, completion report or status update in this repository.
---

# Verification first

A claim is only as strong as the command output behind it. "Done", "passes",
"fixed" and "verified" are reserved for results you observed in this session.

## Workflow

1. State the acceptance criteria before running anything.
2. Choose the gate that can falsify the change.
3. Run the gate from the repository root and capture the real output.
4. Compare the result with the criteria, not with expectation.
5. Report the command, exit code and a short excerpt of the evidence.
6. If a gate was not run, say so explicitly. A skipped gate is not a pass.

## Gates

```bash
pnpm typecheck
pnpm lint:check
pnpm test
pnpm build
pnpm verify:governance
pnpm verify:plugin
pnpm smoke:mcp
pnpm verify:opencode
```

`pnpm verify:all` runs the complete ladder. A change is complete only when every
applicable gate exits 0.

## Evidence format

```text
Gate: pnpm test
Exit code: 0
Evidence: <files> files / <tests> tests passed
```

Use the real numbers from the output. Do not copy counts from documentation.

## Failure protocol

- Report the exact failing command and the relevant output.
- Stop. Do not weaken, skip, retarget or delete a gate to get a green result.
- Fix the cause and rerun the same gate.
- If the failure is unrelated to the change, say so and keep it visible.
- If a check is impossible in this environment, name the limitation instead of
  claiming success.

## Test quality

A behavior change needs a test that fails before the change and passes after
it. Assertions must check behavior or invariants, not restate a literal copied
from the implementation. Repository-level guards belong with the code they
protect.
