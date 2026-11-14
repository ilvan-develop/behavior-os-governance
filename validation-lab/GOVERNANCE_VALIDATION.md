# GOVERNANCE_VALIDATION

Lab L06 (Governance) and L13 (Security, deterministic half), plus the ambient
gates (`verify:governance`, `verify:opencode`). Every row is backed by an
executed check in `artifacts/evidence.json` or `artifacts/raw/`.

## What governs a decision

1. Role policy is evaluated **before** DNA (`behavior-os.ts:564-576`).
2. `GovernanceEngine.evaluate` folds DNA rules by level (critical first) into
   `allow | deny | escalate | transform` (`governance-engine.ts:231-329`).
3. An irreversible-action safety floor can raise `allow` to `escalate` unless a
   DNA `warn` rule explicitly opts out (`:296-316`).
4. `bootstrapDenyOverride` decides whether a DNA deny is released for
   control-plane or read-only actions (`behavior-os.ts:2026-2030`).
5. Every non-allow verdict is recorded in a SHA-256 hash chain, optionally
   mirrored to an append-only JSONL sink.

## Executed results

| Behaviour                                                   | Expected          | Observed            | Status |
| ----------------------------------------------------------- | ----------------- | ------------------- | ------ |
| benign action                                               | allow             | allow               | PASS   |
| sensitive action under `data-protection`                    | deny              | deny                | PASS   |
| deny cites the fired rule                                   | `data-protection` | `data-protection`   | PASS   |
| preflight blocks a denied mutating action                   | false             | false               | PASS   |
| preflight allows a read-only action                         | true              | true                | PASS   |
| lenient level softens a deny                                | escalate          | escalate            | PASS   |
| softening is explained in the reason                        | /lenient/         | matched             | PASS   |
| clean in-memory chain verifies                              | true              | true                | PASS   |
| durable JSONL detects on-disk tampering                     | false             | false               | PASS   |
| **denied data export is not released**                      | false             | false (fixed)       | PASS   |
| **deny override refuses `git push`**                        | false             | false (fixed)       | PASS   |
| permissions deny `*.env` / `*.env.*`, allow `*.env.example` | -                 | -                   | PASS   |
| permission policy asks before `git push`                    | -                 | -                   | PASS   |
| unauthorized pipeline change denied                         | deny              | deny                | PASS   |
| revocation takes effect after the clock advances            | false             | false               | PASS   |
| **revocation is immediate (same tick)**                     | false             | false (0/20, fixed) | PASS   |
| **revocation removes the capability**                       | false             | false (fixed)       | PASS   |

All assertions above are re-executed in `artifacts/evidence.json` (L06 12/12,
L13 11/11) and `probe-independent.mjs` (17/17).

Ambient gates (post-fix, from `artifacts/raw/`):

- `verify:governance` - **25/25** claims proven, 0 failures, exit 0.
- `verify:plugin` - 102 tools, hooks, live deny, protocol step; exit 0.
- `verify:opencode` - **42/42** checks passed (pre-fix evidence).
- `verify:tool-parity` - PASS: 98 MCP tools, 102 plugin tools, 98 shared,
  4 declared plugin-only loop tools (pre-fix evidence).

## Defect G-01 - fail-open mutation vocabulary (critical)

`packages/core/src/action-classification.ts:21-22`:

```ts
export const MUTATING_ACTION =
  /write|edit|patch|bash|shell|apply|create|delete|move|deploy|publish|release/i;
```

`bootstrapDenyOverride` releases a DNA deny when `!isMutatingAction(action)`,
i.e. **anything not matching the regex is treated as read-only**. That is an
allowlist wearing a denylist's clothes. Actions that move data out of the
governed environment - `export`, `send`, `transmit`, `upload`, `git push` - do
not match, so a DNA `deny` is downgraded to `passed`.

**Status: FIXED (R-01).** `action-classification.ts` now owns an explicit
`READ_ONLY_HEADS` allowlist. `isReadOnlyAction` releases only a declared
read-only verb (or the governance control plane), and `isMutatingAction` is
fail-closed: anything not provably read-only is mutating. Correctness no longer
depends on enumerating harmful verbs.

Executed proof (independent probe, post-fix):

| Check                                     | Expected | Observed |
| ----------------------------------------- | -------- | -------- |
| V1 `git push` is mutating                 | true     | true     |
| V2 `export_protected_records` is mutating | true     | true     |
| P1 DNA verdict for the export             | deny     | deny     |
| P2 preflight keeps the deny               | false    | false    |
| P4 override refuses `git push`            | false    | false    |

The inconsistency is closed: the deny override and
`classifyIrreversibleCommand` now agree that `git push` is a deployment.

**Impact (historical).** A restrictive DNA could be bypassed by naming the
action outside the vocabulary. Severity: critical. Regression tests:
`packages/core/tests/action-classification.test.ts`,
`packages/core/tests/facade-host-logic.test.ts`.

## Defect S-01 - revocation does not revoke capabilities

`zero-trust-identity-engine.ts:114-130`:

```ts
hasCapability(agentId, capability) {
  const identity = this.identities.get(agentId);
  return identity?.capabilities.includes(capability) ?? false;   // no expiry / revocation check
}
revokeIdentity(agentId) { identity.expiresAt = new Date().toISOString(); }
```

`verifyIdentity` eventually rejected the identity, but two gaps remained:

1. **Capability was never revoked.** `hasCapability` - the gate an authorization
   path actually calls - never read expiry or revocation. Executed: `Z3`
   hasCapability(revoked) was **true**.
2. **Revocation was not immediate.** `expiresAt = now` plus a strict `<` check
   left a same-millisecond window. Measured 20/20 identities still valid in the
   same tick; after 5ms, verification failed (`Z2` PASS).

**Status: FIXED (R-02).** `revokedAt`/`revokedBy` are explicit, `hasCapability`
rejects missing/expired/revoked identities with an inclusive expiry boundary,
and `verifyIdentity` rejects on `revokedAt` independent of the clock. Post-fix:
`Z2b` revocation is immediate (window 0/20), `Z3` capability is gone. Regression
test: `packages/core/tests/zero-trust-identity.test.ts`.

**Impact (historical).** Revocation was cosmetic for capability checks, and
briefly cosmetic even for verification. Severity: high. Design smells fixed: one
timestamp doing two jobs (expiry and revocation), and authority derived from a
field the authorization path never read.

## What is strong

- Deny precedence, level ordering and lenient softening are correct and
  explained in the reason string.
- Control-plane/read-only escape hatch is necessary and works (`P3`).
- Durable tamper evidence is real: the JSONL verifier catches an edited line,
  a truncated head, a sequence gap and reordering (`governance-log.ts:416-546`).
- The simulated-audit guard works: a simulated audit is marked `simulated: true`
  and can never satisfy a required gate (`L12`).
- Role policy is evaluated before DNA, and the pre-DNA block cannot be softened.

## Verdict

**PASS (deterministic half).** Both mandatory defects are fixed and independently
re-verified (probe 17/17, L06 12/12, L13 11/11). The surrounding explainability
and audit machinery was already operational; the defects were concrete and are
now regression-tested rather than architectural. The intelligence half remains
NOT_VERIFIED until `CHALLENGE.md` is executed.
