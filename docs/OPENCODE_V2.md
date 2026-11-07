# OpenCode V2 control plane

This document describes how this repository uses OpenCode V2. The source of
truth for the platform is the official documentation at
`https://opencode.ai/v2/docs/`; this page only records the repository's
concrete wiring and the checks that keep it from drifting.

The wiring was validated against the installed OpenCode `v2.0.26` and the V2
documentation for config, instructions, permissions, agents, commands, skills,
plugins and MCP servers.

## Layers

| Layer           | Location                                    | What it controls                                       |
| --------------- | ------------------------------------------- | ------------------------------------------------------ |
| Permanent rules | `AGENTS.md`                                 | How agents think, review and verify in this repository |
| Project config  | `opencode.json`                             | Instructions, permissions, formatter, watcher          |
| Agents          | `.opencode/agents/<id>.md`                  | Research, planning, review and audit roles             |
| Commands        | `.opencode/commands/<id>.md`                | Repeatable `/govern`, `/verify`, `/audit` workflows    |
| Skills          | `.opencode/skills/<id>/SKILL.md`            | Procedures loaded only when the task matches           |
| Plugin          | `.opencode/plugins/behavioros.ts`           | Native Behavior-OS enforcement and 102 `bos_*` tools   |
| External MCP    | `packages/mcp-server` (+ local `.mcp.json`) | Integration for MCP clients outside OpenCode           |

`AGENTS.md` is discovered automatically. `docs/PROTOCOL.md`,
`docs/ARCHITECTURE.md` and this page are loaded through `instructions`.
Everything under `.opencode/agents/`, `.opencode/commands/` and
`.opencode/skills/` is committed so the control plane is shared, not a local
artefact. `.mcp.json` is the opposite: it is generated locally by
`behavioros init`, contains no secrets, and stays git-ignored.

## Configuration

`opencode.json` is intentionally small. It contains only the fields V2 reads at
the project level:

- `instructions`: the protocol, architecture and this document.
- `permissions`: ordered rules; the **last matching rule wins**.
- `formatter: true`: uses the installed Biome configuration.
- `watcher.ignore`: build output, coverage, dependencies and generated API docs.

The permission order is deliberate:

1. A broad `shell` rule asks before commands.
2. Read-only Git inspection and the verification ladder are allowed.
3. Release actions and destructive commands are denied after the allows.
4. `.env` and `.env.*` reads and edits are denied; `.env.example` is allowed.
5. Web and external-directory access asks.

A `deny` reflects a repository policy, not a sandbox guarantee: the shell runs
with the host user's authority, so the allowlist stays narrow instead of trying
to recognize every dangerous command.

## Agents

| Agent        | Mode       | Use it for                                            | Restrictions                      |
| ------------ | ---------- | ----------------------------------------------------- | --------------------------------- |
| `researcher` | `subagent` | Official documentation and source evidence            | Cannot edit or run shell          |
| `planner`    | `primary`  | Task decomposition, risks, gates, acceptance criteria | Cannot edit; Git inspection only  |
| `reviewer`   | `subagent` | Independent review of a diff                          | Cannot edit; Git inspection only  |
| `auditor`    | `subagent` | Mission audit and gate evidence                       | Cannot edit; read-only gates only |

The built-in `build`, `plan`, `general` and `explore` agents remain available.
Every custom agent uses V2's ordered `permissions` list and avoids the legacy V1
fields (`permission`, `tools`, `maxSteps`, `temperature`).

The split matters: the agent that wrote the change is not the agent that
audits it. `/review` and `/audit` launch their agent in a child session, so the
review cannot silently edit the code it is reviewing.

## Commands

| Command    | Agent              | Purpose                                                      |
| ---------- | ------------------ | ------------------------------------------------------------ |
| `/govern`  | current            | Run the 7-step Behavior-OS protocol before governed work     |
| `/verify`  | current            | Run the full verification ladder and report raw evidence     |
| `/audit`   | `auditor` (child)  | Run the mission audit and an independent completeness check  |
| `/mission` | current            | Create and start a mission without duplicating an active one |
| `/learn`   | current            | Record only verified outcomes and update claims if needed    |
| `/review`  | `reviewer` (child) | Read-only review of the current diff                         |

Commands use `$ARGUMENTS`; a command without arguments appends nothing and must
still behave safely. Markdown commands keep the prompt template in the body,
never in frontmatter.

## Skills

| Skill ID             | Trigger                                                        |
| -------------------- | -------------------------------------------------------------- |
| `behavior-os`        | Governance, DNA, missions, audits, production or risky actions |
| `verification-first` | Any implementation, fix, audit or completion report            |
| `engineering-cycle`  | Multi-step changes that must follow the repository workflow    |
| `docs-research`      | OpenCode V2 or Behavior-OS claims that need official evidence  |
| `release`            | Versioning, tagging, publishing or deployment preparation      |

Skills are advertised by their description and loaded only when relevant. The
directory name is the ID; keep it lowercase kebab-case and keep the frontmatter
`name` and `description` accurate.

## Plugin and MCP

The native integration is the plugin. `.opencode/plugins/behavioros.ts` is a
thin auto-discovered loader that re-exports
`plugins/opencode-v2/dist/index.js`. The plugin registers 102 `bos_*` tools and
the hooks that make governance visible:

- `permission.evaluate`: the only typed denial surface; applies DNA `deny` and
  `ask` decisions.
- `session.prompt`: classifies intent, switches the DNA to the task when no
  mission is live, releases a stale mission after its TTL, and creates one
  mission when the session needs one. Selection is task-scoped instead of
  permanent: a new task can move from Lean Factory to Surgical Team without a
  restart.
- `session.context`: when a DNA is selected, injects the current DNA, protocol
  step, active mission (or `none`) and identity; otherwise injects cold-start
  guidance.
- `agent.transform`: adds a short governed preamble to each agent prompt.
- `tool.execute.before`: advisory escalation logging in human-in-the-loop mode;
  in autonomous mode (`BEHAVIOROS_AUTONOMOUS=true`) it is a hard veto that
  applies the deny-list, per-session quota and doom-loop guard before the call.
  Both modes only run when a DNA is selected and the tool is governed.
- `tool.execute.after`: records failures in the learning engine.
- `tool.transform`: registers the 102 `bos_*` tools. Governance is applied per
  call, so the catalog stays stable instead of hiding tools by DNA.

`setup()` also detects a second Behavior-OS host. If the user-level or project
MCP config registers `behavioros` while the plugin is loaded, the plugin
disables that duplicate server through `ctx.mcp.transform` and logs an
`advisory/warn` decision, because two engines in two processes disagree about
the active DNA and the tool surface. Set
`BEHAVIOROS_ALLOW_DUPLICATE_HOST=true` only when the duplication is deliberate.

`opencode.json` deliberately does **not** register the Behavior-OS MCP server.
V2 would expose it as a second namespace and duplicate the same capability,
costing model context. The standalone `packages/mcp-server` remains the
integration for MCP clients outside OpenCode; when present, a local `.mcp.json`
configures it and is validated by the control-plane gate. Its shape is not
V2's `mcp.servers` shape.

## Exactly one host per project

OpenCode calls `setup()` once per loader. Two loaders therefore register the
same 102 `bos_*` tools twice and run two engines that disagree about the active
DNA. Keep **exactly one** Behavior-OS loader per machine/project:

- the project loader `.opencode/plugins/behavioros.ts`, or
- a user-level loader at `~/.config/opencode/plugins/behavioros.js`.

Never both. A leftover user-level loader that points at this repository is a
development artifact: disable or delete it before starting the host. The loader
must re-export the build with a relative path or a `file://` URL. A bare
Windows specifier such as `C:/www/behavior-os/plugins/opencode-v2/dist/index.js`
is rejected by the ESM loader with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, which
causes the whole plugin (and the server that loads it) to fail.

`pnpm verify:opencode` fails when it finds more than one loader or a bare
Windows specifier, so this cannot regress silently.

## Opt-in per project

A globally installed plugin must not govern every project on the machine. The
plugin therefore stays dormant unless the project opts in with a marker:

```json title=".behavioros/config.json"
{
  "governance": {
    "enabled": true
  }
}
```

Without the marker, `setup()` creates no engine, registers no `bos_*` tool and
installs no permission, tool, agent or session hook. It only registers the
`/bos-init` command. A `.behavioros/state.json` written by `behavioros init` is
accepted as a legacy marker, so CLI-scaffolded projects keep working.

`/bos-init` writes the marker, copies the DNA patterns from the plugin's
`dist/dnas` directory (or the repository `dnas/` during local development) and
reports the restart requirement. Existing DNA files are never overwritten.
The plugin reads the marker in `setup()`, so a new session or a server restart
is required before the tools and hooks appear; `ctx.command.reload()` does not
rerun `setup()`.

Two environment overrides cover exceptional cases:

- `BEHAVIOROS_DISABLED=true` keeps the plugin dormant even with the marker.
- `BEHAVIOROS_FORCE_ENABLED=true` activates governance without the marker.

`instructions` is not an opt-in mechanism: it only adds context files next to
`AGENTS.md`. Keep governance instructions project-scoped and let the marker
decide whether the plugin runs.

## Verification

The control plane has its own gate:

```bash
pnpm verify:opencode
```

It checks the config schema, instruction files, permission ordering, required
agents and their least-privilege rules, command templates and agent references,
skill discovery, the 102-tool plugin surface, the single loader and its ESM
specifier, the separation between the plugin and any local `.mcp.json`, and that
no control-plane file is git-ignored. It exits non-zero on the first failed
check.

The full definition of done is:

```bash
pnpm verify:all
```

That runs `typecheck`, `lint:check`, `test`, `build`, `verify:governance`,
`verify:plugin`, `smoke:mcp` and `verify:opencode`.

What the structural gate does **not** prove:

- That OpenCode resolved the same agent, command or skill at runtime. Use
  `opencode plugin list` and an interactive session for that.
- That a model followed a prompt. The guard checks wiring, not compliance.
- That every host action passes through `permission.evaluate`. That depends on
  the host and remains the known boundary of plugin enforcement.

## Maintenance

When adding a layer:

1. Add the file in the documented location and give it a clear description.
2. Keep permissions least-privilege and put broad rules before exceptions.
3. Add or update a test in `packages/core/tests/opencode-config.test.ts`.
4. Run `pnpm verify:opencode` and the full ladder.
5. Update this page and `docs/CLAIMS.md` only with measured facts.

Known V2 limitation: per-agent `request` headers and body overlays are
preserved by the session runner but are not yet sent with model requests.
Configure active request settings on the provider, model or variant instead.
