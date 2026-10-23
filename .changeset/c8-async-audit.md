---
"@behavior-os/core": minor
"@behavior-os/sdk": minor
"@behavior-os/opencode-plugin": minor
"@behavior-os/cli": patch
"behavioros-orchestrator": patch
---

Transparent execution on Windows and an asynchronous audit engine:

- `AuditEngine.run/runReal/runStageReal` are now async so hosts can await them
  (MCP server, plugin, SDK, CLI and examples all updated). Callers that used
  the result synchronously must await — hence the minor bumps.
- Every process spawn in the governed paths sets `windowsHide: true` and uses
  `shell: true` with a single-string command (Node DEP0190-safe), so governed
  execution no longer flashes CMD windows; `pnpm` invocations get the shell
  treatment required by Windows `.cmd` shims.
- Audit stages run sequentially under contention (parallel tsc produced false
  failures), and the plugin tool handlers await their audit calls, too.
- New UX gate: `pnpm verify:windows` runs `scripts/win-window-probe.mjs`
  against the spawn topology that leaked windows before and fails (exit 1)
  when any new visible console window appears, reporting pid/name
  attribution. It is part of `verify:all` and documented in the AGENTS.md
  verification ladder.
- Examples are covered from the root ladder and `verify:opencode` batches
  `git check-ignore` into a single hidden spawn.
