---
"@behavior-os/core": minor
"@behavior-os/mcp-server": patch
"@behavior-os/schemas": patch
---

Role/policy governance, now with a persistent and automatic surface:

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
  (57 total, protected by the `registers exactly 57 tools` test).
- `loadDNA` and `setActiveAgent` auto-register the active persona as an
  unprivileged role (no policies, no capabilities) so role attribution works
  out of the box for every DNA; an explicit registration always wins.
- Attribute-value hygiene from the pragmatic refactor: `resolvedBy` is
  persisted on pragmatic conversations and 13 `as any` casts were replaced by
  typed facade getters.
