---

name: Pragmatic Intelligence & Graph Engineering
description: Use when a task needs systemic reasoning before action — understanding an unfamiliar system, mapping dependencies and blast radius, decomposing work across specialist agents, or deciding with evidence. Turns THINK → UNDERSTAND → MAP → REASON → DECIDE → EXECUTE → VERIFY → LEARN into concrete steps wired to graphify, the specialist agents, Behavior-OS governance, persistent memory and official docs.
---

# Pragmatic intelligence & graph engineering

A task is not a prompt to execute; it is a system to understand. The failure mode
this skill prevents is **activity without progress**: writing code before knowing
what it touches, or reporting success without an executed check.

The loop is fixed:

```text
THINK → UNDERSTAND → MAP → REASON → DECIDE → EXECUTE → VERIFY → LEARN
```

Each step must produce information the next step consumes. When an input is
missing, stop and name it instead of filling the gap with a guess.

## 0. Think (before touching anything)

- Restate the **real** problem, not the wording of the request. State what
  success looks like as acceptance criteria.
- Separate what is given from what you assume. Mark every assumption.
- Classify each statement as one of: **FACT** (evidence exists), **HYPOTHESIS**
  (plausible, unproven), **DECISION** (chosen and justified), **ACTION**
  (executable intervention), **EVIDENCE** (proof produced by a real command).
- Do not confuse complexity with intelligence. The best solution resolves the
  real problem with the least complexity that keeps quality, safety and room to
  evolve.

## 1. Understand (context)

Read the context before the code:

- `AGENTS.md` (permanent rules), `docs/PROTOCOL.md` (governance),
  `docs/ARCHITECTURE.md`, and `docs/CLAIMS.md` (the source of truth for public
  counts).
- The active DNA, protocol step and mission surfaced in the session context.
- The files the task names **and** their tests and docs. Preserve unrelated code
  and settings.

## 2. Map (graph first, search second)

Projects are graphs of knowledge, architecture, dependencies, behaviour,
execution and risk — not a bag of files.

**Graph-first rule.** When `graphify-out/graph.json` exists, treat a codebase
question as a graph query _before_ the first `grep`, search or file read:

```bash
graphify query "<question>"     # broad BFS context
graphify path "<A>" "<B>"       # how two concepts connect
graphify explain "<concept>"    # focused subgraph of one idea
```

Read raw files only for lines the graph or an earlier read already located.
Re-run `graphify update .` after modifying code (AST-only, no API cost).

Build or extend the six views the task needs:

| Graph         | Question it answers                                                     |
| ------------- | ----------------------------------------------------------------------- |
| Knowledge     | What concepts, rules and decisions exist, and how do they relate?       |
| Architecture  | Which modules, packages, services, interfaces and APIs exist?           |
| Dependency    | What imports what (direct and indirect), and where is the coupling?     |
| Behaviour     | Which events, states, transitions and business rules drive execution?   |
| Execution     | Which tasks run in which order, with which pre/post-conditions?         |
| Risk & impact | What can fail, what does a change touch, and what are the side effects? |

**A graph is not knowledge.** An edge is a hypothesis until its provenance says
otherwise (`EXTRACTED` with a source location, or a cited file/line). Never
invent an edge or present a guess as a fact.

## 3. Reason (use the graph, do not just draw it)

Reasoning over the map must answer:

1. Direct and indirect relationships between the component and its neighbours.
2. Hidden dependencies and coupling that the request does not mention.
3. Isolated or orphaned components and features that are defined but unwired.
4. Cycles and inconsistencies.
5. Single points of failure and blast radius.
6. Requirement ↔ implementation ↔ test ↔ evidence links.
7. Simplification opportunities (reuse before duplication, composition before
   coupling).

**Caveat proven in this repository:** an undirected graph can report large
strongly-connected components that are **not** real import cycles, because
`contains`/`method` edges and shared hierarchy nodes connect unrelated files.
Reconstruct the directed edges (source → target) before claiming a cycle.
Without that step the graph over-reports cycles; with it, this repo has zero
import cycles. See `docs/ARCHITECTURE_DISCOVERY.md`.

Before modifying a component, list its related nodes and the edges the change
affects. A local change can have systemic consequences.

## 4. Decide

For every problem, answer: what is the real cause, which components are
involved, which edges are affected, what are the alternatives, and what is the
cost/risk/impact of each.

- Reversible, in-scope choices: decide yourself and record the rationale.
- Irreversible, high-risk or contested choices: escalate or run a weighted
  decision.
- Prefer the simplest sustainable option; a fix that weakens a guarantee is not
  a fix.
- If the evidence is insufficient, **stop** and name the missing knowledge.

Use the collaboration engines when the choice is not obvious (see the
`behavior-os` skill for the full map):

| Signal                              | Reach for                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Architecture, design, trade-off     | state alternatives → `bos_create_meta_decision`                                     |
| Several viable ideas                | `bos_create_brainstorm` → ≥2 `bos_propose_idea` → `bos_vote_idea`                   |
| Disagreement, multiple perspectives | `bos_start_conversation` → `bos_add_conversation_turn` → `bos_resolve_conversation` |
| Contested or irreversible           | `bos_resolve_consensus` / `bos_decide`                                              |

## 5. Execute

- Choose the smallest safe diff. One concern per change; do not mix formatting,
  refactors and features.
- Add the test with the change. A behaviour change without a failing-before,
  passing-after test is incomplete.
- Respect the DNA: a `deny` is final; do not retry it or work around it.
- Prepare release actions for a human; never push, tag, publish or deploy from an
  agent session.

## 6. Verify

Use the `verification-first` skill. A claim is only true when a real command
produced the output that proves it:

```bash
pnpm typecheck
pnpm lint:check
pnpm test
pnpm build
# then the gates the change touches: verify:*, smoke:*, security:audit
```

Report the exact failing output and stop. Never weaken a gate to make it pass,
and never substitute a simulated or reported audit for an executed one.

## 7. Learn

- Record the verified outcome with `bos_record_learning`; distinguish confirmed
  from provisional knowledge.
- Persist reusable knowledge in Behavior-OS memory (`bos_save_memory`,
  `bos_recall_relevant`, `bos_query_knowledge_graph`,
  `bos_consolidate_memory`).
- Update `docs/CLAIMS.md` when a measured public claim changed.
- Keep the map current with `graphify update .`.
- Write down the problem, hypothesis, decision, strategy, result, failures,
  corrections and evidence — so the next agent inherits the learning instead of
  repeating the mistake.

## Specialist roles and delegation

Use only the specialists the problem needs. Delegation is justified when there
is a specialised, **verifiable** responsibility — not for convenience.

| Role                       | Agent(s) in this repository                     | Responsibility                                                                    |
| -------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Orchestrator               | current agent, `planner`                        | Understand the goal, coordinate, manage dependencies, validate results            |
| Explorer / systems analyst | `researcher`, `explore` subagent, graphify      | Investigate, build the map, find dependencies and opportunities, produce evidence |
| Engineer / executor        | `builder`                                       | Implement within the architecture, keep components consistent                     |
| Auditor / validator        | `reviewer`, `auditor` (via `/review`, `/audit`) | Independent read-only verification; the author is never the reviewer              |

For multi-step or delegated work, prefer the orchestration tools
(`bos_start_loop`, `bos_resolve_consensus`, `bos_create_brainstorm`) over ad-hoc
execution, and validate with `bos_run_audit` before `bos_complete_mission`.

## Integration map

| Layer                  | Responsibility                                   | Capability                                          |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Pragmatic intelligence | Think, analyse, decide                           | this skill + `planner`                              |
| Graph engineering      | Understand structure and relations               | `graphify` skill, `graphify-out/graph.json`         |
| Behavioural governance | Govern, control, validate                        | `behavior-os` skill, 7-step protocol, DNA verdicts  |
| Official evidence      | Confirm APIs, fields, flags, versions            | `docs-research`, `find-docs`, `context7-mcp`        |
| Memory                 | Remember decisions and learnings across sessions | Behavior-OS knowledge graph + `bos_record_learning` |
| Verification           | Prove the result                                 | `verification-first`, the `AGENTS.md` ladder        |

## Stop conditions

- A DNA rule returns `deny`.
- A critical dependency or required evidence cannot be resolved.
- A gate fails and the cause is outside the authorised change.
- The next step would weaken a permission, a test or a documented guarantee.

Report the condition and the evidence. Do not continue by working around it.

## Honesty rules

- Never invent an edge, a test, a result or a capability.
- Never claim "done", "passes", "fixed" or "verified" without executed output.
- Never hide a failing gate behind a passing looking summary.
- A graph is not knowledge; code is not functionality; activity is not progress;
  autonomy is not the absence of governance.

INTELLIGENCE MUST PRODUCE UNDERSTANDING.
UNDERSTANDING MUST PRODUCE DECISIONS.
DECISIONS MUST PRODUCE ACTION.
ACTIONS MUST PRODUCE EVIDENCE.
EVIDENCE MUST PRODUCE LEARNING.
