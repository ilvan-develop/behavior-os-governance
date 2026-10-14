# Contributing to Behavior-OS

## Getting Started

```bash
# Clone the repository
git clone https://github.com/ilvan-develop/behavioros.git
cd behavioros

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
behavioros/
├── packages/
│   ├── schemas/     # Zod validation schemas
│   ├── core/        # 11 engines + BehaviorOS class
│   ├── sdk/         # High-level TypeScript SDK
│   ├── cli/         # CLI tools
│   ├── mcp-server/  # MCP server implementation
│   └── e2e-tests/   # End-to-end tests
├── plugins/
│   └── opencode-v2/ # OpenCode v2 plugin
├── dnas/            # DNA pattern YAML files
├── docs/            # Documentation
├── templates/       # Project templates
└── .behavioros/     # Runtime state (gitignored)
```

## Adding a New DNA Pattern

1. Create YAML file in `dnas/<pattern-name>.yaml`
2. Add schema validation in `packages/schemas/src/index.ts`
3. Register in `packages/dnas/src/index.ts`
4. Write tests in `packages/core/tests/dna/<pattern-name>.test.ts`

## Adding a New MCP Tool

1. Create tool definition in `packages/mcp-server/src/tools/<category>/`
2. Register tool in `packages/mcp-server/src/server.ts`
3. Add schema in `packages/schemas/src/mcp.ts`
4. Write integration tests

## Adding a New Engine

1. Create engine in `packages/core/src/engine/<engine-name>.ts`
2. Export from `packages/core/src/engine/index.ts`
3. Integrate into `BehaviorOS` class
4. Write comprehensive tests

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
4. Run `pnpm test` and `pnpm typecheck`
5. Submit pull request

## Reporting Issues

Use GitHub Issues for:
- Bug reports
- Feature requests
- Documentation improvements

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS)
