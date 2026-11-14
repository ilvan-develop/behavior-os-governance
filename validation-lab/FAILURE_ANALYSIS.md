# FAILURE_ANALYSIS

Root-cause analysis of every failed assertion after independent re-verification.
Two are product defects, two were lab measurement defects (see
`LAB_CORRECTIONS.md`), one is an API footgun.

## Summary

| ID   | Finding                                                                   | Type        | Severity | Status               |
| ---- | ------------------------------------------------------------------------- | ----------- | -------- | -------------------- |
| G-01 | Mutation vocabulary is fail-open; DNA deny released for export / git push | product     | critical | **fixed + verified** |
| S-01 | Revoked zero-trust identity keeps its capabilities                        | product     | high     | **fixed + verified** |
| L-01 | L06 tamper check targeted the in-memory verifier                          | lab         | info     | corrected (C-01)     |
| L-02 | L08 required a `warn` verdict the schema forbids                          | lab         | info     | corrected (C-02)     |
| O-01 | `verifyAuditTrail()` name implies whole-history verification              | observation | medium   | open (documented)    |

Fix verification: `probe-independent.mjs` 17/17, harness 113/113, core 980/3,
orchestrator 181/3, lint 527 clean, typecheck 11/11, build 8/8.

---

## G-01 - fail-open mutation classification

**Symptom.** `preflightAction('export_protected_records', {<sensitive flag>: true})`
returns `allowed: true` even though the DNA evaluated `deny` for the exact same
action and context. `bootstrapDenyOverride('git push', deny)` returns `true`.

**Root cause.** `packages/core/src/action-classification.ts:21-22` classifies by
regex membership:

```ts
export const MUTATING_ACTION =
  /write|edit|patch|bash|shell|apply|create|delete|move|deploy|publish|release/i;
export function isMutatingAction(action) {
  return typeof action === 'string' && MUTATING_ACTION.test(action);
}
```

`bootstrapDenyOverride` (`behavior-os.ts:2028`) releases a deny when
`!isMutatingAction(action)`. Unknown strings therefore default to _safe to
release_. The set of harmful verbs is unbounded (`export`, `send`, `transmit`,
`upload`, `git push`, `scp`, `curl -X POST`, `mail`, `webhook`...), so an
incomplete list is guaranteed, not accidental.

**Contributing factor.** Two classifiers disagree on the same input. The safety
floor knows `git push` (deployment, `governance-engine.ts:126`); the mutation
vocabulary does not. A single source of truth for action classification is
missing.

**Blast radius.** Every host that relies on `preflightAction` or
`bootstrapDenyOverride`: the plugin permission hook, MCP preflight, the CLI and
the orchestrator. Any DNA rule that denies an action named outside the
vocabulary can be bypassed by the name alone.

**Why the existing tests missed it.** `facade-host-logic.test.ts` and the
conformance harness test the carve-out with actions that _are_ in the
vocabulary (`write`, `read`, `bos_*`). No test asserts the complement property:
"an action that is not provably read-only must not be released."

**Detection heuristic for review.** Any "allowlist implemented as a denylist"
is a fail-open shape. Grep for `!isMutatingAction`, `!isDangerous`,
`!isSensitive` and check what happens to unknown input.

**Fix implemented (verified).** R-01:

1. `READ_ONLY_HEADS` is an explicit allowlist; `isReadOnlyAction` releases only
   members of it or the governance control plane.
2. `isMutatingAction` is now fail-closed: anything not provably read-only is
   mutating, so the deny override cannot release it.
3. `MUTATING_ACTION` was widened as a second layer, but correctness no longer
   depends on that list.
4. Regression tests assert the complement property (`action-classification.test.ts`,
   `facade-host-logic.test.ts`); probe V1/V2/P2/P4 verify `export` and
   `git push` stay denied.

Historical fix direction (for reference):

1. Invert the default: define an explicit `READ_ONLY_ACTION` allowlist of
   inspection verbs (`read`, `get`, `list`, `query`, `explain`, `verify`,
   `status`, `diff`, `grep`, `glob`, `search`, `inspect`, `whoami`, `path`).
2. Release a deny only when the action matches the read-only allowlist or the
   control plane. Everything else is mutating.
3. Reuse `classifyIrreversibleCommand` for shell strings so `git push` and
   friends cannot be "read-only".
4. Add the complement test: for a table of 30 action names, the only released
   ones are the declared read-only entries.

---

## S-01 - revocation without effect on capabilities

**Symptom.** After `revokeIdentity('agent-x')`, `hasCapability('agent-x', 'deploy')`
returns `true`, and a same-tick `verifyIdentity` also returns `valid: true`.

**Root cause.** Two independent gaps in `zero-trust-identity-engine.ts`:

1. `hasCapability` (`:114-117`) checks capability membership only. Expiry is
   checked in `verifyIdentity` (`:93`) but never in the authorization path.
2. Revocation is modelled as `expiresAt = now` (`:125-130`) and verification uses
   strict `<`, so the identity is still valid in the millisecond it is revoked.
   Authority is derived from a field the capability check never reads.

**Blast radius.** Any caller using `hasCapability` as the authorization gate -
the natural use of the method - continues to authorize a revoked agent
permanently. Verification is wrong only within a clock tick, but a security
control should be immediate and monotonic, not eventual.

**Measured.** 20/20 fresh identities were still valid when verified in the same
tick after revocation (`artifacts/raw/independent-probe.json`,
`revocationWindow`). After a 5ms wait, verification correctly fails - so the
defect is the window plus the missing capability check, not a random flake.

**Why the tests missed it.** The existing cases cover issue -> verify -> capability
granted. There is no post-revocation authorization test, and the "verify after
revoke" case is race-dependent: lab v1 passed it once and failed it on a later
run. A test that depends on the clock tick is not testing revocation.

**Fix implemented (verified).** R-02:

1. Explicit `revokedAt` + `revokedBy` are stored; `expiresAt` is no longer
   mutated to model revocation.
2. `hasCapability` returns false when the identity is missing, expired, or
   revoked, and uses an inclusive expiry boundary.
3. `verifyIdentity` rejects on `revokedAt`, independent of the clock.
4. Tests cover revoked -> capability false, revoked -> verify false immediately
   and after a delay, expired -> capability false, clock moved backwards -> still
   revoked. Probe Z1/Z2/Z2b/Z3 pass (revocation window: 0).

Historical fix direction (for reference):

1. Add explicit `revokedAt` + `revokedBy`; do not mutate `expiresAt`.
2. `hasCapability` returns false when the identity is missing, expired, or revoked.
3. `verifyIdentity` rejects on `revokedAt`, independent of the clock.
4. Tests: revoked -> capability false; revoked -> verify false immediately and
   after a delay; expired -> capability false; clock moved backwards -> still revoked.

---

## O-01 - `verifyAuditTrail()` ergonomics

The facade method verifies the retained window and returns
`{ valid: true, complete: false }`. That is correct and documented in the
method comment, but `valid: true` reads as "the trail is intact" to a caller who
does not inspect `complete`. The plugin tool does the right thing (durable file
is authoritative). A facade caller may not.

Recommendation: when a durable sink is enabled, delegate to
`verifyGovernanceLogFile`; otherwise rename to `verifyAuditTrailWindow`. Add a
test that asserts the facade cannot report `valid: true` while a configured
sink is tampered.

---

## What did NOT fail (and should not be re-litigated)

- Deny precedence, level ordering, lenient softening.
- Durable tamper detection (truncated head, gap, reorder, edit).
- Simulated audits can never satisfy a gate.
- Role policy is evaluated before DNA.
- Circuit breaker, bounded retries, timeouts, resume without duplication.
- Delegation refusals (read-only, budget, duplicate reservation).
- Project context injection treated as data (L13 injection payload).

---

## Incidental evidence: governance blocked this document

The first attempt to write this file was denied at runtime by the active DNA:

```
[Behavior-OS:Enterprise Governance] Blocked by rule: data-protection
```

The file contained the literal sensitive context key used by the experiment.
That is the enforcement path working on a real write, not a unit test. It is
recorded here because it is positive evidence for L06 that the lab's failing
assertions do not cover: content-based denial reaches the write surface.
