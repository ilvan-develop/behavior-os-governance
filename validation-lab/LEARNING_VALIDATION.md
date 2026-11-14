# LEARNING_VALIDATION

Lab L08 (Learning) and L07 (Memory) and L15 (cross-Dna transfer, supporting).
Corrected oracle documented in `LAB_CORRECTIONS.md` C-02.

## The four conditions actually executed

| Condition            | Setup                                 | Observed                                                                                                                                                          |
| -------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A - baseline         | no prior experience                   | 0 proposals; action `allow`                                                                                                                                       |
| B - memory only      | failures recorded, evolution disabled | experience retrievable (`insights=10`), proposal exists, **0 rules applied**, action `allow`                                                                      |
| C - learning enabled | validated lesson applied              | rule `evo-warn-failure-deploy_prod` applied to the DNA, fires on `deploy_prod`, warning surfaced, verdict `allow` (documented contract), unrelated tool unchanged |
| D - ablation         | evolution disabled                    | 0 applied, behaviour identical to baseline                                                                                                                        |

This is the discriminating result the brief demanded: **memory alone does not
change behaviour** (B), and **only the applied, validated lesson changes
governance output** (C). D shows the change is attributable to the mechanism,
not to ambient state.

## Lifecycle integrity

The learning record enforces a monotonic lifecycle and refuses shortcuts:

| Attempt                                         | Result                        |
| ----------------------------------------------- | ----------------------------- |
| observation -> lesson                           | accepted                      |
| lesson -> validated (skipping candidate)        | rejected `INVALID_TRANSITION` |
| lesson -> candidate                             | accepted                      |
| candidate -> validated without evidence         | rejected `EVIDENCE_REQUIRED`  |
| candidate -> validated with two reproduced runs | accepted                      |

That is the correct shape: a lesson cannot become policy by assertion.

## Memory (L07)

| Check                                        | Observed         |
| -------------------------------------------- | ---------------- |
| relevant learning retrieved from the mission | `learning:lab-1` |
| irrelevant memory excluded                   | precision 1.0    |
| direct recall returns the node               | yes              |
| SQLite round-trip survives close/reopen      | yes              |

The retrieval precision of 1.0 is measured on a deliberately small graph (one
relevant, one irrelevant node). It proves the traversal and exclusion logic; it
does **not** prove precision at scale. Treat 1.0 as a unit-level result, not a
retrieval benchmark.

## What was NOT proven

1. **No LLM in the loop.** The lesson is recorded by the harness; the model is
   not deciding to record it. Autonomous error identification (the "first run
   makes a delegation mistake, the system notices, writes the lesson") is
   **NOT_VERIFIED** - it is L01/L10 territory.
2. **No generalization yet.** Applying the lesson to `fixtures/second-project`
   has not been executed with a model; L15-generalization is NOT_VERIFIED. The
   cross-Dna transfer engine runs (L15-transfer, 3 structured suggestions,
   bounded similarity 0.575 forward / 0.525 backward) but that is a different
   claim: rule transfer, not learned generalization.
3. **No persistence-across-model-sessions proof.** The lesson persists in
   SQLite and in the DNA rule set; whether a _new model session_ discovers and
   applies it is not measured.

## Honest reading

- **Learning mechanism: OPERATIONAL** (validated, evidence-gated, applied,
  observable, ablatable).
- **Autonomous learning: NOT_VERIFIED** (the human/harness supplies the lesson).
- **Generalization: NOT_VERIFIED**.

The distinction matters: the product provides a correct learning _substrate_.
The brief's hardest claim - that the system improves itself without extra
instructions - still needs the model-in-the-loop protocol in `CHALLENGE.md`.
