# Behavior-OS Command Reference

Two surfaces expose the engine: the **MCP server** (`packages/mcp-server`, 27
tools + 2 resources) and the **OpenCode plugin** (`plugins/opencode-v2`, the same
27 tools plus `bos_get_log` and `bos_verify_audit_trail`). Names and arguments
below are the ones actually registered in `packages/mcp-server/src/server.ts`.

For the CLI (`behavioros init|compile|validate|status|diff|simulate|deploy|ecosystem|agent|autonomous|protocol|drift-check`)
see [`CLI.md`](./CLI.md).

## Governance

| Tool | Arguments |
|------|-----------|
| `bos_evaluate_governance` | `action`, `agent` (required); `scope?`, `context?` |
| `bos_select_dna` | `pattern` |
| `bos_list_dna` | — |
| `bos_preflight` | `action`, `agentId`; `context?` |
| `bos_check_quality` | `metrics` (number map) |
| `bos_decide` | `subject`, `votes`, `policy`; `quorum?`, `missionId?` |

## Missions & identity

| Tool | Arguments |
|------|-----------|
| `bos_create_mission` | `title`, `type`, `priority`; `description?`, `tags?` |
| `bos_start_mission` | `missionId` |
| `bos_list_missions` | `status?`, `type?`, `priority?`, `limit?` |
| `bos_set_agent` | `type`, `persona`; `id?`, `name?`, `capabilities?` |
| `bos_whoami` | — |

## Audit, state & reporting

| Tool | Arguments |
|------|-----------|
| `bos_run_audit` | `missionId`, `agentId`; `stages?` |
| `bos_get_state` | — |
| `bos_get_status` | — |
| `bos_list_audit_reports` | `limit?` (requires persistence) |
| `bos_list_pipeline_runs` | `limit?` (requires persistence) |
| `bos_list_decisions` | `limit?` (requires persistence) |

## Learning, evolution & recommendations

| Tool | Arguments |
|------|-----------|
| `bos_record_learning` | `type`, `source`, `content`, `impact`; `relatedMission?` |
| `bos_get_insights` | `limit?` |
| `bos_recommendations` | `limit?`, `ageLimitHours?` |
| `bos_evolution` | `minConfidence?`, `apply?`, `votes?`, `policy?` |
| `bos_drift` | `dnaA`, `dnaB` |

## Code fixes & governed editing

| Tool | Arguments |
|------|-----------|
| `bos_code_fixes` | `minConfidence?` |
| `bos_apply_code_fixes` | `minConfidence?`, `apply?`, `votes?`, `policy?` |
| `bos_list_code_fixes` | `limit?` |
| `bos_code_edit` | `file`, `find`, `replace`; `apply?`, `expectedBeforeHash?`, `missionId?`, `applyVotes?`, `policy?` |
| `bos_list_code_edits` | `limit?` |

## Plugin-only tools

| Tool | Arguments |
|------|-----------|
| `bos_get_log` | `limit?` |
| `bos_verify_audit_trail` | — |

## Notes

- `bos_run_audit` never attributes the audit to a model name: the identity is a
  registered agent, an explicitly set agent id, or the DNA persona
  (`persona:<role>`), otherwise `unassigned`.
- `bos_code_edit` is a dry-run unless code editing is enabled
  (`BEHAVIOROS_CODE_EDIT=true` in the MCP server, `BEHAVIOR_OS_CODE_EDIT=true` in
  the plugin) **and** `apply: true`.
- Tools documented as "requires persistence" return empty lists when no `Store`
  is attached (SQLite via `persistence.path`, or Postgres).

Verified inventory: [`CLAIMS.md`](./CLAIMS.md).
