# @behavior-os/sdk

## 2.3.0

### Minor Changes

- e73676d: feat(governance): enforce active policies and authenticate human approval
  
  Close the two operational gaps in governed policy versioning:
  
  - Policy versions may carry machine-readable enforcement
    (`block`/`escalate`/`require`/`warn`, a match string and a severity).
    `BehaviorOS.evaluateGovernance()` consults the human-activated policy set
    after DNA rules, so activation changes real verdicts for matching actions.
    Policy rule ids appear in `rulesEvaluated`/`firedRules` and in governance
    metrics; a policy `deny` is not softened by the lenient governance level.
  - `evaluateGovernance` results and `getStatus().policies` expose the active
    ruleset (`{active, ids, enforced}`) to plugin, MCP, CLI and SDK hosts.
  - When `BEHAVIOR_OS_APPROVAL_KEY` is set, `approvePolicyVersion` requires an
    HMAC-SHA256 token over the exact version, content hash and rationale,
    compared in constant time. The approval record stores
    `verification: 'hmac' | 'actor-kind'` so the weaker local-development basis
    stays visible. `scripts/policy-approval-token.mjs` issues the token.
  - `bos_policy` exposes the lifecycle in the MCP server (87 tools) and the
    OpenCode plugin (72 tools): list, status, events, create, validate, approve,
    activate, deactivate, rollback and monitor. Mutating calls persist through the
    host's lifecycle path; a refused transition is reported as an error rather
    than a success.
  - Tests cover the full behavior: candidate and approved-but-inactive versions
    do not enforce, activation blocks a matching action, non-matching actions are
    untouched, deactivation removes the effect, and HMAC approval rejects missing
    or invalid tokens.
- e73676d: feat(responsible-ai): fairness metrics, data provenance and human oversight
  
  Adds a deterministic Responsible-AI layer that measures outcomes instead of
  declaring a gate:
  
  - `FairnessEngine` computes demographic parity difference, disparate impact
    ratio and equal opportunity difference from per-group counts, with
    configurable thresholds.
  - Data provenance (datasetId, source, ISO-8601 collectedAt, consentBasis,
    transformations, lineage) is validated separately from evidence provenance.
  - Human oversight is a first-class gate: when required, approval plus a
    non-empty `reviewerId` are mandatory.
  - Verdicts: `pass` / `warn` / `block` / `insufficient_data`. Missing ground
    truth yields an explicit "not computed" reason, never an invented metric.
  - Exposed through `BehaviorOS.evaluateFairness()`, `bos_evaluate_fairness`
    (MCP and OpenCode plugin), and the `fairness-gate` rule in the
    `ai-ml-pipeline` DNA.
  
  Toolchain and docs:
  
  - `vitest.config.ts` now resolves explicit project configs, so the root
    `vitest` run no longer aborts on stray files under `packages/`.
  - Documentation counts are guarded against drift: MCP tool list, plugin-only
    tools and Zod schema counts are checked against source.
  - Synchronised counts: 87 MCP tools, 72 plugin tools, 48 engines,
    87 `z.object` / 60 `z.enum`.

### Patch Changes

- Updated dependencies [e73676d]
- Updated dependencies [e73676d]
  - @behavior-os/schemas@2.3.0
  - @behavior-os/core@2.3.0

## 2.2.2

### Patch Changes

- @behavior-os/core@2.2.2
  - @behavior-os/schemas@2.2.2

## 2.2.1

### Patch Changes

- fix(publish): ship installable manifests
  
  The 2.2.0 tarballs were produced with `npm publish` from the workspace, so the
  published manifests still contained `workspace:*` dependency ranges and npm
  rejects the install with `EUNSUPPORTEDPROTOCOL: Unsupported URL Type
  "workspace:"`. Republishing through `pnpm changeset publish` rewrites those
  ranges to the real version.
  
  `pnpm verify:publish` now packs every publishable package and fails when a
  packed manifest still carries a `workspace:` range or declares a `bin`/`main`
  target that is missing from the tarball. The release and tag workflows run it
  before publishing, and it is part of `pnpm verify:all`.
- Updated dependencies
  - @behavior-os/schemas@2.2.1
  - @behavior-os/core@2.2.1

## 2.2.0

### Minor Changes

- 885f016: fix: unify MCP protocol advancement steps with plugin host
  
  The MCP server now advances `bos_list_dna` (step 2) and `bos_get_state` (step 3)
  protocol steps, matching the plugin host's behavior. Previously, MCP callers
  stalled at step 1 after `bos_select_dna` because only `bos_start_mission` advanced
  the protocol in MCP.
  
  Also completes the SDK lifecycle gap (added `completeMission`, `failMission`,
  `cancelMission`, `listMissions`, `requiredChecks`/`verificationMode` on
  `createMission`) and fixes the CLI `autonomous` command to close dry-run missions.

### Patch Changes

- Updated dependencies [885f016]
  - @behavior-os/core@2.2.0
  - @behavior-os/schemas@2.2.0

## 2.1.0

### Minor Changes

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
