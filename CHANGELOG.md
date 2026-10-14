# Behavior-OS Changelog

> **Nota de verificação:** as entradas abaixo foram escritas antes da auditoria de
> afirmações e continham números aspiracionais (ex.: "22 engines", "45+ tools",
> "9 resources", "5,200+ testes"). Os valores medidos são: **11 engines**,
> **27** tools MCP + **2** resources, **29** tools no plugin OpenCode, **21**
> padrões DNA e **51 ficheiros / 521 casos** de teste. Fonte de verdade:
> [docs/CLAIMS.md](docs/CLAIMS.md).

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
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

### Added
- `packages/core/tests/dnas.test.ts` — every shipped DNA YAML must satisfy `DNASchema`.
- `packages/core/tests/protocol-steps-catalog.test.ts` — `PROTOCOL_STEPS` must satisfy
  `ProtocolStepSchema` and stay self-consistent.
- `packages/core/tests/docs-consistency.test.ts` — current docs may not name tools,
  CLI commands, `pnpm` scripts, `BehaviorOS` methods or environment variables that do
  not exist in the code, and root `pnpm --filter <pkg> run <script>` delegations must
  resolve.

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
