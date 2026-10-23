---
"@behavior-os/core": minor
"@behavior-os/mcp-server": patch
"@behavior-os/schemas": patch
---

Evolution loop closed end to end:

- `EvolutionProposalSchema` gains `condition`; the learning engine buckets
  events by `source: tool:<x>` so proposals only exist for a real host tool
  (`{type:'tool', value:<x>}` matches the real context bags). Proposals
  without a tool token are inert, and `applyEvolution` skips condition-less
  proposals as a second guard — no more dead-code rules.
- Hosts opt in via `BEHAVIOROS_EVOLUTION=true` (MCP + OpenCode plugin).
- e2e proof: propose → apply → `evaluateGovernance` warns when
  `context.tool` matches the evolved condition.
