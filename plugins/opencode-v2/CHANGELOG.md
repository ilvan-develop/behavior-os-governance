# @behavior-os/opencode-plugin

## 2.1.0

### Minor Changes

- 2fe6d18: Role policies are enforced, not just reported:
  
  - The plugin permission hook consults the RolePolicyEngine after DNA, on
    mutating non-control-plane actions only: `block` → deny, `require`/
    `auto-fix` → ask, never downgrading a DNA verdict; benign allow decisions
    skip the store meta write on the hot path.
  - The plugin exposes the 5 role tools for MCP parity (37 plugin tools,
    asserted by `scripts/verify-opencode.mjs`).
- 2fe6d18: Learning records survive restarts without a tenth table:
  
  - Learning records persist through the store meta key `learning-records`
    (same pattern as role-policy state), only on successful promotion; a
    corrupt snapshot fail-safes to in-memory.
  - The OpenCode plugin joins the durable store via a shared
    `BEHAVIOROS_DB_PATH` (plugin-local storage stays UX state; the store is
    the cross-host source of truth).
  - MCP `bos_record_learning` gains `learningId`/`stage`/`evidence`
    promotion parity with the plugin.
- 2fe6d18: The facade absorbs duplicated host logic (audit repair #5):
  
  - `listMissions(limit, filters)` owns the filtered-then-limited semantics
    both `bos_list_missions` hosts used to copy by hand.
  - `loadDNAFromDirectory(dir)` routes every YAML pattern through the
    validating `DNALoader` and returns per-file errors — the plugin's
    unvalidated `dna as DNA` cast is gone.
  - `bootstrapDenyOverride(action, decision)` centralises the policy that a
    DNA deny never locks the control plane or read-only tools; the mutation
    vocabulary moved to core as `isMutatingAction`/`isControlPlaneAction`
    and the plugin keeps a one-line alias.
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

### Patch Changes

- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [2fe6d18]
  - @behavior-os/core@2.1.0
  - @behavior-os/schemas@2.0.1
