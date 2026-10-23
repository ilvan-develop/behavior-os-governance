---
"@behavior-os/core": minor
"@behavior-os/mcp-server": patch
"@behavior-os/opencode-plugin": minor
---

Learning records survive restarts without a tenth table:

- Learning records persist through the store meta key `learning-records`
  (same pattern as role-policy state), only on successful promotion; a
  corrupt snapshot fail-safes to in-memory.
- The OpenCode plugin joins the durable store via a shared
  `BEHAVIOROS_DB_PATH` (plugin-local storage stays UX state; the store is
  the cross-host source of truth).
- MCP `bos_record_learning` gains `learningId`/`stage`/`evidence`
  promotion parity with the plugin.
