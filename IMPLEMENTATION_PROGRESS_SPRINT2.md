# Sprint 2 — Governed policy versioning (verified delivery)

**Date**: 2026-11-04
**Status**: Implemented and verified
**Scope**: Learning-derived policies (`LearningEngine`) and the `BehaviorOS`
facade. No new MCP tool, no new SQLite table, no release/deploy action.

## Contract delivered

| Requirement                          | Implementation                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Stable policy identity               | `policyId`; `policy:<learningId>` derived deterministically                         |
| Immutable version history            | append-only `PolicyVersion[]` keyed by `policyId`; getters return copies            |
| Provenance for every change          | `provenance {source, actor, actorKind, createdAt, reason?, mission?}`               |
| Validation tied to the exact version | validation record carries `(versionId, contentHash)`; hash recomputed on validation |
| Human approval before activation     | `actor.kind === 'human'` required; rationale ≥ 10 chars                             |
| Controlled activation/deactivation   | active pointer + append-only activation records; history never deleted              |
| Rollback                             | deterministic `rollbackPolicy` to a validated + approved/previously-active version  |
| Monitoring                           | `monitorPolicy` records checks/failures for the active version only                 |
| Audit trail                          | append-only ledger events mirrored into the hash-chained governance log             |
| Legacy compatibility                 | pre-ledger records imported as active v1 with `basis: 'legacy-import'`              |
| No new SQLite table                  | ledger stored under the existing `meta` key `policy-ledger` (see ADR 0001)          |

Lifecycle: a learning record entering `policy` creates an **inactive**
candidate automatically. Activation still requires validation + human approval.

## Files changed

- `packages/core/src/engine/learning-engine.ts` — policy ledger types, canonical
  SHA-256 hashing, candidate/validate/approve/activate/deactivate/rollback/
  monitor operations, snapshot/restore, legacy import, `advanceRecord` hook.
- `packages/core/src/engine/behavior-os.ts` — facade methods, governance-log
  mirroring, `meta` persistence, hydration, `exportState`/`importState`,
  `persistAll`.
- `packages/core/tests/policy-versioning.test.ts` — 16 new tests.
- `docs/adr/0001-governed-policy-versioning.md` — decision record.

No MCP tool was added, so the documented MCP/plugin counts are unchanged.

## Verification evidence (commands run from the repository root)

| Command                                | Result                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                       | exit 0 — 11/11 tasks successful                                                                                |
| `pnpm lint:check`                      | exit 0 — 464 files checked, no fixes applied                                                                   |
| `pnpm --filter @behavior-os/core test` | exit 0 — 83 files, 870 tests                                                                                   |
| `pnpm test --force`                    | exit 0 — 8/8 packages successful                                                                               |
| Per-package test counts                | schemas 35, core 870, sdk 15, cli 22, mcp-server 45, orchestrator 149, plugin 177, examples 4 — **1317 total** |
| `pnpm build`                           | exit 0 — 8/8 tasks successful                                                                                  |
| `pnpm verify:publish`                  | exit 0 — 5 packages installable                                                                                |
| `pnpm verify:plugin`                   | exit 0 — 71 tools surfaced                                                                                     |
| `pnpm verify:opencode`                 | exit 0 — 39/39 checks                                                                                          |
| `pnpm verify:windows`                  | exit 0 — zero visible console windows                                                                          |
| `pnpm smoke:mcp`                       | exit 0 — 2 resources, 21 DNA patterns, governance escalation matched                                           |
| `pnpm verify:governance`               | exit 0 — 24/24 claims proven, 0 failures                                                                       |
| `pnpm run security:audit`              | exit 0 — 11 vulnerabilities (2 low, 9 moderate, 0 high/critical)                                               |
| `git diff --check`                     | exit 0                                                                                                         |

`docs/analysis/governance-conformance.json` is a generated artifact; it was
reverted to HEAD after the run so the working tree only carries intentional
changes.

## Hardening update (2026-11-05)

Two gaps that were explicit limitations of the first delivery are now closed:

1. **Active-policy enforcement.** A version may carry an optional
   `enforcement {action, match, severity, description?}`. `evaluateGovernance`
   consults the active policy set after DNA rules; only human-activated versions
   participate. Policy rule ids appear in `rulesEvaluated`/`firedRules`, and the
   decision reason names the policy. Non-matching actions are untouched, and a
   policy `deny` is not softened by the lenient governance level.
2. **Authenticated human approval.** When `BEHAVIOR_OS_APPROVAL_KEY` is set,
   `approvePolicyVersion` requires an HMAC-SHA256 token over
   `policyId|versionId|contentHash|rationale` (constant-time compare). The
   approval record stores `verification: 'hmac' | 'actor-kind'`.
   `scripts/policy-approval-token.mjs` issues the token.

Also added: `getStatus().policies {active, ids, enforced}` so plugin, MCP and
CLI hosts can observe the active ruleset without a new tool.

`packages/core/tests/policy-versioning.test.ts` now has **18 tests** (was 16):
the end-to-end enforcement test (candidate → approved/inactive → active → deny
→ deactivate) and the HMAC approval test (missing token, invalid token, valid
token).

## Test coverage (16 original tests, plus 2 hardening tests)

- immutable candidate versions and stable `versionId`/hash;
- rejection of missing identity or content;
- exact-version validation and tamper detection via content hash;
- approval refused without a passing validation;
- LLM and agent approval refused (`HUMAN_APPROVAL_REQUIRED`);
- LLM activation refused; activation refused without approval;
- successful human activation with audit event;
- deactivation preserves history and requires a human;
- rollback to an approved version with `fromVersionId` audit;
- rollback refused for an unvalidated target;
- monitoring only the active version;
- `exportState`/`importState` round-trip;
- automatic inactive candidate on entering `policy`;
- legacy import from a pre-ledger snapshot;
- ledger persistence across a process restart using the existing `meta` table.

## Residual limitations (explicit, not claimed as solved)

1. **Trust boundary.** With `BEHAVIOR_OS_APPROVAL_KEY` set, approval requires an
   HMAC token bound to the exact version and rationale; without the key the
   engine keeps the actor-kind contract for local development. The secret is
   shared with the issuer script, so production hosts must protect and rotate it.
2. **No new tool surface.** The versioned operations are facade APIs; they are
   not exposed as `bos_*` MCP tools yet. `getStatus().policies` makes the state
   observable, but an MCP-only host cannot drive the lifecycle until a follow-up
   sprint.
3. **Enforcement is match-based.** `match` is `*` or a case-insensitive substring
   of the action string. There is no expression language or per-agent condition;
   false positives are possible for very short matches.
4. **In-process ledger.** It is snapshot-persisted (whole-document `meta` key),
   not a transactional table; concurrent writers still rely on the existing
   single-flight/revision rules.
5. **C09.** The conformance check now recovers the mission id from
   `bos_create_mission` instead of `missions[limit-1]`; `verify:governance`
   passes 24/24.

## Protocol note

Release commit `6c6a11b` aggregates the Phase 1 working tree (Sprint 1A/1B,
Sprint 2 and this hardening). The project permission layer denies `git push`,
`pnpm publish` and `npm publish`, so publishing remains a human gate:

```bash
git push origin master:main
```

The push triggers `.github/workflows/release.yml` on `main`, which runs
`changeset version` and publishes with the CI `NPM_TOKEN`. The two changesets
(`responsible-ai-fairness` and `governed-policy-enforcement`) produce the next
minor version for the fixed package group.
