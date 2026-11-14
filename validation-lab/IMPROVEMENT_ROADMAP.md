# IMPROVEMENT_ROADMAP

Ordered by risk, not by effort. Every item has an executable test attached.
The audit itself applied no production change. R-01 and R-02 were subsequently
approved, implemented test-first, rebuilt and re-verified; the remaining items
are still proposals awaiting a decision.

## R-01 - Close G-01: fail-closed action classification (critical) - DONE

**Status: implemented, rebuilt, verified.** `READ_ONLY_HEADS` is the explicit
allowlist; `isReadOnlyAction` releases only that set (or the control plane);
`isMutatingAction` is fail-closed. Probe V1/V2/P2/P4 pass and L06 is 12/12.
Regression tests: `packages/core/tests/action-classification.test.ts`,
`facade-host-logic.test.ts`.

**Change.** In `packages/core/src/action-classification.ts`:

1. Add an explicit `READ_ONLY_ACTION` allowlist (inspection verbs and `bos_*`).
2. Change the policy to: a deny is released **only** if the action is
   control-plane or matches the read-only allowlist.
3. For shell actions, consult `classifyIrreversibleCommand` so `git push`,
   `kubectl apply`, `terraform apply`, `npm publish` are never "read-only".
4. Keep the existing `MUTATING_ACTION` export for callers that need positive
   classification, but stop using its negation as an authorization decision.

**Tests that must fail first.**

```text
preflightAction('export_protected_records', {sensitive:true}) -> allowed === false
preflightAction('git push', {sensitive:true})                 -> allowed === false
preflightAction('read_file')                                  -> allowed === true
preflightAction('bos_get_state')                              -> allowed === true
for 30 unknown verbs                                          -> allowed === false
```

**Risk.** Over-blocking legitimate read-only tools whose names are not on the
allowlist. Mitigation: the allowlist is data, covered by a table-driven test,
and the deny is still recorded so operators can see the over-block.

**Proof of fix.** `node validation-lab/harness/run.mjs` -> L06 must drop to 1
failure (tamper, already corrected) then 0; `probe-independent.mjs` V1/V2/P2/P4
must pass.

## R-02 - Close S-01: revocation must remove authority (high) - DONE

**Status: implemented, rebuilt, verified.** `revokedAt`/`revokedBy` are explicit,
`hasCapability` and `verifyIdentity` reject revoked identities immediately, and
expiry uses an inclusive boundary. Probe Z1/Z2/Z2b/Z3 pass and L13 is 11/11.
Regression test: `packages/core/tests/zero-trust-identity.test.ts`.

**Change.** In `zero-trust-identity-engine.ts`:

1. Add `revokedAt: string | null` and `revokedBy?: string` to `AgentIdentity`.
2. `revokeIdentity` sets `revokedAt` (do not mutate `expiresAt`).
3. `hasCapability` returns false if identity is missing, expired, or revoked.
4. `verifyIdentity` reports `revokedAt` as the reason when present.

**Tests that must fail first.**

```text
revoke -> hasCapability === false
expire -> hasCapability === false
revoke -> clock moved backwards -> still revoked
issue  -> hasCapability === true
```

**Proof of fix.** `probe-independent.mjs` Z1/Z2/Z3 all pass; L13 11/11.

## R-03 - Make the facade audit verifier unambiguous (medium)

**Change (choose one, documented):**

- Preferred: `verifyAuditTrail()` delegates to `verifyGovernanceLogFile` when a
  sink is enabled (durable is authoritative, matching `bos_verify_audit_trail`).
- Alternative: rename to `verifyAuditTrailWindow()` and keep the current
  semantics.

**Test.** With a configured sink, tamper a line, assert the facade cannot return
`valid: true`.

## R-04 - One action classifier (medium, enables R-01)

Extract `classifyAction(action, context) -> { mutates, controlPlane,
irreversibleKind, readOnly }` and make every host consume it. Delete local
regexes from hosts. Add a conformance check that the plugin, MCP, CLI and
orchestrator return identical classifications for a 50-entry table.

## R-05 - Graph accuracy benchmark (medium)

L02 currently checks one symbol against ground truth. Add:

- a sample of 25 symbols across packages;
- for each: does `graphify query` name the defining file? (precision)
- for each: does `path A B` exist when the source has a direct import? (recall)
- report precision/recall and list every inferred hop used.

This turns "the graph answered correctly once" into a measured accuracy claim.

## R-06 - Execute the model-in-the-loop challenge (high value, high effort)

Run `CHALLENGE.md` on `unknown-project` and `second-project`, with:

- the answer key removed from the agent workspace;
- N>=3 repetitions;
- the 4-condition learning design (A/B/C/D);
- scoring by a separate reviewer, not by the implementer.

Until then, L01/L03/L10/L15 remain NOT_VERIFIED. This is the single largest
unknown in the brief, and no amount of engineering evidence can substitute for it.

## R-07 - Fresh verification artifacts (low, hygiene)

The current `pnpm-typecheck.txt` is served from the Turbo cache (`11 cached`).
Re-run the ladder uncached (`--force`) and store the artifact, so the
engineering dimension has fresh, defensible evidence.

## R-08 - Keep the lab out of the production tree (low)

`validation-lab/` is untracked today. Decide deliberately:

- commit it as a first-class deliverable (recommended - it is the evidence), or
- keep it out and document its location.

Do not leave it in limbo where a `git clean` can destroy the evidence.

## Suggested order

```text
R-07 (1 command)  ->  R-01 + R-02 (with tests)  ->  L06/L13 green
                ->  R-03 + R-04 (consistency)   ->  R-05 (graph accuracy)
                ->  R-06 (the actual intelligence claim)
```

## What NOT to do

- Do not lower the L06/L13 gates to make the suite green.
- Do not count L08 as "learning works end to end"; it proves the mechanism, not
  autonomous discovery.
- Do not claim graph intelligence from one successful query.
- Do not claim OpenCode V2 compatibility from registration alone under a beta API.
