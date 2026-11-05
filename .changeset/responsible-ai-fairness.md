---

"@behavior-os/schemas": minor
"@behavior-os/core": minor
"@behavior-os/mcp-server": minor
"@behavior-os/cli": minor
"@behavior-os/sdk": minor
---

feat(responsible-ai): fairness metrics, data provenance and human oversight

Adds a deterministic Responsible-AI layer that measures outcomes instead of
declaring a gate:

- `FairnessEngine` computes demographic parity difference, disparate impact
  ratio and equal opportunity difference from per-group counts, with
  configurable thresholds.
- Data provenance (datasetId, source, ISO-8601 collectedAt, consentBasis,
  transformations, lineage) is validated separately from evidence provenance.
- Human oversight is a first-class gate: when required, approval plus a
  non-empty `reviewerId` are mandatory.
- Verdicts: `pass` / `warn` / `block` / `insufficient_data`. Missing ground
  truth yields an explicit "not computed" reason, never an invented metric.
- Exposed through `BehaviorOS.evaluateFairness()`, `bos_evaluate_fairness`
  (MCP and OpenCode plugin), and the `fairness-gate` rule in the
  `ai-ml-pipeline` DNA.

Toolchain and docs:

- `vitest.config.ts` now resolves explicit project configs, so the root
  `vitest` run no longer aborts on stray files under `packages/`.
- Documentation counts are guarded against drift: MCP tool list, plugin-only
  tools and Zod schema counts are checked against source.
- Synchronised counts: 87 MCP tools, 72 plugin tools, 48 engines,
  87 `z.object` / 60 `z.enum`.
