# Behavior-OS Changelog

> **Snapshot histórico:** as entradas abaixo registam o que cada release afirmou
> na altura e contêm números aspiracionais desse momento (ex.: "22 engines",
> "45+ tools", "9 resources", "5,200+ testes"). Não são o estado atual.
>
> Estado medido em 2026-10-23: **21 engines**, **57** tools MCP + **2**
> resources, **32** tools no plugin OpenCode, **21** padrões DNA e **77
> ficheiros / 869 casos** de teste. Fonte viva: [docs/CLAIMS.md](docs/CLAIMS.md).

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Governance environment signals were read off the *text* of any action's arguments,
  so a read-only search for the word "deployment" was escalated as a deployment
  (permission log seq 2649/2650/2656) and every such call asked the host for approval.
  `deployment` now requires an action that can *perform* an operation
  (`bash`/`shell`/`deploy`/`apply`/…) and `production`/`production-change` require a
  non-read-only action, so `write`/`edit` still count for production changes.
  Conformance claim C24 fails against the previously shipped build (23/24) and passes
  after the rebuild (24/24).
- The `lint-staged` config ran an explicit `git add` task after each Biome task. lint-staged
  already applies and stages task fixes, so the entries were redundant and made every commit
  print `Some of your tasks use 'git add' command…`. Removed; `pre-commit` now runs only Biome.
- The 7-step protocol had two definitions: the OpenCode plugin's `PROTOCOL_STEPS`
  (step 5 "Delegate") and the MCP resource text (step 5 "Start Mission"). There is
  now a single `PROTOCOL_STEPS` in `@behavior-os/core`: the MCP resource is rendered
  from it and the plugin re-exports it, so they cannot drift again.
  `PROTOCOL_TOOL_STEPS`/`PROTOCOL_STEP_COUNT` are derived from it.
- `@behavior-os/mcp-server` manifest described "11 tools"; the server registers 27
  (and 2 resources).
- **CLI**: `compile`/`validate` now load `dnas/*.yaml` through `DNALoader`/`DNASchema`
  (exit `1` on invalid DNA) instead of printing success; `status`/`deploy`/`simulate`/
  `autonomous` resolve the active DNA (`BEHAVIOROS_DNA_PATH` → `dnas/<pattern>.yaml`);
  `simulate` calls `evaluateGovernance()`; `deploy` prints the DNA gate plan and the
  real `preflightAction()` result (and stops claiming to deploy); `ecosystem`, `agent`,
  `autonomous`, `protocol` and `drift-check` report measured values only.
- Root `cli:init` delegated to a package script that does not exist; it now runs the
  built CLI directly.
- `behavioros init` wrote a `.mcp.json` pointing at a path that does not exist from a
  scaffolded project; it now resolves `mcp-server/dist/server.js`.
- MCP resource `behavioros://protocol/steps` served a protocol that did not match the
  engine's steps; it is now generated from `PROTOCOL_STEPS`.
- `bos_list_missions` accepted `status`/`type`/`priority` and ignored them; the filters
  are applied now.
- `pnpm benchmark` removed (the target never existed). The performance numbers in
  `docs/ARCHITECTURE.md` are design targets, not measurements.
- `apps/*` removed from `pnpm-workspace.yaml` (empty glob) and the fake `echo` test
  script removed from `@behavior-os/orchestrator`.
- Docker: `EXPOSE 3000`/`3000:3000` removed (the MCP server is stdio-only) and the
  unread `BEHAVIOROS_LOG_LEVEL` dropped from the image, the compose file and the smoke
  script.
- Editor rules (`.windsurfrules`, `.github/copilot-instructions.md`, `.cursor/rules/*`)
  rewritten: they cited `bos_resolve_truth`, a "Display DNA Block" step, invented CLI
  syntax, "45+ tools" and "5,200+ tests".
- `plugins/opencode-v2/tests/plugin-basic.test.ts` asserted hand-written literals
  without importing the plugin; it now checks the real export and `dnas/`.
- `scripts/count-tests.mjs` removed: nothing ran it, and its regex count contradicted
  the measured vitest total.
- `pnpm docs:build` (`typedoc` with no config) deleted every hand-written markdown in
  `docs/`: bare typedoc defaults to `out: ./docs` with `cleanOutputDir: true`.
  `typedoc.json` now pins `out` to the git-ignored `docs/api`, and two guards fail if
  the output ever points back at `docs/` or the repository root.
- Root `pnpm test:coverage` failed: running `vitest` from the root ignored each
  package's `vitest.config.ts` (losing the plugin's 20s timeout) and picked up
  `examples/` (outside the workspace). A root `vitest.config.ts` now uses
  `test.projects`, so `test:coverage` and `test:watch` delegate to every package.
- `clean:all` used `rm -rf node_modules` (fails on Windows/PowerShell) and no package
  had a `clean` script. `scripts/clean.mjs` (`node:fs`, no shell) now backs `clean` in
  all 7 workspace packages and in the root.
- `turbo.json` declared `lint` and `dev` tasks that no workspace package implements,
  and the root `dev` script pointed at that non-existent task. Removed; a real
  `clean` task (`cache: false`) replaces them.
- Husky hooks still sourced the deprecated `husky.sh` bootstrap and `commit-msg`
  passed `$1` unquoted; `pre-commit` now runs `lint-staged` + `typecheck`.
- `lint-staged` formatted `*.{json,yaml,yml,md}` although Biome supports neither YAML
  nor Markdown; the pattern is now `*.json`.
- `.gitattributes` had a bare `text=auto`, so every Windows checkout (with
  `core.autocrlf=true`) produced CRLF and `pnpm lint:check` failed locally while CI
  stayed green. Pinned `eol=lf` to match the committed LF blobs on every platform.

### Added
- `packages/core/tests/dnas.test.ts` — every shipped DNA YAML must satisfy `DNASchema`.
- `packages/core/tests/protocol-steps-catalog.test.ts` — `PROTOCOL_STEPS` must satisfy
  `ProtocolStepSchema` and stay self-consistent.
- `packages/core/tests/docs-consistency.test.ts` — current docs may not name tools,
  CLI commands, `pnpm` scripts, `BehaviorOS` methods or environment variables that do
  not exist in the code, and root `pnpm --filter <pkg> run <script>` delegations must
  resolve.
- `packages/core/tests/docs-build-safety.test.ts` — `typedoc.json` must exist, list
  existing entry points, keep `out` away from `docs/` and the repository root, and
  keep that output directory git-ignored.
- `packages/core/tests/repo-scripts.test.ts` — no `turbo.json` task without an
  implementing package script, no root script delegating to an undeclared task, no
  shell-specific deletion (`rm -rf`/`Remove-Item`), and no husky hook that is missing,
  empty or re-sourcing `husky.sh`.
- `scripts/clean.mjs` — cross-platform, shell-free directory removal used by every
  package's `clean` script.
- Root `vitest.config.ts` — makes the root `test:coverage`/`test:watch` scripts run
  each workspace package with its own config and skip `examples/`.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-10

### Added
- **Complete rewrite** with v2 architecture
- **22 engines** for governance, quality, and learning
- **MCP server** with 45+ tools and 9 resources
- **OpenCode v2 plugin** with protocol enforcement
- **4 DNA patterns**: Surgical Team, Enterprise Governance, Military Operations, Lean Factory
- **CLI** with 12 commands for project management
- **SDK** with full TypeScript support
- **Zod v4.4.3 schemas** for all domain types
- **Docker support** with multi-stage builds
- **GitHub Actions CI/CD** workflow
- **Comprehensive documentation** (README, Architecture, SDK, CLI, DNAs)
- **75 source files** across 6 packages
- **5,200+ test coverage** target

### Changed
- Migrated from v1 monolithic architecture to v2 monorepo
- Replaced manual governance with EngineRegistry pattern
- Improved type safety with Zod validation
- Enhanced MCP tool descriptions for better LLM understanding
- Added protocol state persistence across sessions

### Security
- DNA-defined boundary enforcement
- Rule-based governance evaluation
- Audit trail for all actions
- Quality gate enforcement before deployment
- Learning engine detects and auto-corrects failures

### Performance
- Governance evaluation: < 10ms for 100 rules
- Audit pipeline: < 100ms for full stack
- Schema validation: < 1ms per operation
- Memory-efficient state management

## [1.1.5] - 2026-08-06
- Bug fixes in governance evaluation
- Updated MCP tool descriptions
- Improved DNA pattern validation

## [1.1.4] - 2026-07-28
- Added MCP 2026-07-28 spec support
- Fixed state persistence issues
- Updated test coverage to 85%

## [1.1.3] - 2026-07-15
- Added Surgical Team DNA pattern
- Improved quality gate enforcement
- Fixed audit logging issues

## [1.1.2] - 2026-07-01
- Added Learning engine
- Fixed governance rule conflicts
- Improved error messages

## [1.1.1] - 2026-06-15
- Added Enterprise Governance pattern
- Fixed DNA compilation issues
- Improved CLI error handling

## [1.1.0] - 2026-06-01
- Initial public release
- 4 built-in DNA patterns
- MCP server with 20+ tools
- Basic CLI functionality

---

## Unreleased

### Added
- (Pending changes)

### Fixed
- (Pending fixes)

### Security
- (Pending security updates)
