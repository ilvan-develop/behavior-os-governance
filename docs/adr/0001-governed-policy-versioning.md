# ADR 0001 — Governed policy versioning in the learning engine

- Status: Accepted (Sprint 2)
- Date: 2026-11-04
- Scope: `packages/core/src/engine/learning-engine.ts`,
  `packages/core/src/engine/behavior-os.ts`

## Context

A learning record that reaches the `policy` lifecycle stage is a behavioral
rule. Before Sprint 2 nothing distinguished "a rule someone wrote down" from "a
rule that was validated, approved, activated and is being monitored". Editing
the record overwrote the only copy, there was no stable version identity, and a
rollback had no auditable target.

Sprint 2 requires: stable policy identity, immutable version history,
provenance for each change, validation bound to the exact version, human
approval before activation, controlled deactivation, deterministic rollback,
monitoring, an audit trail, and legacy compatibility.

## Decision

Add an append-only **policy ledger** to the existing `LearningEngine`. The
ledger is not a new engine and not a new database table.

### Identity and immutability

- A policy is identified by a stable `policyId`. When a learning record enters
  the `policy` stage, the id is derived deterministically as
  `policy:<learningRecordId>`.
- Each change appends a new version `{policyId, versionId, version, content,
  contentHash, enforcement?, provenance, learningId?}`. `versionId` is
  `` `${policyId}@${version}` `` and `version` is monotonically increasing.
- `contentHash` is SHA-256 over canonical JSON of
  `{policyId, content, enforcement?}` (keys sorted). Versions are never mutated;
  getters return copies.
- Existing versions keep their bytes and hash when a newer version is created.

### Validation, approval and activation

- `validatePolicyVersion` recomputes the content hash, checks structural
  invariants and, when a `learningId` is present, that the record still exists.
  A validation record carries `(versionId, contentHash)`; a passing validation
  for a _different_ hash cannot unlock anything.
- `approvePolicyVersion` rejects any actor whose `kind` is not `human`. It also
  requires a passing validation for the exact `(versionId, contentHash)` and a
  rationale of at least 10 characters.
- When `BEHAVIOR_OS_APPROVAL_KEY` is set, approval additionally requires an
  HMAC-SHA256 token over
  `` `${policyId}|${versionId}|${contentHash}|${rationale}` ``. The token is
  issued by `scripts/policy-approval-token.mjs` and compared with
  `timingSafeEqual`. Without the key the engine keeps the documented
  actor-kind contract for local development; the approval record stores
  `verification: 'hmac' | 'actor-kind'` so the weaker basis is visible.
- `activatePolicyVersion` requires a human actor, the exact-hash validation and
  the exact-hash human approval. The active pointer moves; the previous version
  is retired by derivation, not deleted.
- `deactivatePolicy` requires a human actor and a reason, records a
  `deactivated` activation, and leaves every version in place.
- `rollbackPolicy` requires a human actor and a reason, and a target with a
  passing validation for its exact hash plus either a human approval or a
  previous activation. The rollback is an append-only `rolled-back` activation
  with `fromVersionId`/`toVersionId`.
- `monitorPolicy` records checks/failures only for the active version.

### Enforcement

- A version may carry an optional machine-readable `enforcement`
  `{action: 'block'|'escalate'|'require'|'warn', match, severity, description?}`;
  `match` is `*` or a case-insensitive substring of the action.
- `evaluateGovernance` consults `evaluateActivePolicies(action)` after the DNA
  rules. Only `active` versions participate; candidate, validated and approved
  versions have no effect. The strongest action wins
  (`deny` > `escalate`/`require` > `warn` > `allow`).
- Policy rule ids (`policy:<policyId>@<version>`) appear in `rulesEvaluated` and
  `firedRules`, and their action is reported in governance metrics.
- A policy `deny` is **not** softened by the lenient governance level: activating
  a blocking policy is an explicit human decision.
- `getStatus().policies` reports the active count, active version ids and how
  many carry enforcement, so every host (plugin, MCP, CLI) can observe the
  active ruleset.

### Audit trail

Every transition appends a `PolicyLedgerEvent` (`candidate-created`,
`validated`, `validation-failed`, `approval-rejected`, `approved`,
`activation-rejected`, `activated`, `deactivated`, `rollback-rejected`,
`rolled-back`, `monitored`, `monitor-failed`, `legacy-imported`). The facade
also mirrors the newest event into the hash-chained governance log
(`bos_get_log`, `bos_verify_audit_trail`).

### Persistence: why no new SQLite table

The ledger is stored as one JSON document under the existing `meta` key
`policy-ledger` (the same channel already used for `role-policy-state`,
`learning-records` and `learning-events`). A dedicated table would require a
schema migration, a new store interface method and mirroring in every `Store`
implementation for one aggregate that is always read and written whole. The
`meta` key keeps the change backward compatible and avoids schema drift; the
ledger itself is append-only, so the JSON document grows only with versions.
`exportState`/`importState` include `policyLedger` and the store hydrates it on
construction.

### Legacy compatibility

- Records already at `policy`/`monitored` when no ledger exists are imported as
  an active version 1 with `provenance.source = 'legacy'` and an activation
  record with `basis = 'legacy-import'`. The exception is visible in the events,
  not silent.
- Snapshots written before this change (no `policyLedger`) restore the same way.
- The learning lifecycle's `advanceRecord` behavior is unchanged. Entering
  `policy` now additionally creates an **inactive** candidate; it never
  activates it.

## Consequences

- Any activation now needs two independent exact-hash artifacts (validation and
  human approval). A stale validation cannot be reused after content changes.
- Rollback is deterministic: versions are addressed by stable ids and the
  resulting state is reproducible from the ledger.
- `definePolicy`/`defineRolePolicy` (the role/policy registry) is untouched.
  Policy versioning governs learning-derived policies; enforcement is applied
  at the `evaluateGovernance` choke point.
- Trust boundary: without `BEHAVIOR_OS_APPROVAL_KEY`, the engine only enforces
  `actor.kind === 'human'` and cannot prove that the caller is human. With the
  key configured, approval requires an HMAC token bound to the exact version,
  content hash and rationale, so a caller that merely claims to be human cannot
  approve. The token issuer is a local script; production hosts should issue it
  from their human-facing approval surface and rotate the shared secret.
- The ledger is in-process and snapshot-persisted; concurrent writers to the
  same store are still governed by the existing single-flight/revision rules.

## Alternatives considered

1. **New `policy_versions` SQLite table** — rejected: migration cost and store
   interface surface for an aggregate that is read/written whole.
2. **Version fields on the learning record** — rejected: overwrites history and
   cannot represent multiple policy identities per record.
3. **Reuse `definePolicy` for activation** — rejected: it bypasses validation
   and human approval and would let a tool call silently replace an active
   policy.
