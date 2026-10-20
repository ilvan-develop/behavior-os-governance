---
name: Docs Research
description: Ground OpenCode V2 and Behavior-OS claims in official documentation and repository source. Use when a decision depends on a config field, tool name, hook, CLI flag, environment variable or platform behavior.
---

# Docs research

The repository has a hard rule: do not invent APIs. Research produces an
evidence sheet that another agent can act on without re-reading everything.

## Source hierarchy

1. Repository source, tests and `docs/CLAIMS.md`.
2. Official OpenCode V2 documentation at `https://opencode.ai/v2/docs/`.
3. The published configuration schema at `https://opencode.ai/config.json`.
4. Only then, general references, clearly marked as secondary.

V1 documentation, blog posts and model memory are not sources of truth for V2.

## Method

1. Restate the question and the decision it must unblock.
2. Search the repository first.
3. Confirm the installed version before quoting platform behavior.
4. Read the exact V2 page for the feature. Quote the rule or field.
5. Check the schema when a field name or shape is uncertain.
6. Test a claim against the real code or a small command when possible.
7. Record conflicts and unknowns explicitly.

## Evidence sheet

```text
Question:
Decision it unblocks:
Installed version:
Sources (URL or path):
Verified facts (quoted or cited):
Applicability to this repository:
Risks / unknowns:
Recommended next step:
```

## Traps seen in this repository

- V2 uses `permissions`, `shell` and `subagent`; V1 used `permission`, `bash`
  and `task`.
- Permission rules are ordered and the last match wins.
- V2 MCP servers live under `mcp.servers`, not directly under `mcp`.
- A markdown command keeps its template in the body, not in frontmatter.
- A skill ID comes from the directory or file name, not from the display name.
- Per-agent `request` headers and body overlays are preserved but not yet sent.

Never present an unverified field as supported. If the evidence is incomplete,
say what would resolve it and stop.
