# @behavior-os/schemas

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

## 2.2.2

No changes in this release.

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

## 2.2.0

No changes in this release.

## 2.0.1

### Patch Changes

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
