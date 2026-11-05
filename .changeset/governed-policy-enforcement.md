---

"@behavior-os/schemas": minor
"@behavior-os/core": minor
"@behavior-os/mcp-server": minor
"@behavior-os/cli": minor
"@behavior-os/sdk": minor
---

feat(governance): enforce active policies and authenticate human approval

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
- Tests cover the full behavior: candidate and approved-but-inactive versions
  do not enforce, activation blocks a matching action, non-matching actions are
  untouched, deactivation removes the effect, and HMAC approval rejects missing
  or invalid tokens.
