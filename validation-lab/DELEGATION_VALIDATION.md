# DELEGATION_VALIDATION

Labs L04 (specialist selection) and L05 (delegation and orchestration).
Both are deterministic: they exercise `DelegationEngine` and
`AutonomousOrchestrator` from `packages/orchestrator/dist`.

## L04 - specialist selection (9/9 PASS, score 70.3)

| Scenario                                   | Observed                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| implement task                             | `fixer-1`, role `fixer`, skills matched, load 0.00                     |
| assignment carries a justification         | `load-balancer selected fixer-1 ... required skills match`             |
| verify task                                | `auditor-1`, role `auditor`                                            |
| mutating task with only read-only profiles | refused: `No write-authority agent is eligible for this mutating task` |
| third concurrent task at budget 2          | refused: `Concurrency budget exhausted (2/2)`                          |
| duplicate reservation key                  | refused: `Reservation already held for k1`                             |

The selection is not a black box: every decision carries a reason string. That
is what makes the behaviour auditable.

**Limits (documented in `docs/CLAIMS.md`).** Dispatch inside a mission is
sequential; there is no per-file/scope lock; the role policy is not consulted by
dispatch; the concurrency ledger is in-process, not cross-process.

## L05 - delegation and orchestration (13/13 PASS, score 70)

| Behaviour                        | Evidence                                                      |
| -------------------------------- | ------------------------------------------------------------- |
| mission completes                | `outcome=completed`                                           |
| every task executed exactly once | 3 dispatched / 3 settled                                      |
| dependency order respected       | `["t1","t2","t3"]`                                            |
| specialist task reaches a fixer  | `agentId=fixer-1`                                             |
| executed evidence stamped        | evidence `[1,1,1]`                                            |
| idempotent replay                | same mission id, mission count stays 1                        |
| parallelism                      | two 200ms tasks in 218ms at `maxParallelism=2`                |
| role violation                   | `outcome=blocked`, `AGENT_NOT_FOUND`, **0 adapters executed** |

The role violation case is the important one for the brief's "agent conflict"
requirement: an unknown/invalid agent does not silently run work. It blocks the
mission with zero side effects.

## Failure injection (L11, 8/8 PASS)

| Injection               | Observed                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| adapter always fails    | exactly 3 attempts, task `failed`                                  |
| circuit breaker         | dispatch stops, `CIRCUIT_OPEN`                                     |
| timeout                 | bounded at 168ms, task `failed`                                    |
| corrupted control state | explicit `OrchestratorError: ... not valid JSON`                   |
| resume after restart    | same mission, completed work not re-executed, no duplicate mission |

The at-least-once semantics are explicit: an interrupted `running` task is
resumed, so adapters must honour the idempotency key. That limitation is
published rather than hidden.

## What is not proven

- **Model-driven selection.** The engine selects correctly given skills and
  roles. Whether a model _derives_ the right `requiredSkills` from an ambiguous
  mission is L03/L04-with-LLM and is NOT_VERIFIED.
- **Cross-process concurrency.** The budget ledger is in-process. Two plugin
  hosts would not share it. Not tested, and not claimed.
- **Semantic role inference.** Roles are declared, not inferred from the task
  text.

## Verdict

**PASS with documented limits.** Delegation is deterministic, justified,
fail-closed for write authority, budget-bounded, and safe under injected
failure. It does not yet prove autonomous specialist _reasoning_.
