# LAB_CORRECTIONS - measurement errata

Scientific honesty requires that a lab disclose its own errors as loudly as it
reports product defects. Lab v1 produced 5 failed assertions. Independent
re-verification (`harness/probe-independent.mjs`) showed that **2 of the 5 were
the lab's fault**, not the product's.

Scope of this document: what was wrong, why the original oracle was invalid,
the corrected oracle, and the executed evidence. No product requirement was
relaxed.

---

## C-01 - L06 "audit chain detects tampering" (lab defect)

**v1 assertion.** After `initGovernanceLogSink(path)` and two events, mutate a
line in the JSONL file, then call `bos.verifyAuditTrail()` and require
`valid === false`.

**v1 result.** `valid: true` -> reported FAIL with finding "verifyAuditTrail
validates the in-memory chain only".

**Why the oracle was invalid.** The contract is split deliberately and
documented in the code:

- `packages/core/src/governance-log.ts:16-31` states that the in-memory ring
  buffer attests only the retained window, while the durable sink adds
  whole-history verification.
- `BehaviorOS.verifyAuditTrail()` (`behavior-os.ts:1403-1410`) is documented as
  "Verify the in-memory hash chain over the retained events".
- The durable verifier is `verifyGovernanceLogFile(filePath)`
  (`governance-log.ts:416`), and the tool `bos_verify_audit_trail` uses it as
  authoritative when the sink is enabled (`plugins/opencode-v2/src/index.ts:1135-1142`).

The lab called the window verifier and demanded whole-file behaviour. That is a
wrong-surface measurement, not a missing capability.

**Corrected oracle.** Call `verifyGovernanceLogFile(sinkPath)` after tampering.

**Executed evidence** (`artifacts/raw/independent-probe.json`):

| Check                                     | Expected | Observed |
| ----------------------------------------- | -------- | -------- |
| A1 memory chain verifies clean            | true     | true     |
| A2 durable file verifies clean            | true     | true     |
| A3 durable file detects on-disk tampering | false    | false    |

A3's reason is a hash mismatch at the edited seq. **The capability exists and
works.** L06's tamper failure is withdrawn as a product defect and reclassified
as observation O-01 below.

---

## C-02 - L08 "the learned rule changes the verdict to warn" (lab defect)

**v1 assertion.** After learning is applied, an action matching the evolved
`warn` rule must produce verdict `"warn"`.

**v1 result.** `"allow"` with `warnings: ["Warning from rule: evo-warn-failure-deploy_prod"]`
-> reported FAIL.

**Why the oracle was invalid.** `warn` is not a verdict. The verdict union is
`['allow', 'deny', 'escalate', 'transform']`
(`packages/schemas/src/governance.ts:7`). The published contract says a `warn`
rule is advisory and never changes the verdict (`docs/CLAIMS.md`, section on
autonomous evolution: "como `warn` nunca altera o veredicto"). The lab demanded
a value the type system forbids and the documentation denies.

**Corrected oracle.** Learning is observably applied when (a) the rule fires,
(b) the warning is surfaced on the decision, and (c) an unrelated action is
unchanged.

**Executed evidence** (`artifacts/raw/independent-probe.json`):

| Check                                            | Expected | Observed |
| ------------------------------------------------ | -------- | -------- |
| W1 learned warn rule fires                       | true     | true     |
| W2 warning is observable in the decision         | true     | true     |
| W3 verdict stays `allow` per documented contract | "allow"  | "allow"  |

With the corrected oracle, L08's 17 other assertions already pass; the lab moves
to **PASS**, score 92.5. This does **not** weaken the learning claim - it makes
it precise: learning changes governance _output_ (rule set, fired rule,
warnings, reason) at the stage the product implements.

---

## O-01 - facade naming footgun (observation, not a failure)

`BehaviorOS.verifyAuditTrail()` returns `{ valid: true, checked: 2, complete: false }`
for a window it cannot fully attest. That is correct by contract, but the name
invites exactly the mistake this lab made: an operator can read `valid: true`
as "the audit trail is intact".

Recommendation (roadmap R-03): when a durable sink is enabled, the facade should
delegate to `verifyGovernanceLogFile` (durable is authoritative) or be renamed
`verifyAuditTrailWindow`. Independent of the defects, this is a documentation
and API-ergonomics risk in a security-sensitive surface.

---

## Effect on the verdict

| Lab            | v1       | Corrected    | Reason                                          |
| -------------- | -------- | ------------ | ----------------------------------------------- |
| L06 Governance | FAIL (3) | **FAIL (2)** | 2 real defects remain; tamper failure withdrawn |
| L08 Learning   | FAIL (1) | **PASS**     | oracle corrected; learning observably applied   |
| L13 Security   | FAIL (1) | **FAIL (1)** | real defect confirmed independently             |

The product verdict **at the time of this correction** remained **FAIL** because
the two remaining failures were mandatory governance/security gates. Correcting
the lab did not rescue the product; it made the finding accurate.

> **Superseded.** R-01 (G-01) and R-02 (S-01) have since been implemented and
> re-verified: probe 17/17, harness 113/113, L06 and L13 PASS. The current
> verdict is **PARTIAL** only because four LLM-dependent labs are NOT_VERIFIED.
> See `FINAL_AUDIT.md`. This errata file remains as the historical record of the
> oracle corrections (C-01, C-02, O-01).
