# @behavior-os/core

## 2.1.0

### Minor Changes

- 2fe6d18: Governance metrics become real:
  - The `MetricsEngine` is fed at the facade choke point
    (`evaluateGovernance`/`decide`/`recordLearning`), not at hosts, so every
    host counts identically.
  - `GovernanceDecision` gains a structured `firedRules` field.
  - `getTopRules()` is real by construction, `warned` means allow-with-warning
    (the engine never emits a warn verdict), and `resetMetrics()` on the
    facade replaced the MCP tool's registry cast.
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
- c95526d: Role/policy governance, now with a persistent and automatic surface:
  - New `RolePolicyEngine` (21st engine): deterministic per-role decisions
    (actor resolved by role → persona → agentId, condition prefix/wildcard
    matching, `effectiveUntil` window, strictest-match-wins, fail-safe
    `require` escalation for unknown roles, bounded 200-entry audit trail).
  - Facade mutations (`registerRole`, `defineRolePolicy`, `evaluateRoleAction`)
    persist the engine snapshot through the store's meta so roles, policies and
    audit decisions survive restarts; a corrupt or missing snapshot never
    blocks startup.
  - 5 new MCP tools: `bos_register_role`, `bos_define_policy`,
    `bos_evaluate_role_action`, `bos_role_policy_report`, `bos_list_roles`
    (67 total, protected by the `registers exactly 67 tools` test).
  - `loadDNA` and `setActiveAgent` auto-register the active persona as an
    unprivileged role (no policies, no capabilities) so role attribution works
    out of the box for every DNA; an explicit registration always wins.
  - Attribute-value hygiene from the pragmatic refactor: `resolvedBy` is
    persisted on pragmatic conversations and 13 `as any` casts were replaced by
    typed facade getters.
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
- 2fe6d18: Evolution loop closed end to end:
  - `EvolutionProposalSchema` gains `condition`; the learning engine buckets
    events by `source: tool:<x>` so proposals only exist for a real host tool
    (`{type:'tool', value:<x>}` matches the real context bags). Proposals
    without a tool token are inert, and `applyEvolution` skips condition-less
    proposals as a second guard — no more dead-code rules.
  - Hosts opt in via `BEHAVIOROS_EVOLUTION=true` (MCP + OpenCode plugin).
  - e2e proof: propose → apply → `evaluateGovernance` warns when
    `context.tool` matches the evolved condition.

### Patch Changes

- c95526d: `behavioros agent` now reads the SQLite agent registry (`--db`,
  `<dir>/behavioros.db` or `<dir>/.behavioros/behavioros.db`) and lists every
  registered agent; a missing registry is reported as empty, while an unreadable
  one exits 1. `SqliteStore` now closes its connection when `PRAGMA`/migration
  fails, so a corrupt database no longer leaks an open handle (notably on
  Windows).
- Updated dependencies [c95526d]
- Updated dependencies [2fe6d18]
  - @behavior-os/schemas@2.0.1
