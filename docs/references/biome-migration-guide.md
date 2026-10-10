# Biome v2.5.15 Schema Migration Guide

When upgrading Biome from v2.0.x to v2.5.x, the configuration schema changed significantly. These are the key breaking changes and fixes.

## Schema Version Update

```diff
- "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
+ "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
```

## Removed Keys

| Old Key | Replacement |
|---------|-------------|
| `"organizeImports": {...}` | Removed — use imports grouping rules |
| `"files.excludes": [...]` | Invalid — Biome doesn't support file excludes in config |
| `"linter.rules.recommended": true` | Use `"preset": "recommended"` instead |

## Changed Keys

| Old Format | New Format |
|------------|------------|
| `"semicolons": true` | `"semicolons": "always"` |
| `"override.include": [...]` | `"override.includes": [...]` |
| Top-level `"files"` with `"excludes"` | Use `"ignoreUnknown": true` if needed |

## Complete Working Example (v2.5.15)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "json": {
    "formatter": {
      "trailingCommas": "none"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended",
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noConsole": "warn",
        "noExplicitAny": "error"
      },
      "style": {
        "useConst": "error",
        "noNonNullAssertion": "error"
      },
      "complexity": {
        "noExcessiveCognitiveComplexity": "error"
      }
    }
  },
  "overrides": [
    {
      "includes": ["**/tests/**", "**/*.test.ts"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsole": "off"
          }
        }
      }
    },
    {
      "includes": ["plugins/**/*.ts"],
      "linter": {
        "rules": {
          "suspicious": {
            "noExplicitAny": "off",
            "noConsole": "off"
          },
          "correctness": {
            "noUnusedVariables": "off",
            "noUnusedFunctionParameters": "off"
          }
        }
      }
    }
  ]
}
```

## Pitfall: Stale `.js` Files in Source Directories

When using TypeScript + Vitest, stale compiled `.js` files in `src/` directories can interfere with module resolution:

- Vitest may pick up `.js` files instead of transpiling `.ts` files
- This causes methods/exports to appear missing even though they exist in source
- **Fix**: Remove stale `.js` files from `src/` directories before running tests

```bash
# Clean stale JS files that might interfere
rm packages/*/src/**/*.js 2>/dev/null || true
rm packages/*/src/*.js 2>/dev/null || true
```

## Pitfall: Build Output Path Mismatch

TypeScript may output to `dist/package/src/` instead of `dist/` depending on `baseUrl` and `rootDir` settings:

- Check `tsconfig.json` — if `baseUrl` is set to `.` but root is project root, paths can be nested
- Always verify with `find dist -name "*.js"` what actually gets built
- If output is nested incorrectly, fix by adjusting `rootDir` or `outDir` in tsconfig
