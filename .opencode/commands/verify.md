---
description: Run the repository verification ladder and report exact evidence
---

Verify the current change. Run the gates from the repository root, in this
order:

1. `pnpm typecheck`
2. `pnpm lint:check`
3. `pnpm test`
4. `pnpm build`
5. `pnpm verify:governance`
6. `pnpm verify:plugin`
7. `pnpm smoke:mcp`
8. `pnpm verify:opencode`

For every gate, record the exact command, the exit code and a one-line summary
of the real output. Stop at the first failure and report the failing output.
Never weaken, skip or edit a gate to make it pass.

Only after every gate above passed individually, run:

```bash
pnpm verify:all
```

If a command was not run, say so explicitly. A missing result is not a pass.
