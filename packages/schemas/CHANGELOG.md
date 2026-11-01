# @behavior-os/schemas

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
