# Behavior OS - Intelligence Validation Lab

An isolated, reproducible laboratory that tests whether Behavior OS _behaves_
as an intelligent, governed, learning system - not whether its files exist or
its unit tests pass.

Everything here is evidence-bound. The initial audit did not modify production
code. After the audit exposed G-01 and S-01, the human-approved fixes R-01 and
R-02 were applied test-first and re-verified; the results below are post-fix.

## Status (read this first)

| Item                           | Value                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| Repository HEAD                | `b4124ca5` on `main`                                            |
| Working tree                   | dirty (35 entries) - results bind to the recorded `dist` hashes |
| core dist tree SHA-256         | `bb0fe80b845c6c9b...` (whole `dist` tree)                       |
| orchestrator dist tree SHA-256 | `ab8d629929063495...`                                           |
| Node / pnpm / graphify         | v24.21.0 / 10.4.0 / 0.9.107                                     |
| Labs executed                  | 11 deterministic + 4 LLM-dependent (NOT_VERIFIED)               |
| Assertions                     | **113/113 passed**                                              |
| Verdict                        | **PARTIAL**                                                     |

Four labs remain NOT_VERIFIED because they require a model in the loop; the
harness reports PARTIAL while any lab is unverified, by design. The two
mandatory defects found in v1 (G-01 fail-open release, S-01 ineffective
revocation) are fixed and independently re-verified (probe 17/17). The audit is
therefore no longer a FAIL, but it is not a clean pass either - see
`FINAL_AUDIT.md`.

## Reproduce

```bash
# 1. Build the real artifacts the labs import
cmd /c pnpm build

# 2. Run the deterministic lab (does not touch production source)
node validation-lab/harness/run.mjs

# 3. Regenerate the human-readable report from evidence.json
node validation-lab/harness/report.mjs

# 4. Independent auditor probe (re-derives every FAIL from scratch)
node validation-lab/harness/probe-independent.mjs
```

Outputs:

- `artifacts/evidence.json` - one record per assertion (input, expected, actual, artifacts).
- `artifacts/raw/` - raw command and tool output quoted in the reports.
- `EXPERIMENT_RESULTS.md` - generated, never hand-edited.

## Layout

```text
validation-lab/
  harness/run.mjs              deterministic experiment runner (the 11 labs)
  harness/report.mjs           evidence.json -> EXPERIMENT_RESULTS.md
  harness/probe-independent.mjs auditor-written re-verification of every FAIL
  harness/lib.mjs              assertion, hashing, artifacts
  fixtures/unknown-project/    answer-keyed disposable repo (3 defects, 1 vuln, ...)
  fixtures/second-project/     structurally different repo for generalization
  artifacts/                   evidence + raw output + tmp sandboxes
  *.md                         the deliverable set (index below)
```

## Deliverables

| #   | File                           | Question it answers                                |
| --- | ------------------------------ | -------------------------------------------------- |
| 1   | `SYSTEM_INVENTORY.md`          | What exists, integrated, operational?              |
| 2   | `ARCHITECTURE_AUDIT.md`        | Is the architecture sound and honestly documented? |
| 3   | `GRAPH_ENGINEERING_REPORT.md`  | Does graph context improve understanding?          |
| 4   | `TEST_STRATEGY.md`             | How is behaviour, not coverage, measured?          |
| 5   | `EXPERIMENT_CATALOG.md`        | Every experiment, hypothesis and oracle            |
| 6   | `EXPERIMENT_RESULTS.md`        | Executed results (generated)                       |
| 7   | `LEARNING_VALIDATION.md`       | Does learning change future behaviour?             |
| 8   | `DELEGATION_VALIDATION.md`     | Are specialists selected and constrained?          |
| 9   | `GOVERNANCE_VALIDATION.md`     | Is governance enforceable and tamper-evident?      |
| 10  | `OPENCODE_V2_COMPATIBILITY.md` | Is the plugin really V2, not V1?                   |
| 11  | `FAILURE_ANALYSIS.md`          | Root causes, severity, blast radius                |
| 12  | `IMPROVEMENT_ROADMAP.md`       | Smallest fixes, in order                           |
| 13  | `FINAL_AUDIT.md`               | Verdict, scores, limitations                       |
| 14  | `artifacts/evidence.json`      | Machine-readable evidence                          |
| 15  | `fixtures/` + `harness/`       | Reproducible fixtures and scripts                  |

Plus `LAB_CORRECTIONS.md` (measurement errata) and `CHALLENGE.md` (the
Autonomous Software Engineering Challenge protocol).

## Non-negotiable rules of this lab

1. A capability is not operational because its code exists.
2. A lab is not PASS because the suite is green.
3. Missing evidence is NOT_VERIFIED, never PASS.
4. Every FAIL is re-derived by a second, independent probe before it is
   published as a product defect.
5. The lab is not allowed to grade itself: measurement errors are disclosed
   and corrected in the open.
