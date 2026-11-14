# TEST_STRATEGY

## Principle

The unit suite answers "does the code do what the author intended?". This lab
answers "does the system do what the product claims, under adversarial input?".
They are different questions, and the second cannot be inferred from the first.

1497 unit tests pass. Two critical governance defects survived them. That is the
justification for this lab, not an argument against the suite.

## Layers

| Layer                       | What it proves                                 | Where                     |
| --------------------------- | ---------------------------------------------- | ------------------------- |
| Unit / property tests       | local invariants                               | `packages/*/tests`        |
| Conformance harness         | 25 named governance claims                     | `pnpm verify:governance`  |
| Control-plane audit         | 42 config/integration invariants               | `pnpm verify:opencode`    |
| Tool parity                 | hosts cannot diverge on tool names/inputs      | `pnpm verify:tool-parity` |
| **Behavioural lab**         | **observable behaviour vs. oracle**            | `validation-lab/harness`  |
| Model-in-the-loop challenge | autonomous reasoning, learning, generalization | `CHALLENGE.md` (protocol) |

## Oracle design rules

1. **The oracle must come from the published contract**, not from the tester's
   intuition. The L08 `warn` error happened because the assertion contradicted
   `docs/CLAIMS.md` and the schema.
2. **Measure the surface the product exposes for that purpose.** The L06 tamper
   error happened because the test called the window verifier and demanded
   whole-file behaviour.
3. **Every assertion has an expected and an observed value**, serialized into
   `evidence.json`. No prose-only results.
4. **A missing check is not a pass.** Labs without a model in the loop are
   `NOT_VERIFIED` with the exact protocol needed.
5. **Behaviour must be discriminated by ablation.** L08's D condition proves the
   change comes from the learning mechanism, not ambient state.
6. **Adversarial input is mandatory.** Every happy path is paired with a refusal:
   read-only agents, exhausted budget, duplicate reservation, missing evidence,
   simulated evidence, corrupted state, injection payload.

## What each lab must produce

- Fixture or scenario (reproducible, deterministic where possible).
- Hypothesis and measurable pass/fail criteria declared before execution.
- Environment fingerprint (git, dist hashes, tool versions).
- Raw artifacts (JSONL, JSON, command output).
- One evidence record per assertion.
- An independent re-derivation for every FAIL.

## Anti-patterns this lab rejects

| Anti-pattern                         | Why it is rejected                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| "736 tests pass, therefore it works" | G-01 and S-01 both live behind green tests                                               |
| Simulated audit counted as a pass    | L12 proves the product rejects it; the lab must too                                      |
| Mock replacing a missing integration | would report a capability that does not exist                                            |
| Scoring intelligence from coverage   | coverage measures execution, not decisions                                               |
| Self-approval by the implementer     | every FAIL is re-derived by a separate probe                                             |
| Moving the goalposts after a failure | corrections require a _documented contract_ violation, published in `LAB_CORRECTIONS.md` |

## Fixture hygiene

The answer keys (`fixtures/*/ANSWER_KEY.md`) sit next to the fixtures. That is
convenient for the oracle and **dangerous for an agent evaluation**: an agent
given the fixture directory can read the answers.

Before L01/L03/L10/L15 are executed with a model:

1. Copy the fixture to a temp directory.
2. Delete `ANSWER_KEY.md` from the copy.
3. Give the agent only the copy.
4. Score against the key held outside the agent's workspace.

This is recorded as a blocking precondition in `CHALLENGE.md`.

## Determinism and variability

- Deterministic labs are run in-process against `dist`; no network, fixed
  fixtures, explicit budgets.
- LLM-dependent labs must be repeated (the brief suggests N>=3) and reported as a
  distribution, not a single run. A single successful run proves nothing about
  reliability.
- The current lab makes **no** LLM-dependent claims. That is deliberate.

## Definition of a trustworthy lab

The lab is trustworthy when an engineer who distrusts it can run three commands
and get the same failures, with the same raw artifacts, on the same dist hashes -
and when the lab publishes its own mistakes.
