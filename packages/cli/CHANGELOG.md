# @behavior-os/cli

## 2.0.1

### Patch Changes

- c95526d: `behavioros agent` now reads the SQLite agent registry (`--db`,
  `<dir>/behavioros.db` or `<dir>/.behavioros/behavioros.db`) and lists every
  registered agent; a missing registry is reported as empty, while an unreadable
  one exits 1. `SqliteStore` now closes its connection when `PRAGMA`/migration
  fails, so a corrupt database no longer leaks an open handle (notably on
  Windows).
- c95526d: Fix `behavioros drift-check`: compare every `dnas/*.yaml` snapshot against the
  `diff` baseline with `DriftEngine` (governance rules and quality gates added,
  removed or changed, plus patterns added or removed), keep the legacy
  `selectedDna`/`currentStep` state baseline working, and exit 1 when drift is
  detected.
- c95526d: Transparent execution on Windows and an asynchronous audit engine:
  
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
- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [2fe6d18]
  - @behavior-os/core@2.1.0
  - @behavior-os/schemas@2.0.1
