# Behavior-OS — Agent Instructions

This file is the permanent contract for every agent working in this repository.
It is loaded by OpenCode V2 together with `docs/PROTOCOL.md`,
`docs/ARCHITECTURE.md`, and `docs/OPENCODE_V2.md`.

## What this repository is

Behavior-OS is a behavioral governance framework for AI agent teams. A **DNA
pattern** (YAML in `dnas/`) defines personas, governance rules, quality gates,
and workflows. The engine evaluates those rules before an agent acts; the
OpenCode plugin and the MCP server expose the engine as tools.

Monorepo layout:

```text
packages/schemas/      Zod schemas for every domain type
packages/core/         11 engines + BehaviorOS facade + persistence
packages/sdk/          TypeScript SDK
packages/cli/          CLI (init, validate, status, simulate, deploy, ...)
packages/mcp-server/   MCP server: 30 tools + 2 resources (stdio)
packages/orchestrator/ Real task orchestration: shell adapter, retries, circuit breaker, persistent control loop (53 tests)
plugins/opencode-v2/   OpenCode V2 plugin: 32 bos_* tools + hooks
dnas/                  21 DNA pattern YAML files
docs/                  Documentation; docs/CLAIMS.md is the source of truth
.opencode/             Project skills, agents, commands, and the plugin loader
```

## Non-negotiable rules

1. **Evidence before claims.** Never write “done”, “passes”, “fixed”, or
   “verified” without the command output that proves it. If a command was not
   run, say so explicitly.
2. **Read before editing.** Read the file, its tests, and the relevant docs
   before changing behavior. Preserve unrelated code and settings.
3. **Do not invent APIs.** Tool names, config fields, CLI flags, environment
   variables, and OpenCode V2 fields must be confirmed against the source or
   the official V2 documentation at `https://opencode.ai/v2/docs/`.
4. **Small, controlled changes.** One concern per change. Do not mix refactors,
   formatting, and features in the same edit unless the task requires it.
5. **Tests are part of the change.** Every behavior change needs a test that
   fails before and passes after. Docs claims must match code; `docs/CLAIMS.md`
   and the docs-consistency test enforce that.
6. **Secrets are never read or committed.** `.env` and `.env.*` are denied by
   project permissions and `.gitignore`. Use `.env.example` for documented
   variables.
7. **Release actions are human gates.** Never `git push`, publish, tag, or
   deploy from an agent session. Prepare the change and report the exact
   command a human should run.
8. **Governance is mandatory.** Before mutating files or running risky
   commands, select a DNA pattern and follow the 7-step protocol in
   `docs/PROTOCOL.md`. If no DNA is active, the plugin auto-selects one from the
   prompt intent; confirm it with `bos_get_state` before proceeding.

## Verification ladder (definition of done)

Run these from the repository root. A task is complete only when every
applicable gate exits 0.

```bash
pnpm typecheck
pnpm lint:check
pnpm test
pnpm build
pnpm verify:governance
pnpm verify:plugin
pnpm smoke:mcp
pnpm verify:opencode
```

`pnpm verify:all` runs the whole ladder. If a gate fails, report the exact
failing output and stop; do not “fix” it by weakening the gate.

## OpenCode V2 layers

Use the right layer for the right concern:

| Layer | Location | Purpose |
| --- | --- | --- |
| Permanent rules | `AGENTS.md` | How agents think and verify in this repo |
| Project config | `opencode.json` | Instructions, permissions, formatter, watcher |
| Skills | `.opencode/skills/<id>/SKILL.md` | Procedures loaded only when relevant |
| Agents | `.opencode/agents/<id>.md` | Research, planning, implementation, audit roles |
| Commands | `.opencode/commands/<id>.md` | Repeatable `/govern`, `/verify`, `/audit` workflows |
| Plugin | `.opencode/plugins/behavioros.ts` | Native Behavior-OS enforcement and 32 tools |
| MCP | `packages/mcp-server` (+ local `.mcp.json`) | Integration for external MCP clients |

The native OpenCode integration is the plugin. Do **not** register the same
Behavior-OS MCP server in `opencode.json`; it would duplicate 30 tools under a
second name and waste context. See `docs/OPENCODE_V2.md`.

## Governance protocol

The plugin surfaces the current step in every session. The 7 steps are:

1. `bos_select_dna` — choose the pattern that matches the task.
2. `bos_list_dna` — confirm its rules, personas, and gates.
3. `bos_get_state` — read the current DNA, step, mission, and identity.
4. `bos_create_mission` — open a mission with a precise title, type, priority.
5. `bos_start_mission` — start it.
6. `bos_run_audit` — run the audit before declaring completion.
7. `bos_record_learning` — record the verified outcome.

A `deny` from a DNA rule is final. Do not retry the same action or try to
bypass the rule; report the rule and either reshape the action or ask the
operator to select a different DNA pattern.

## Change workflow

1. **Understand** the request and the acceptance criteria.
2. **Discover** the relevant files, tests, and docs.
3. **Ground** the change in source or official documentation.
4. **Plan** the smallest safe diff and the gates it must pass.
5. **Implement** and add or update tests.
6. **Validate** with the verification ladder.
7. **Audit** with an independent read-only reviewer when the change is risky.
8. **Learn** with `bos_record_learning` and update `docs/CLAIMS.md` if a public
   claim changed.

## Conventions

- TypeScript strict mode; no `any` in production code.
- Biome for lint and formatting (`pnpm lint` writes, `pnpm lint:check` gates).
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Node.js >= 22; the SQLite store uses the built-in `node:sqlite` module.
- Keep the MCP server stdio-only; it has no HTTP transport.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
