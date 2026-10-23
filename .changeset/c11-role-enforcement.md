---
"@behavior-os/opencode-plugin": minor
"@behavior-os/mcp-server": patch
---

Role policies are enforced, not just reported:

- The plugin permission hook consults the RolePolicyEngine after DNA, on
  mutating non-control-plane actions only: `block` → deny, `require`/
  `auto-fix` → ask, never downgrading a DNA verdict; benign allow decisions
  skip the store meta write on the hot path.
- The plugin exposes the 5 role tools for MCP parity (37 plugin tools,
  asserted by `scripts/verify-opencode.mjs`).
