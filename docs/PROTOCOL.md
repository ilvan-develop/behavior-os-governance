# Behavior-OS Protocol

## The 7 steps

| Step | Tool | What completes the step |
|------|------|-------------------------|
| 1 | `bos_select_dna` | selecting a DNA pattern |
| 2 | `bos_list_dna` | confirming the pattern and its rules |
| 3 | `bos_get_state` | reading the current protocol state |
| 4 | `bos_create_mission` | creating the mission |
| 5 | `bos_start_mission` | starting the mission |
| 6 | `bos_run_audit` | running the audit |
| 7 | `bos_record_learning` | recording the learning event |

The steps are declared once, as `PROTOCOL_STEPS` in
`packages/core/src/engine/behavior-os.ts`; the tool→step mapping
(`PROTOCOL_TOOL_STEPS`) and `PROTOCOL_STEP_COUNT = 7` are derived from it, and
the MCP resource `behavioros://protocol/steps` renders that same list. A step
advances **only** when the matching tool runs, never goes backwards, and every
step after `bos_select_dna` requires a DNA to be selected first — so browsing
tools cannot fake progress. The current step is surfaced by the plugin's
`session.context` hook.

## DNA patterns

The **21** patterns shipped in `dnas/*.yaml` are listed in
[`README.md`](../README.md#21-dna-patterns); [`CLAIMS.md`](./CLAIMS.md) has the
verified inventory. `bos_select_dna` accepts any shipped pattern name (or a path
to your own pattern). There is no separate "display DNA block" tool: see the
pattern with `bos_list_dna`.

## Editing files

There is **no** "delegate all file operations" rule. File changes are governed by
an optional, fail-closed path: `bos_code_edit` previews a single-text replacement
by default and only writes when code editing is enabled
(`BEHAVIOROS_CODE_EDIT=true` in the MCP server, `BEHAVIOR_OS_CODE_EDIT=true` in
the OpenCode plugin) **and** `apply: true`, optionally gated by votes. Every
evaluation — including refusals — is persisted with before/after SHA-256 hashes.
See [`CLAIMS.md`](./CLAIMS.md).

## Where the state lives

The protocol state belongs to the host, not to a magic file:

- **OpenCode plugin** — persisted through `ctx.storage` (key `behavioros:state`)
  and restored automatically at session start.
- **Engine with persistence** — `persistence.path` or an attached `Store`
  (SQLite/Postgres).
- **CLI** — `behavioros init` writes a local `.behavioros/state.json`, which
  `behavioros status|agent|protocol|drift-check` read.

## Rules

1. Read the state first (`bos_get_state`); the plugin also restores persisted
   state automatically.
2. Select a DNA pattern before any governed action. Without one the pipeline
   reports `skipped` for its gates — a DNA is what makes governance real.
3. Run the audit (`bos_run_audit`) before declaring work complete.
4. Record a learning (`bos_record_learning`) at the end of a mission.
