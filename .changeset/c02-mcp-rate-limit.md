---
"@behavior-os/mcp-server": patch
---

Throttle all 30 MCP tools with a per-tool in-process token bucket at the
registration boundary. Defaults: 300 calls per tool per 60 s, configurable with
`BEHAVIOROS_MCP_RATE_LIMIT_MAX` and `BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS`;
`BEHAVIOROS_MCP_RATE_LIMIT_DISABLED=true` disables it. A throttled call performs
no engine work and returns `isError: true` with the retry delay.
