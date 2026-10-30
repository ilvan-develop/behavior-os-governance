---

'@behavior-os/core': patch
'@behavior-os/mcp-server': patch
'@behavior-os/sdk': minor
'@behavior-os/cli': patch
---

fix: unify MCP protocol advancement steps with plugin host

The MCP server now advances `bos_list_dna` (step 2) and `bos_get_state` (step 3)
protocol steps, matching the plugin host's behavior. Previously, MCP callers
stalled at step 1 after `bos_select_dna` because only `bos_start_mission` advanced
the protocol in MCP.

Also completes the SDK lifecycle gap (added `completeMission`, `failMission`,
`cancelMission`, `listMissions`, `requiredChecks`/`verificationMode` on
`createMission`) and fixes the CLI `autonomous` command to close dry-run missions.
