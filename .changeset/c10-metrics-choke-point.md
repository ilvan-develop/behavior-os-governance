---
"@behavior-os/core": minor
"@behavior-os/mcp-server": patch
---

Governance metrics become real:

- The `MetricsEngine` is fed at the facade choke point
  (`evaluateGovernance`/`decide`/`recordLearning`), not at hosts, so every
  host counts identically.
- `GovernanceDecision` gains a structured `firedRules` field.
- `getTopRules()` is real by construction, `warned` means allow-with-warning
  (the engine never emits a warn verdict), and `resetMetrics()` on the
  facade replaced the MCP tool's registry cast.
