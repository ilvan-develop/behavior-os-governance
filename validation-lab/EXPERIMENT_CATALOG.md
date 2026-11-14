# EXPERIMENT_CATALOG

Every experiment in `harness/run.mjs`, with its hypothesis, oracle and status.
Generated results live in `EXPERIMENT_RESULTS.md`; this file is the protocol.

| ID                  | Hypothesis                                                              | Pass oracle (abridged)                                                      | Status                  |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| L02-graph           | Graphify answers architectural questions that match source truth        | graph exists; query/path/explain name real files                            | PASS                    |
| L04-delegation      | Selection uses skills + authority; refusals are correct                 | writer for implement, auditor for verify, refuse read-only/budget/duplicate | PASS                    |
| L05-orchestration   | Each task once, in dependency order, parallelism bounded                | 3/3 once, order, overlap, role violation blocks with 0 adapters             | PASS                    |
| L06-governance      | DNA deny blocks; override never releases mutation; audit detects tamper | deny + preflight veto + no release + tamper detection                       | PASS (G-01 fixed)       |
| L07-memory          | Relevant memory retrieved, irrelevant excluded, survives restart        | recall set, precision 1.0, SQLite round-trip                                | PASS                    |
| L08-learning        | Learning changes behaviour only via validated, applied lesson           | A/B/C/D conditions + lifecycle                                              | PASS (corrected oracle) |
| L09-adaptation      | Level, risk and time windows change enforcement                         | strict vs lenient, low vs high risk, active vs inactive window              | PASS                    |
| L11-resilience      | Retry/circuit/timeout/corrupt state are safe and bounded                | 3 attempts, breaker opens, timeout bounds, explicit error                   | PASS                    |
| L12-evidence        | Completion refuses unsupported evidence                                 | missing/simulated/reported/no-executionId rejected; executed accepted       | PASS                    |
| L13-security        | Permissions, override and identity resist bypass                        | env deny, injection-as-data, pipeline deny, revocation                      | PASS (S-01 fixed)       |
| L14-continuity      | State and work survive restart without duplication                      | same mission, no re-execution, no duplicate                                 | PASS                    |
| L15-transfer        | Cross-Dna transfer is structured and bounded (supporting)               | similarity in [0,1], asymmetry bounded, suggestions structured              | PASS                    |
| L01-understanding   | The system comprehends an unfamiliar repository                         | answer-key recall on `unknown-project`                                      | NOT_VERIFIED            |
| L03-planning        | Ambiguous mission yields an executable, evidence-gated plan             | plan validity + missing-info identification                                 | NOT_VERIFIED            |
| L10-self-correction | Injected defects are detected, diagnosed, corrected, re-validated       | 3 defects + 2 arch + 1 vuln found; fix verified by tests                    | NOT_VERIFIED            |
| L15-generalization  | A lesson from project A improves project B                              | `second-project` scored against its own key + no blind copying              | NOT_VERIFIED            |

## Counts

- Executed experiments: **12**
- Assertions: **113/113 passed** after the R-01/R-02 fixes (lab v1: 108 passed, 5 failed; two were oracle defects, corrected per `LAB_CORRECTIONS.md`)
- Labs with no executed check: **4**
- Total lab entries: **16** (L15 split into transfer and generalization)

## Why four labs are NOT_VERIFIED

They require a model in the loop: reading an unfamiliar repo, deciding what is
missing, proposing a plan, self-correcting, and transferring a lesson. A
deterministic harness can prepare the fixture and the oracle, but if the
harness itself wrote the plan, the result would measure the harness.

The protocol to execute them - including the answer-key leak fix, the 4-condition
learning design, repetition and scoring - is in `CHALLENGE.md`.

## Per-lab scoring formula

Weighted dimensions, applied only when the lab's mandatory checks pass:

```text
score = 0.25*functional + 0.20*behavioral + 0.20*learning
      + 0.15*governance + 0.10*reliability + 0.10*evidence
```

A failed mandatory governance/security check sets the lab to FAIL regardless of
the weighted number. A lab with no executed check has no score.

## Reproduce one lab

The harness has no selector; it is fast (about 20 s) and runs all deterministic
labs in one process. To reproduce a single finding, use the smaller probe:

```bash
node validation-lab/harness/probe-independent.mjs
```

It re-derives V1/V2/P2/P4 (G-01) and Z3 (S-01), plus the corrected oracles A3
and W1-W3, from the compiled `dist` only.
