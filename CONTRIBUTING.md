# Contributing to Behavior-OS

## Getting Started

```bash
# Clone the repository
git clone https://github.com/ilvan-develop/behavior-os-governance.git
cd behavior-os-governance

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run type check
pnpm typecheck
```

## Project Structure

```
behavior-os-governance/
├── packages/
│   ├── schemas/     # Zod validation schemas
│   ├── core/        # 47 engines + BehaviorOS facade + persistence (SQLite/Postgres)
│   ├── sdk/         # High-level TypeScript SDK
│   ├── cli/         # CLI tools (13 commands)
│   ├── mcp-server/  # MCP server implementation (85 tools + 2 resources)
│   └── orchestrator/# Real task orchestration (shell adapter, retries, circuit breaker, persistent control loop; 68 tests)
├── plugins/
│   └── opencode-v2/ # OpenCode v2 plugin (70 tools; loaded from the workspace, not published to npm)
├── dnas/            # 21 DNA pattern YAML files
├── docs/            # Documentation (CLAIMS.md is the source of truth)
├── examples/        # Usage examples (a pnpm workspace member — `pnpm test` runs its 4 cases)
└── .behavioros/     # CLI docs + `state.example.json` (state.json/baseline.json are runtime)
```

There is no `packages/e2e-tests/` package: end-to-end coverage lives inside the
per-package vitest suites.

## Adding a New DNA Pattern

1. Create YAML file in `dnas/<pattern-name>.yaml`
2. Validate it against `DNASchema` (`packages/schemas/src/index.ts`); the
   `packages/core/tests/dnas.test.ts` suite fails if any shipped pattern
   does not parse
3. Update the pattern counts that mention 21 (README, `docs/CLAIMS.md`, …)

## Adding a New MCP Tool

1. Register the tool in `packages/mcp-server/src/server.ts` (`server.registerTool`)
2. Add its Zod `inputSchema` in the same call
3. Update the tool-count assertions in `packages/mcp-server/tests/mcp.test.ts`

## Adding a New Engine

1. Create engine in `packages/core/src/engine/<engine-name>.ts`
2. Export from `packages/core/src/engine/index.ts`
3. Integrate into `BehaviorOS` class
4. Write comprehensive tests in `packages/core/tests/*.test.ts`

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add surgical team DNA pattern
fix: resolve governance evaluation bug
docs: update architecture documentation
test: add coverage for learning engine
chore: update dependencies
```

## Testing Requirements

- All new code must have unit tests
- Target coverage: > 80%
- Run `pnpm test:coverage` before submitting PR

## Code Style

- TypeScript strict mode enabled
- Biome for linting and formatting
- No `any` types in production code
- Comprehensive JSDoc comments

## Pull Request Process

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Run `pnpm test`, `pnpm typecheck` and `pnpm verify:publish`
5. Submit pull request

## Releasing

Publishing is a human action, and the only supported path is the `Release`
workflow (`.github/workflows/release.yml`) because it publishes through
`pnpm changeset publish`. `npm publish` packs the workspace manifests verbatim,
so the tarball keeps `workspace:*` ranges and consumers get
`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`.

1. Add a changeset: `pnpm changeset`
2. Run the ladder locally: `pnpm build && pnpm verify:publish`
3. Land the changeset on `main`; the release workflow versions, commits and
   publishes the packages that are not on the registry yet
4. A maintainer can re-run it with `workflow_dispatch` (it is idempotent)

`pnpm verify:publish` packs every publishable package, rejects `workspace:`
ranges and checks that each declared `bin`/`main`/`types` target is inside the
tarball — the exact checks whose absence shipped an uninstallable 2.2.0.

## Reporting Issues

Use GitHub Issues for:
- Bug reports
- Feature requests
- Documentation improvements

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS)
