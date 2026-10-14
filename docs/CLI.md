# Behavior-OS CLI Reference

The CLI is `@behavior-os/cli` (binary `behavioros`). Every command below exists in
`packages/cli/src/cli.ts`; options are listed exactly as implemented.

```bash
npx @behavior-os/cli <command> [options]
# or, in this repo:
pnpm cli:init
```

## Commands

| Command | Purpose |
|---------|---------|
| `init` | Scaffold a project (dirs, `.behavioros/state.json`, `.mcp.json`, sample DNA) |
| `compile` | Parse and validate **every** `dnas/*.yaml` against the DNA schema |
| `validate` | Validate the project layout plus every DNA pattern |
| `status` | Engine status (DNA, governance level, missions, agents) + `.behavioros/state.json` |
| `diff` | Compare `dnas/*.yaml` against `.behavioros/baseline.json` |
| `simulate` | Evaluate one action against the loaded DNA rules |
| `deploy` | Print the deployment gate plan (does not run the gates) |
| `ecosystem` | Report what can be read from disk (DNA patterns, verdicts) |
| `agent` | Show the local `.behavioros/state.json` summary |
| `autonomous` | Dry-run the 7-step protocol on a task (no work executed) |
| `protocol` | Check the 7 steps against the local state file |
| `drift-check` | Compare `selectedDna`/`currentStep` with the baseline |

### init

```bash
npx @behavior-os/cli init [options]
```

- `-d, --directory <path>` — target directory (default `.`)
- `--dna <pattern>` — initial DNA pattern (default `enterprise-governance`)

Creates `dnas/`, `src/`, `tests/`, `.behavioros/`, writes
`.behavioros/state.json`, `.mcp.json` and a **minimal sample** pattern at
`dnas/<pattern>.yaml`. The sample is a scaffold, not the shipped pattern: copy the
real one from this repo's `dnas/` if you want the full rule set.

### compile

```bash
npx @behavior-os/cli compile [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Loads every `dnas/*.yaml` through `DNALoader` (the same Zod schema the engine
uses) and exits `1` if any pattern is invalid or `dnas/` is missing.

### validate

```bash
npx @behavior-os/cli validate [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Checks `.behavioros/state.json` (required), `.mcp.json` (optional, reported as
`○` when absent) and `dnas/`, then validates every pattern. Exits `1` on failure.

### status

```bash
npx @behavior-os/cli status [options]
```

- `-d, --directory <path>` — project directory (default `.`)
- `--dna <pattern>` — DNA pattern to load (default `enterprise-governance`)

Prints the engine status (`getStatus()`: DNA, governance level, mission/agent
counts) and the local state file. Throughput/health metrics are not simulated.

### diff

```bash
npx @behavior-os/cli diff [options]
```

- `-d, --directory <path>` — project directory (default `.`)

First run writes the current patterns to `.behavioros/baseline.json`; later runs
report patterns that are new or whose content changed.

### simulate

```bash
npx @behavior-os/cli simulate [options]
```

- `--action <action>` — action to evaluate (default `deploy`)
- `--agent <agent>` — agent id (default `test-agent`)
- `--dna <pattern>` — DNA pattern to load (default `enterprise-governance`)
- `-d, --directory <path>` — project directory (default `.`)

Without a loadable DNA there are no rules to evaluate, and the command says so.

### deploy

```bash
npx @behavior-os/cli deploy [options]
```

- `--mission-id <id>` — mission this deployment belongs to
- `--dna <pattern>` — DNA pattern to load (default `enterprise-governance`)
- `-d, --directory <path>` — project directory (default `.`)

Prints the gate plan (`governance` pre gate + one `quality:<id>` post gate per DNA
quality gate) and runs the **real** `governance` pre-flight for the `deploy`
action, exiting `1` when it is blocked. It does not run lint, typecheck, security
or coverage — run those yourself (`pnpm lint:check && pnpm typecheck && pnpm test`).

### ecosystem

```bash
npx @behavior-os/cli ecosystem [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Lists the DNA patterns actually present on disk and the four verdicts
(`allow | deny | escalate | transform`) from the schema.

### agent

```bash
npx @behavior-os/cli agent [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Shows the DNA pattern, active mission and step from `.behavioros/state.json`.
Agent registration lives in the SDK/engine (`registerAgent`), not in the CLI.

### autonomous

```bash
npx @behavior-os/cli autonomous [options]
```

- `-t, --task <task>` — task description (**required**)
- `--dna <pattern>` — DNA pattern to use (default `enterprise-governance`)
- `--priority <level>` — mission priority (default `medium`)
- `-d, --directory <path>` — project directory (default `.`)

Runs the protocol steps it can perform non-interactively (1, 4, 5, 6, 7), with a
**simulated** audit (`simulate: true`); steps 2–3 are interactive
(`bos_list_dna`/`bos_get_state`). It updates `.behavioros/state.json` when that
file exists. No work is executed on your behalf.

### protocol

```bash
npx @behavior-os/cli protocol [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Prints the 7 steps and whether each appears in the local state file. Live protocol
state lives in the host (the OpenCode plugin stores it via `ctx.storage`).

### drift-check

```bash
npx @behavior-os/cli drift-check [options]
```

- `-d, --directory <path>` — project directory (default `.`)

Compares `selectedDna` and `currentStep` in `.behavioros/state.json` against
`.behavioros/baseline.json` (created by `diff`). It is a subset of the
`DriftEngine` (rules/gates comparison) exposed by `bos_drift`.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | `dnas/` missing, invalid DNA, failed validation, blocked `deploy` pre-flight, or `autonomous` without `--task` |

## Environment variables

The CLI reads exactly one variable:

| Variable | Purpose |
|----------|---------|
| `BEHAVIOROS_DNA_PATH` | DNA file loaded before `dnas/<pattern>.yaml` (used by `status`, `deploy`, `simulate`, `autonomous`) |

There are no pre-flight/post-flight hooks (no pnpm version check, no automatic
audit-log or learning capture) — those are not implemented.
