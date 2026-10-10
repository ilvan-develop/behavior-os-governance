---
name: behavioros
description: "BehaviorOS v2 debugging guide: Biome schema migration, quality gate metrics, stale JS cleanup, and pnpm workspace patterns."
version: 1.0.0
author: Hermes Agent
tags: [behavioros, debugging, biome, quality-gates, monorepo]
---

# BehaviorOS v2 Debugging Patterns

## Biome v2.5.15 Schema Changes

When updating Biome config, schema version 2.5.15 breaks compatibility with 2.0.0 format:

- `"organizeImports"` removed — use `javascript.formatter` rules instead
- `"linter.rules.recommended"` → `"linter.rules.preset"`
- `"semicolons": true` → `"semicolons": "always"`
- `"override.include"` → `"override.includes"`
- `"files.excludes"` is invalid — use `.gitignore` patterns or omit

**Reference:** See `docs/references/biome-migration-guide.md` for complete working config.

## Quality Gate Metrics Pitfalls

When configuring DNA quality gates, the `type` field must match the metric key passed to `evaluate()`:

| Wrong | Right |
|-------|-------|
| `type: "lint"` | `type: "lint_errors", operator: "lte"` |
| `type: "security"` | `type: "security_vulnerabilities", operator: "lte"` |

Using wrong type with default `gte` operator causes silent passes (e.g., `5 >= 0` passes when you want failure).

**Reference:** See `docs/references/quality-gate-metrics.md` for full operator guide.

## Stale JS Files in src/

Vitest may pick up stale `.js` files from `src/` directories instead of transpiling `.ts` files, causing:
- Methods appearing missing even though they exist in source
- Type exports not found
- Module resolution failures

**Fix:**
```bash
find packages -name "*.js" -path "*/src/*" -delete
rm -rf packages/*/dist  # if dist path is nested incorrectly
```

## BehaviorOS Engine Method Pattern

When adding new methods to `BehaviorOS`, ensure they delegate through the registry:

```typescript
completeMission(missionId: string): Mission | null {
  const missionEngine = this.registry.get<MissionEngine>("mission")!;
  return missionEngine.complete(missionId);
}
```

**Pitfall:** Engine must be initialized (e.g., via `createMission()` or `loadDNA()`) before calling methods that use it. The lifecycle test "should handle error cases gracefully" requires creating a mission first.

## pnpm Workspace Test Caching

When tests pass locally but fail in turbo, clear vitest cache:
```bash
pnpm test -- --clearCache  # or delete .vitest directory
```

## AuditEngine Default Stages

When calling `auditEngine.run()` without `stages`, it defaults to `["lint", "typecheck", "security", "coverage"]`. This is an `AuditStage[]` — ensure type compatibility.

## Build Output Path Verification

After TypeScript build, verify output location:
```bash
find packages/core/dist -name "*.js" | head -10
# Should show: dist/core/src/engine/*.js
# NOT: dist/engine/*.js (missing core/ nesting)
```

If paths are wrong, check `tsconfig.json` `baseUrl` and `outDir` settings.
