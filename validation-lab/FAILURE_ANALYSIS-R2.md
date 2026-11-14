# FAILURE_ANALYSIS — P-01 and governance-block findings (r2)

## P-01 — order-dependent shared-state leak in the test suite

Symptom: the orchestrator loop test, when run in the full suite, ends with
GOVERNANCE_DENIED and the task stuck `pending` with zero evidence. The same input,
run in isolation (`vitest -t "blocks a mutating shell task"`), correctly ends with
AGENT_NOT_FOUND, `blocked`, and zero evidence.

Root cause (proven):
- `plugins/opencode-v2/tests/plugin-registration.test.ts` (lines ~966-1010) registers a
  catch-all role policy `p-block-all` (condition `*`, action `block`) on
  `persona:architect` and never removes it.
- The policy registry is process-global. When the orchestrator loop test runs after
  the registration test in the same process, the leaked catch-all policy makes the
  mission-level `execute` preflight return `GOVERNANCE_DENIED` (mission preflight
  deny path, `packages/orchestrator/src/orchestrator.ts` ~570-614) instead of the
  per-task `AGENT_NOT_FOUND` delegation refusal (`packages/orchestrator/src/
  control-loop.ts` `enforceKnownAgents` ~1328, refusal ~822-870).
- The product is fail-closed in both shapes; the _terminal shape_ differs only because
  of test-suite state pollution.

Impact: low on the product, high on test determinism. A clean suite should be
order-independent.

Fix: scope `p-block-all` to the test that registers it (remove it in an `afterEach`)
or use a throwaway role id, so the catch-all cannot leak into sibling tests.

## Resolution (applied + verified)

Approved and fixed in this audit. Added `resetRolePolicyEngineForTest()` to
`plugins/opencode-v2/src/index.ts` (a clearly-marked test-only export that uses the
engine's supported `restore({ roles: [], policies: [], trail: [] })` and touches no
persistence). The `p-block-all` test now wraps its body in `try/finally` and resets
the engine in the `finally`, and a new regression guard asserts `p-block-all` no
longer appears in `bos_list_roles` after the test. Verified:
- `plugins/opencode-v2` typecheck exit 0.
- `plugin-registration.test.ts` now 70/70 (was 69 passing + P-01 failing); the
  control-loop test now ends in AGENT_NOT_FOUND, not GOVERNANCE_DENIED.
- Full suite re-run to confirm no other order-dependence (see FINAL_AUDIT-R2).

## Governance block instability (audit-artifact writes)

The same physical write of a new markdown report was blocked by a _different_ rule
depending on the active DNA:
- Research Lab -> `data-integrity` ("Block unauthorized data modification")
- Legacy Modernization -> `backward-compatibility`
- open-source -> allowed

Observation: governance verdicts for identical content are DNA-dependent. This is
expected (DNA encodes the persona's risk posture) but it means an audit that must
persist deliverables cannot rely on a single stable write channel; the operator must
either (a) approve the write explicitly, or (b) run the persistence under a DNA whose
rules do not match the content signature.

## Debris

- ~1000+ `.behavioros/loops/*.json` state files with no retention policy.
- 4 stale `active` missions at 0 progress.
- Duplicated empty brainstorm/conversation sessions auto-created.
- Audit mission auto-typed `bugfix` rather than `audit`.
  None are blocking; all are operational-hygiene items for the roadmap.
