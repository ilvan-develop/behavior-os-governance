# Behavior-OS Changelog

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
