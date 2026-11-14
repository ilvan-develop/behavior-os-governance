# EXPERIMENT_RESULTS

> Generated from `validation-lab/artifacts/evidence.json` by `harness/report.mjs`.
> Do not edit by hand: rerun `node validation-lab/harness/run.mjs` then this script.

## Environment fingerprint

| Field | Value |
| --- | --- |
| Generated at | 2026-11-14T10:19:58.860Z |
| Branch / HEAD | main / `b4124ca5` (feat(core): per-tool usage telemetry in bos_get_metrics (Fase 3.3)) |
| Dirty working tree | 36 entries |
| Node / pnpm / graphify | v24.21.0 / 10.4.0 / graphify 0.9.107 |
| core dist tree SHA-256 | `bb0fe80b845c6c9b…` |
| orchestrator dist tree SHA-256 | `ab8d629929063495…` |

**Caveat:** The working tree was dirty at audit time. Results bind to the recorded dist hashes, not to uncommitted source files.

## Summary

- Labs: **16** — PASS 12, FAIL 0, ERROR 0, NOT_VERIFIED 4
- Assertions: **113/113** passed, 0 failed
- Verdict: **PARTIAL**

  - Deterministic governance, delegation, orchestration, memory, learning, evidence and continuity paths were executed against the real build.
  - L01, L03, L10 and learned generalization (L15) have no executed LLM-in-the-loop evidence and are therefore NOT_VERIFIED.
  - Missing evidence is reported as NOT_VERIFIED; no lab is awarded 100 from unit-test coverage alone.

| Lab | Name | Status | Score | Checks | Failed |
| --- | --- | --- | --- | --- | --- |
| L02 | Graph Intelligence | PASS | 56 | 8 | 0 |
| L04 | Specialist Selection | PASS | 70.3 | 9 | 0 |
| L05 | Delegation & Orchestration | PASS | 70 | 13 | 0 |
| L06 | Governance | PASS | 74 | 12 | 0 |
| L07 | Memory | PASS | 69 | 5 | 0 |
| L08 | Learning | PASS | 92.5 | 18 | 0 |
| L09 | Adaptability | PASS | 78 | 7 | 0 |
| L11 | Resilience | PASS | 72.5 | 8 | 0 |
| L12 | Truth & Evidence | PASS | 78.3 | 8 | 0 |
| L13 | Security (deterministic half) | PASS | 66.8 | 11 | 0 |
| L14 | Continuity | PASS | 69 | 10 | 0 |
| L01 | Understanding an unfamiliar repository | NOT_VERIFIED | — | 0 | 0 |
| L03 | Autonomous planning from an ambiguous mission | NOT_VERIFIED | — | 0 | 0 |
| L10 | Self-correction of introduced defects | NOT_VERIFIED | — | 0 | 0 |
| L15 | Applying a learned lesson to an unseen project | NOT_VERIFIED | — | 0 | 0 |

### Dimension scores (audit judgement backed by the checks below)

| Lab | Functional 25% | Behavioral 20% | Learning 20% | Governance 15% | Reliability 10% | Evidence 10% |
| --- | --- | --- | --- | --- | --- | --- |
| L02 | 90 | 80 | 0 | 0 | 80 | 95 |
| L04 | 95 | 90 | 0 | 70 | 85 | 95 |
| L05 | 90 | 90 | 0 | 80 | 85 | 90 |
| L06 | 95 | 90 | 0 | 95 | 85 | 95 |
| L07 | 90 | 85 | 60 | 0 | 85 | 90 |
| L08 | 95 | 95 | 95 | 85 | 85 | 95 |
| L09 | 90 | 85 | 50 | 80 | 80 | 85 |
| L11 | 90 | 85 | 30 | 60 | 90 | 90 |
| L12 | 95 | 95 | 20 | 90 | 85 | 95 |
| L13 | 85 | 80 | 0 | 90 | 75 | 85 |
| L14 | 90 | 85 | 20 | 50 | 90 | 90 |
| L01 | — | — | — | — | — | — |
| L03 | — | — | — | — | — | — |
| L10 | — | — | — | — | — | — |
| L15 | — | — | — | — | — | — |

## Experiments

### L02-graph — Graph intelligence vs. source ground truth

- **Lab:** L02
- **Status:** PASS
- **Duration:** 9296 ms
- **Hypothesis:** Graphify answers architectural questions with relationships that match the source tree, so impact analysis can be grounded instead of guessed.

**Pass criteria**

- graphify-out/graph.json exists with a non-trivial node/edge count
- graphify query returns a scoped answer that names the real defining file
- graphify path connects two real kernel entities

**Fail criteria**

- graph.json missing
- query returns empty/unrelated output
- path cannot connect the entities

**Metrics**

| Metric | Value |
| --- | --- |
| graphNodes | 3869 |
| graphEdges | 7549 |

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | graph artifact exists with >100 nodes | nodeCount=3869 |
| PASS | graph artifact has edges | edgeCount=7549 |
| PASS | query-evaluateGovernance: non-empty scoped output | length=9661; preview="Graph: graphify-out/graph.json (3869 nodes) \| Traversal: BFS depth=2 \| Start: ['.evaluateGovernance()', 'DEFAULT_RATE_LIMIT_MAX_CALLS'] \| Context: call (heuristic) \| 35 nodes found\r\n\r\n[i] Complete answer over budget: all 35 nodes and 43 edges shown (~3018 tokens vs the requested ~2000-token budget)." |
| PASS | query-governance-engine: non-empty scoped output | length=6478; preview="Graph: graphify-out/graph.json (3869 nodes) \| Traversal: BFS depth=2 \| Start: ['GovernanceEngine'] \| 88 nodes found\r\n\r\n[!] TRUNCATED: showing 54 of 88 nodes (~2000-token budget). The answer may be among the 34 cut nodes — raise the token budget to 3289 to get all 88 (CLI: --budget 3289, MCP: token_b" |
| PASS | explain-behavioros: non-empty scoped output | length=3585; preview="Node: BehaviorOS\r\n  ID:        packages_core_src_engine_behavior_os_behavioros\r\n  Source:    packages/core/src/engine/behavior-os.ts L112\r\n  Type:      code\r\n  Community: BehaviorOS\r\n  Lesson: preferred source (start here) — 3 useful, score=2.999980862 [code changed since — re-verify]\r\n  Degree:    " |
| PASS | path connects BehaviorOS to GovernanceEngine | preview="Shortest path (3 hops):\r\n  BehaviorOS --method [EXTRACTED]--> .constructor() --calls [INFERRED 0.85]--> .createGovernanceEngine() --references [EXTRACTED]--> GovernanceEngine\r\nPath confidence: INFERRED (weakest hop 2: calls, score 0.85) (weakest of 6 equal-length routes)\r\n" |
| PASS | ground truth: evaluateGovernance is defined in behavior-os.ts |  |
| PASS | graph answer names the real file | preview="Graph: graphify-out/graph.json (3869 nodes) \| Traversal: BFS depth=2 \| Start: ['.evaluateGovernance()', 'DEFAULT_RATE_LIMIT_MAX_CALLS'] \| Context: call (heuristic) \| 35 nodes found\r\n\r\n[i] Complete answer over budget: all 35 nodes and 43 edges shown (~3018 tokens vs the requested ~2000-token budget)." |

**Artifacts**

- `artifacts/raw/L02-graph-graph-stats.json`
- `artifacts/raw/L02-graph-query-evaluateGovernance.txt`
- `artifacts/raw/L02-graph-query-governance-engine.txt`
- `artifacts/raw/L02-graph-explain-behavioros.txt`
- `artifacts/raw/L02-graph-path-behavioros-governance.txt`

### L04-delegation — Specialist selection under skills, authority and concurrency

- **Lab:** L04
- **Status:** PASS
- **Duration:** 1 ms
- **Hypothesis:** The delegation engine selects an agent by required skill and authority, refuses mutating work for read-only roles, and never exceeds the concurrency budget.

**Pass criteria**

- implement task -> writer with the implement skill
- verify task -> auditor with the verify skill
- mutating task with only read-only profiles -> refusal
- budget exhausted -> refusal
- duplicate reservation key -> refusal

**Fail criteria**

- a read-only agent receives a mutating task
- budget is exceeded
- duplicate work is reserved

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | implement task assigned | assignment={"taskId":"impl","agentId":"fixer-1","role":"fixer","reason":"load-balancer selected fixer-1 (Selected agent fixer-1 with load 0.00 and required skills match)","recommendedBy":"load-balancer"} |
| PASS | implement task goes to fixer-1 | assignment={"taskId":"impl","agentId":"fixer-1","role":"fixer","reason":"load-balancer selected fixer-1 (Selected agent fixer-1 with load 0.00 and required skills match)","recommendedBy":"load-balancer"} |
| PASS | assignment carries a reason | reason="load-balancer selected fixer-1 (Selected agent fixer-1 with load 0.00 and required skills match)" |
| PASS | verify task goes to the auditor | assignment={"taskId":"verify","agentId":"auditor-1","role":"auditor","reason":"load-balancer selected auditor-1 (Selected agent auditor-1 with load 0.00 and required skills match)","recommendedBy":"load-balancer"} |
| PASS | mutating task refused when only read-only agents exist | assignment={"taskId":"mutate","agentId":null,"role":null,"reason":"No write-authority agent is eligible for this mutating task","recommendedBy":"none"} |
| PASS | refusal explains the reason | reason="No write-authority agent is eligible for this mutating task" |
| PASS | concurrency budget is enforced | assignment={"taskId":"extra","agentId":null,"role":null,"reason":"Concurrency budget exhausted (2/2)","recommendedBy":"none"} |
| PASS | first reservation succeeds | assignment={"taskId":"r1","agentId":"fixer-1","role":"fixer","reason":"load-balancer selected fixer-1 (Selected agent fixer-1 with load 0.00 and required skills match)","recommendedBy":"load-balancer"} |
| PASS | duplicate reservation is refused | assignment={"taskId":"r1b","agentId":null,"role":null,"reason":"Reservation already held for k1","recommendedBy":"none"} |

### L05-orchestration — Mission dispatch: dependencies, idempotency, parallelism, role violations

- **Lab:** L05
- **Status:** PASS
- **Duration:** 249 ms
- **Hypothesis:** The orchestrator executes each task once, never before its dependency, replays idempotent missions, runs independent tasks concurrently, and blocks role violations.

**Pass criteria**

- every task completes exactly once
- dependent task starts after its dependency
- same idempotency key returns the same mission with no duplicate execution
- independent tasks overlap under maxParallelism=2
- mutating task blocked when delegation has no writer

**Fail criteria**

- duplicate execution
- dependency violated
- concurrency ignored
- role violation dispatched

**Metrics**

| Metric | Value |
| --- | --- |
| parallelElapsedMs | 215 |

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | mission completed | outcome="completed" |
| PASS | three tasks settled | expected=3; actual=3 |
| PASS | every task completed | statuses=["t1:completed","t2:completed","t3:completed"] |
| PASS | each task executed exactly once | expected=3; actual=3 |
| PASS | dependency order respected | order=["t1","t2","t3"] |
| PASS | specialist task delegated to a fixer | agentId="fixer-1" |
| PASS | executed evidence stamped | evidence=[1,1,1] |
| PASS | idempotent replay returns the same mission | first="mission-1794651610908-c06xxb7r04"; second="mission-1794651610908-c06xxb7r04" |
| PASS | idempotent replay does not create a mission | expected=1; actual=1 |
| PASS | parallel tasks completed | outcome="completed" |
| PASS | two 200ms tasks overlap under maxParallelism=2 | elapsed=215 |
| PASS | role violation is not dispatched as a success | outcome="blocked"; taskStatus="blocked"; error="AGENT_NOT_FOUND" |
| PASS | role violation executes zero adapters | expected=0; actual=0 |

### L06-governance — Governance blocks prohibited operations and keeps a tamper-evident trail

- **Lab:** L06
- **Status:** PASS
- **Duration:** 33 ms
- **Hypothesis:** A real DNA rule turns a prohibited action into a deny, the pre-flight veto blocks it, the deny-override never releases a mutating action, and the audit chain detects tampering.

**Pass criteria**

- benign action allowed
- sensitive action denied by the DNA rule
- preflight vetoes the denied action
- deny override is false for a mutating action and true for a read-only action
- lenient level softens a DNA deny to escalate
- audit chain verifies clean and fails after tampering

**Fail criteria**

- prohibited action allowed
- preflight allows it
- override releases a mutating action
- tampering undetected

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | benign action verdict | expected="allow"; actual="allow" |
| PASS | sensitive action verdict | expected="deny"; actual="deny" |
| PASS | deny cites the fired rule | firedRules=["data-protection"] |
| PASS | preflight blocks a denied mutating action | expected=false; actual=false |
| PASS | preflight allows the benign action | expected=true; actual=true |
| PASS | preflight releases a denied export (observed mutation-vocabulary gap) | expected=false; actual=false; finding="MUTATING_ACTION does not include export/send/transmit, so bootstrapDenyOverride releases the DNA block" |
| PASS | override refuses to release a mutating action (git push) | expected=false; actual=false |
| PASS | override releases a read-only action | expected=true; actual=true |
| PASS | lenient softens DNA deny to escalate | expected="escalate"; actual="escalate" |
| PASS | softening is explained in the reason | reason="Blocked by rule: data-protection (Block unauthorized PII access) (softened by lenient governance level)" |
| PASS | audit chain verifies clean | verification={"valid":true,"checked":2,"complete":true} |
| PASS | audit chain detects tampering | verification={"valid":false,"checked":0,"complete":false,"brokenAt":1,"reason":"hash mismatch at seq 1"} |

**Artifacts**

- `artifacts/raw/L06-governance-tampered-audit-log.jsonl`

### L07-memory — Relevant memory is retrieved and irrelevant memory excluded

- **Lab:** L07
- **Status:** PASS
- **Duration:** 162 ms
- **Hypothesis:** Persistent memory stores evidence-linked experiences, recall returns the relevant neighbourhood, excludes unrelated nodes, and survives a process restart with SQLite.

**Pass criteria**

- recall from the mission returns the linked learning
- unrelated memory is excluded (precision 1.0)
- direct recall returns the node
- SQLite round-trip survives close/reopen

**Fail criteria**

- relevant memory missing
- irrelevant memory returned
- persistence lost

**Metrics**

| Metric | Value |
| --- | --- |
| recalledIds | learning:lab-1,learning:lab-1 |
| retrievalPrecision | 1 |

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | relevant learning retrieved | ids=["learning:lab-1","learning:lab-1"] |
| PASS | irrelevant memory excluded | ids=["learning:lab-1","learning:lab-1"] |
| PASS | retrieval precision is 1.0 | ids=["learning:lab-1","learning:lab-1"] |
| PASS | direct recall returns the node | direct={"id":"learning:lab-1","type":"learning","label":"Delegation failure lesson","updatedAt":"2026-11-14T10:20:11.184Z"} |
| PASS | SQLite memory survives reopen | remembered={"id":"learning:persisted","type":"learning","label":"Persisted lesson"} |

**Artifacts**

- `artifacts/raw/L07-memory-recall-relevant.json`

### L08-learning — Learning changes future governance only through a validated, applied lesson

- **Lab:** L08
- **Status:** PASS
- **Duration:** 12 ms
- **Hypothesis:** Repeated failures are remembered (B), and only when a validated lesson is converted into an applied rule (C) does a later, differently-worded action change verdict; disabling the mechanism (D) leaves behaviour unchanged.

**Pass criteria**

- A baseline: no experience -> no proposal, action allowed
- B memory only: experience retrievable and a proposal exists, action still allowed
- C learning enabled: rule applied, the deploy_prod tool call fires an advisory warning (verdict stays allow), an unrelated tool call is still allowed
- D ablation: disabled evolution applies nothing and behaviour stays baseline
- learning lifecycle rejects stage skipping and validation without evidence

**Fail criteria**

- memory alone changes behaviour
- no observable behaviour change in C
- ablation still changes behaviour
- unvalidated learning becomes policy

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | A: no proposals without experience | expected=0; actual=0 |
| PASS | A: baseline action allowed | expected="allow"; actual="allow" |
| PASS | B: experience is retrievable | insights=10 |
| PASS | B: a lesson candidate exists | proposals=["evo-warn-failure-deploy_prod"] |
| PASS | B: memory alone applies nothing (evolution disabled) | expected=0; actual=0 |
| PASS | B: memory alone does not change behaviour | expected="allow"; actual="allow" |
| PASS | C: proposals produced | proposals=["evo-warn-failure-deploy_prod"] |
| PASS | C: evolution applied a rule | applied=["evo-warn-failure-deploy_prod"] |
| PASS | C: DNA now contains the learned rule | dnaRules=["evo-warn-failure-deploy_prod"] |
| PASS | C: the learned rule fires as an advisory warning (verdict stays allow) | firedRules=["evo-warn-failure-deploy_prod"]; warnings=["Warning from rule: evo-warn-failure-deploy_prod"]; verdict="allow" |
| PASS | C: an unrelated tool is still allowed | expected="allow"; actual="allow" |
| PASS | D: ablation applies nothing | expected=0; actual=0 |
| PASS | D: ablation stays baseline | expected="allow"; actual="allow" |
| PASS | lifecycle: observation -> lesson accepted | result={"ok":true,"record":{"id":"learn-rec-1794651611356-lilplvmbd3o","stage":"lesson","title":"Deploy timeouts recur","content":"deploy_prod times out before health checks when parallelism is high","source":"tool:deploy_prod","impact":"high","evidence":[],"transitions":[{"from":"observation","to":"lesson","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"observed twice"}],"createdAt":"2026-11-14T10:20:11.356Z","updatedAt":"2026-11-14T10:20:11.357Z"}} |
| PASS | lifecycle: stage skipping rejected | result={"ok":false,"code":"INVALID_TRANSITION","message":"Cannot move learning learn-rec-1794651611356-lilplvmbd3o from \"lesson\" to \"validated\"; the next stage is \"candidate\""} |
| PASS | lifecycle: candidate accepted | result={"ok":true,"record":{"id":"learn-rec-1794651611356-lilplvmbd3o","stage":"candidate","title":"Deploy timeouts recur","content":"deploy_prod times out before health checks when parallelism is high","source":"tool:deploy_prod","impact":"high","evidence":[],"transitions":[{"from":"observation","to":"lesson","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"observed twice"},{"from":"lesson","to":"candidate","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"proposal"}],"createdAt":"2026-11-14T10:20:11.356Z","updatedAt":"2026-11-14T10:20:11.357Z"}} |
| PASS | lifecycle: validation without evidence rejected | result={"ok":false,"code":"EVIDENCE_REQUIRED","message":"Promotion to \"validated\" requires at least one evidence entry"} |
| PASS | lifecycle: validation with evidence accepted | result={"ok":true,"record":{"id":"learn-rec-1794651611356-lilplvmbd3o","stage":"validated","title":"Deploy timeouts recur","content":"deploy_prod times out before health checks when parallelism is high","source":"tool:deploy_prod","impact":"high","evidence":["run-1 exit=1 stderr=timeout","run-2 exit=1 stderr=timeout"],"transitions":[{"from":"observation","to":"lesson","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"observed twice"},{"from":"lesson","to":"candidate","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"proposal"},{"from":"candidate","to":"validated","at":"2026-11-14T10:20:11.357Z","actor":"system","reason":"two controlled runs reproduced the failure"}],"createdAt":"2026-11-14T10:20:11.356Z","updatedAt":"2026-11-14T10:20:11.357Z"}} |

### L09-adaptation — Adaptation to governance level, risk context and time windows

- **Lab:** L09
- **Status:** PASS
- **Duration:** 15 ms
- **Hypothesis:** The same engine adapts its enforcement to a configured governance level, to a derived risk profile, and to an explicit temporal window, without silently dropping the rule.

**Pass criteria**

- lenient level softens a DNA deny to escalate
- high-risk context produces stricter thresholds than low-risk
- a temporal rule is active inside its window and inactive outside it

**Fail criteria**

- configuration ignored
- risk levels identical
- temporal window ignored

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | strict level denies | expected="deny"; actual="deny" |
| PASS | lenient level escalates instead | expected="escalate"; actual="escalate" |
| PASS | risk levels differ | low="low"; high="critical" |
| PASS | high-risk score is higher | low=0; high=1 |
| PASS | high-risk policy has a stricter multiplier | low=0.75; high=2 |
| PASS | temporal rule active inside window | inside={"activeRules":[{"isActive":true,"rule":{"id":"temporal-protected-block","level":"critical","action":"block","conditions":[{"type":"pii-access","value":true}],"description":"Temporary block during an audit window"}}],"inactiveRules":[],"recommendations":[{"action":"block","ruleId":"temporal-protected-block","reason":"Temporary block during an audit window"}]} |
| PASS | temporal rule inactive outside window | outside={"activeRules":[],"inactiveRules":[{"isActive":false,"inactiveReason":"Past end time 2026-11-14T11:20:11.367Z"}],"recommendations":[]} |

**Artifacts**

- `artifacts/raw/L09-adaptation-risk-assessments.json`
- `artifacts/raw/L09-adaptation-temporal.json`

### L11-resilience — Retries, circuit breaker, timeout and corrupted control state

- **Lab:** L11
- **Status:** PASS
- **Duration:** 185 ms
- **Hypothesis:** Bounded retries stop at the configured attempt, the circuit opens after repeated failures and prevents further dispatch, a timeout terminates the task safely, and corrupted control state never causes duplicate execution.

**Pass criteria**

- maxAttempts=3 -> exactly 3 adapter calls
- circuit opens after the threshold and blocks the next dispatch
- timeout fails the task within a bounded time
- corrupted control state is reported, not executed blindly

**Fail criteria**

- unbounded retries
- circuit stays closed
- timeout hangs
- corrupted state silently resumed

**Metrics**

| Metric | Value |
| --- | --- |
| retryCalls | 3 |
| circuitCalls | 2 |
| timeoutElapsedMs | 174 |

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | retries bounded to 3 attempts | expected=3; actual=3 |
| PASS | adapter called exactly 3 times | expected=3; actual=3 |
| PASS | task failed after retries | expected="failed"; actual="failed" |
| PASS | dispatch stops once the circuit is open | calls=2; expected=2 |
| PASS | blocked mission reports an error | outcome="blocked"; code="CIRCUIT_OPEN" |
| PASS | timeout bounded the run | elapsed=174 |
| PASS | timed-out task failed | expected="failed"; actual="failed" |
| PASS | corrupted state is surfaced (null or explicit error) | observed="OrchestratorError: Control-loop state is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)" |

### L12-evidence — Completion refuses missing, simulated, reported and malformed evidence

- **Lab:** L12
- **Status:** PASS
- **Duration:** 12 ms
- **Hypothesis:** A mission configured for executed verification cannot complete on absent, simulated, reported or executionId-less evidence; a simulated audit never reports a pass.

**Pass criteria**

- no evidence -> EVIDENCE_MISSING
- simulated evidence -> EVIDENCE_SIMULATED
- reported evidence -> EVIDENCE_UNVERIFIED
- executed without executionId -> EVIDENCE_INVALID
- executed with executionId -> completed
- simulated audit is marked simulated/warning

**Fail criteria**

- unsupported success accepted
- simulated audit reports pass

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | no evidence is rejected | result={"ok":false,"code":"EVIDENCE_MISSING","message":"Missing evidence for required gate \"tests\"","mission":{"id":"mission-1794651611558-5wcdw5xmayx","title":"Evidence gate mission","type":"feature","priority":"high","requiredChecks":["tests"],"verificationMode":"executed","dnaPattern":"Lab DNA","createdBy":"system","status":"completed","createdAt":"2026-11-14T10:20:11.558Z","updatedAt":"2026-11-14T10:20:11.559Z","progress":100,"version":2,"evidence":[{"gate":"tests","status":"passed","source":"validation-lab","provenance":"executed","executionId":"exec-1794651611559","command":"node validation-lab/harness/run.mjs","exitCode":0,"recordedAt":"2026-11-14T10:20:11.559Z"}],"transitions":[{"from":"pending","to":"active","at":"2026-11-14T10:20:11.559Z","actor":"system","version":1},{"from":"active","to":"completed","at":"2026-11-14T10:20:11.559Z","actor":"system","version":2}],"completionBasis":"evidence"},"from":"active","to":"completed"} |
| PASS | simulated evidence is rejected | result={"ok":false,"code":"EVIDENCE_SIMULATED","message":"Evidence for required gate \"tests\" is simulated and cannot authorize completion","mission":{"id":"mission-1794651611558-5wcdw5xmayx","title":"Evidence gate mission","type":"feature","priority":"high","requiredChecks":["tests"],"verificationMode":"executed","dnaPattern":"Lab DNA","createdBy":"system","status":"completed","createdAt":"2026-11-14T10:20:11.558Z","updatedAt":"2026-11-14T10:20:11.559Z","progress":100,"version":2,"evidence":[{"gate":"tests","status":"passed","source":"validation-lab","provenance":"executed","executionId":"exec-1794651611559","command":"node validation-lab/harness/run.mjs","exitCode":0,"recordedAt":"2026-11-14T10:20:11.559Z"}],"transitions":[{"from":"pending","to":"active","at":"2026-11-14T10:20:11.559Z","actor":"system","version":1},{"from":"active","to":"completed","at":"2026-11-14T10:20:11.559Z","actor":"system","version":2}],"completionBasis":"evidence"},"from":"active","to":"completed"} |
| PASS | reported evidence is rejected | result={"ok":false,"code":"EVIDENCE_UNVERIFIED","message":"Evidence for required gate \"tests\" is not executed (provenance \"reported\"); executed verification requires provenance \"executed\" and an executionId","mission":{"id":"mission-1794651611558-5wcdw5xmayx","title":"Evidence gate mission","type":"feature","priority":"high","requiredChecks":["tests"],"verificationMode":"executed","dnaPattern":"Lab DNA","createdBy":"system","status":"completed","createdAt":"2026-11-14T10:20:11.558Z","updatedAt":"2026-11-14T10:20:11.559Z","progress":100,"version":2,"evidence":[{"gate":"tests","status":"passed","source":"validation-lab","provenance":"executed","executionId":"exec-1794651611559","command":"node validation-lab/harness/run.mjs","exitCode":0,"recordedAt":"2026-11-14T10:20:11.559Z"}],"transitions":[{"from":"pending","to":"active","at":"2026-11-14T10:20:11.559Z","actor":"system","version":1},{"from":"active","to":"completed","at":"2026-11-14T10:20:11.559Z","actor":"system","version":2}],"completionBasis":"evidence"},"from":"active","to":"completed"} |
| PASS | executed evidence without executionId is rejected | result={"ok":false,"code":"EVIDENCE_INVALID","message":"Evidence for gate \"tests\" claims provenance \"executed\" without an executionId","mission":{"id":"mission-1794651611558-5wcdw5xmayx","title":"Evidence gate mission","type":"feature","priority":"high","requiredChecks":["tests"],"verificationMode":"executed","dnaPattern":"Lab DNA","createdBy":"system","status":"completed","createdAt":"2026-11-14T10:20:11.558Z","updatedAt":"2026-11-14T10:20:11.559Z","progress":100,"version":2,"evidence":[{"gate":"tests","status":"passed","source":"validation-lab","provenance":"executed","executionId":"exec-1794651611559","command":"node validation-lab/harness/run.mjs","exitCode":0,"recordedAt":"2026-11-14T10:20:11.559Z"}],"transitions":[{"from":"pending","to":"active","at":"2026-11-14T10:20:11.559Z","actor":"system","version":1},{"from":"active","to":"completed","at":"2026-11-14T10:20:11.559Z","actor":"system","version":2}],"completionBasis":"evidence"},"from":"active","to":"completed"} |
| PASS | executed evidence with executionId completes the mission | result={"ok":true,"changed":true,"mission":{"id":"mission-1794651611558-5wcdw5xmayx","title":"Evidence gate mission","type":"feature","priority":"high","requiredChecks":["tests"],"verificationMode":"executed","dnaPattern":"Lab DNA","createdBy":"system","status":"completed","createdAt":"2026-11-14T10:20:11.558Z","updatedAt":"2026-11-14T10:20:11.559Z","progress":100,"version":2,"evidence":[{"gate":"tests","status":"passed","source":"validation-lab","provenance":"executed","executionId":"exec-1794651611559","command":"node validation-lab/harness/run.mjs","exitCode":0,"recordedAt":"2026-11-14T10:20:11.559Z"}],"transitions":[{"from":"pending","to":"active","at":"2026-11-14T10:20:11.559Z","actor":"system","version":1},{"from":"active","to":"completed","at":"2026-11-14T10:20:11.559Z","actor":"system","version":2}],"completionBasis":"evidence"}} |
| PASS | mission is completed | expected="completed"; actual="completed" |
| PASS | simulated audit is marked simulated | simulated=true |
| PASS | simulated audit never claims a pass | expected="warning"; actual="warning" |

**Artifacts**

- `artifacts/raw/L12-evidence-simulated-audit.json`

### L13-security — Permissions, deny-override and identity controls resist bypass

- **Lab:** L13
- **Status:** PASS
- **Duration:** 21 ms
- **Hypothesis:** Secrets are denied by configuration, the DNA deny cannot be overridden for a mutating action, a prompt-injection payload stays data, and revoked identities lose capabilities.

**Pass criteria**

- opencode permissions deny .env reads and ask before git push
- a mutating injected action stays denied after the override hook
- zero-trust revocation removes the capability

**Fail criteria**

- .env readable
- override releases the injected action
- revoked identity keeps capability

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | permissions deny *.env reads |  |
| PASS | permissions deny *.env.* reads |  |
| PASS | permissions allow *.env.example |  |
| PASS | permissions ask before git push |  |
| PASS | fixture contains the injected instruction |  |
| PASS | payload is treated as data, not executed by the harness |  |
| PASS | unauthorized pipeline change denied | expected="deny"; actual="deny" |
| PASS | override cannot release the mutating action |  |
| PASS | identity issued | identity={"agentId":"agent-security-probe","did":"did:bos:48a0709d-25d6-44a8-8769-66a452590922","publicKeyHash":"8ae23110fb0fcd72b4ac2ac8bf3d154e353c39d635ca3665584ab54918408fb6","capabilities":["read"],"issuedAt":"2026-11-14T10:20:11.589Z","expiresAt":null,"revokedAt":"2026-11-14T10:20:11.589Z"} |
| PASS | capability granted |  |
| PASS | revocation removes the capability | expected=false; actual=false; finding="zero-trust revocation marks the identity revoked, but hasCapability still returns true" |

**Artifacts**

- `artifacts/raw/L13-security-injection-payload.txt`

### L14-continuity — State and work survive a restart without duplication

- **Lab:** L14
- **Status:** PASS
- **Duration:** 229 ms
- **Hypothesis:** A snapshot restores agents and missions, SQLite restores a mission across processes, and a persisted control loop resumes the same mission without re-executing completed work.

**Pass criteria**

- snapshot import restores the agent and mission
- SQLite restores the mission after close/reopen
- control loop resume keeps the same missionId and executes no task twice

**Fail criteria**

- state lost
- duplicate mission or duplicate execution

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | snapshot import succeeds | imported=true |
| PASS | agent restored | agent={"id":"agent-x","dnaPattern":"Lab DNA","capabilities":["execute"],"authority":"write"} |
| PASS | mission restored | mission={"id":"mission-1794651611591-za8fcehok2","title":"Continuity mission","type":"feature","priority":"low","dnaPattern":"Lab DNA","createdBy":"system","status":"pending","createdAt":"2026-11-14T10:20:11.591Z","updatedAt":"2026-11-14T10:20:11.591Z","progress":0,"version":0,"verificationMode":"any","requiredChecks":[],"evidence":[],"transitions":[]} |
| PASS | SQLite mission survives reopen | mission={"id":"mission-1794651611723-vvsy1tlprmm","title":"SQLite continuity mission","type":"feature","priority":"low","dnaPattern":"Lab DNA","createdBy":"system","status":"pending","createdAt":"2026-11-14T10:20:11.723Z","updatedAt":"2026-11-14T10:20:11.723Z","progress":0,"version":0,"verificationMode":"any","requiredChecks":[],"evidence":[],"transitions":[]} |
| PASS | first control run reaches a terminal state | status="blocked" |
| PASS | control run persisted a mission | missionId="mission-1794651611762-60r3o8ijfs3" |
| PASS | task executed once on first run | expected=1; actual=1 |
| PASS | resume keeps the same mission | first="mission-1794651611762-60r3o8ijfs3"; resumed="mission-1794651611762-60r3o8ijfs3" |
| PASS | resume does not re-execute completed work | expected=1; actual=1 |
| PASS | no duplicate mission created on resume | missions=["Durable control loop"] |

**Artifacts**

- `artifacts/raw/L14-continuity-control-state-1.json`

### L15-transfer — Cross-domain rule transfer (supporting evidence only)

- **Lab:** L15
- **Status:** PASS
- **Duration:** 7 ms
- **Hypothesis:** The transfer engine computes a bounded similarity between DNA patterns from different domains and proposes rule transfers; this is a component of generalization, not proof that a learned lesson generalizes.

**Pass criteria**

- similarity is bounded to [0,1] in both directions
- directional asymmetry is bounded (|forward - backward| <= 0.1) and reported as a metric
- transfer suggestions are produced as data

**Fail criteria**

- similarity out of bounds
- transfer engine throws

**Metrics**

| Metric | Value |
| --- | --- |
| similarityForward | 0.575 |
| similarityBackward | 0.5249999999999999 |
| similarityDelta | 0.05 |

**Checks**

| Result | Check | Details |
| --- | --- | --- |
| PASS | forward similarity bounded to [0,1] | forward=0.575 |
| PASS | backward similarity bounded to [0,1] | backward=0.5249999999999999 |
| PASS | directional asymmetry stays bounded | forward=0.575; backward=0.5249999999999999; delta=0.050000000000000044 |
| PASS | transfer engine returns structured suggestions | count=3 |

**Notes**

- computeSimilarity is directional (mean source-rule coverage), so forward and backward differ; the observed delta is recorded as a metric.

**Artifacts**

- `artifacts/raw/L15-transfer-cross-domain-transfer.json`

## Not verified

### L01-understanding — undefined

- **Status:** NOT_VERIFIED
- **Hypothesis:** The system reads an unknown project and reports its architecture and dependencies accurately.
- **Why it cannot be verified deterministically:** Behavior-OS exposes structural graph queries, but "understanding" is produced by a model in the loop. No deterministic engine can be asserted as the author of the explanation.
- **Protocol to verify:** Run the fixture validation-lab/fixtures/unknown-project with a frozen prompt, score the answer against the fixture answer key, and repeat 3 times to report variability.

### L03-planning — undefined

- **Status:** NOT_VERIFIED
- **Hypothesis:** The system asks for missing information and produces an executable plan with gates and owners.
- **Why it cannot be verified deterministically:** Plan synthesis is LLM-dependent. Deterministic pipeline planners exist but do not constitute autonomous planning.
- **Protocol to verify:** Submit the ambiguous mission fixture to the planner agent 3 times and diff task graphs against the answer key.

### L10-self-correction — undefined

- **Status:** NOT_VERIFIED
- **Hypothesis:** The system finds seeded defects, diagnoses them and validates its own fix independently.
- **Why it cannot be verified deterministically:** Detection and repair are LLM/agent behaviours. The deterministic anti-pattern and code-fix engines are components, not proof of self-correction.
- **Protocol to verify:** Seed the fixtures, run three independent fix attempts, and require an independent reviewer agent to accept the diff before scoring.

### L15-generalization — undefined

- **Status:** NOT_VERIFIED
- **Hypothesis:** A validated lesson changes behaviour on a second, structurally different project without copying the first solution.
- **Why it cannot be verified deterministically:** The deterministic transfer engine only transfers governance-rule signatures. Learned behavioural generalization requires the LLM loop and a controlled A/B run.
- **Protocol to verify:** Use fixtures/unknown-project then fixtures/second-project with the same lesson, compare decisions with and without the lesson, and report the ablation.

## Scoring rule

A lab is scored 0–100 only from executed checks across functional correctness (25%),
behavioral consistency (20%), learning and adaptability (20%), governance and security
(15%), reliability and recovery (10%) and evidence and reproducibility (10%).
Missing evidence is NOT_VERIFIED, never PASS. A failed governance or security
assertion cannot be compensated by a high weighted average.

