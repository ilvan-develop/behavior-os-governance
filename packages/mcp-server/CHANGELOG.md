# @behavior-os/mcp-server

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

- fix: report the published version in `--version` and `serverInfo`
  
  Both entry points hardcoded `2.0.0`, so `behavioros --version` and the MCP
  `serverInfo.version` disagreed with the version actually installed from the
  registry (2.2.1). Both now read the version from their own `package.json`, and
  tests fail if a literal is reintroduced.
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

### Patch Changes

- 885f016: fix: unify MCP protocol advancement steps with plugin host
  
  The MCP server now advances `bos_list_dna` (step 2) and `bos_get_state` (step 3)
  protocol steps, matching the plugin host's behavior. Previously, MCP callers
  stalled at step 1 after `bos_select_dna` because only `bos_start_mission` advanced
  the protocol in MCP.
  
  Also completes the SDK lifecycle gap (added `completeMission`, `failMission`,
  `cancelMission`, `listMissions`, `requiredChecks`/`verificationMode` on
  `createMission`) and fixes the CLI `autonomous` command to close dry-run missions.
- Updated dependencies [885f016]
  - @behavior-os/core@2.2.0
  - @behavior-os/schemas@2.2.0

## 2.0.1

### Patch Changes

- c95526d: Throttle all 30 MCP tools with a per-tool in-process token bucket at the
  registration boundary. Defaults: 300 calls per tool per 60 s, configurable with
  `BEHAVIOROS_MCP_RATE_LIMIT_MAX` and `BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS`;
  `BEHAVIOROS_MCP_RATE_LIMIT_DISABLED=true` disables it. A throttled call performs
  no engine work and returns `isError: true` with the retry delay.
- 2fe6d18: Governance metrics become real:
  - The `MetricsEngine` is fed at the facade choke point
    (`evaluateGovernance`/`decide`/`recordLearning`), not at hosts, so every
    host counts identically.
  - `GovernanceDecision` gains a structured `firedRules` field.
  - `getTopRules()` is real by construction, `warned` means allow-with-warning
    (the engine never emits a warn verdict), and `resetMetrics()` on the
    facade replaced the MCP tool's registry cast.
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
- 2fe6d18: Evolution loop closed end to end:
  - `EvolutionProposalSchema` gains `condition`; the learning engine buckets
    events by `source: tool:<x>` so proposals only exist for a real host tool
    (`{type:'tool', value:<x>}` matches the real context bags). Proposals
    without a tool token are inert, and `applyEvolution` skips condition-less
    proposals as a second guard — no more dead-code rules.
  - Hosts opt in via `BEHAVIOROS_EVOLUTION=true` (MCP + OpenCode plugin).
  - e2e proof: propose → apply → `evaluateGovernance` warns when
    `context.tool` matches the evolved condition.
- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [2fe6d18]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [c95526d]
- Updated dependencies [2fe6d18]
  - @behavior-os/core@2.1.0
  - @behavior-os/schemas@2.0.1
