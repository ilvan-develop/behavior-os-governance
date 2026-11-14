# GRAPH_ENGINEERING_REPORT

## What exists

| Component               | Reality in this tree                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Graph artifact          | `graphify-out/graph.json` - 3739 nodes, 7231 edges                |
| Access                  | `graphify` CLI (v0.9.107) + the `graphify` skill                  |
| Native plugin tools     | **none** - 0 `graphify_*` references in `plugins/opencode-v2/src` |
| Relationship provenance | edges are marked `[EXTRACTED]` or `[INFERRED x.xx]`               |
| Repo rule               | query the graph before grepping source (AGENTS.md)                |

The brief expected 12 native tools (`graphify_build`, `graphify_query`, ...).
They are not registered here. The capability is real, but it is delivered as a
CLI plus instructions, not as tool schemas. Any claim of "native graph tools"
would be false for this repository.

## What the lab executed (L02, 8/8 PASS, score 56)

| Check                                                          | Result                                                |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| graph artifact has >100 nodes                                  | 3739                                                  |
| graph artifact has edges                                       | 7231                                                  |
| `query` for `evaluateGovernance`                               | 48 nodes, scoped, names the real file                 |
| `query` for `GovernanceEngine`                                 | 83 nodes (truncated at token budget)                  |
| `explain BehaviorOS`                                           | source `packages/core/src/engine/behavior-os.ts L107` |
| `path BehaviorOS -> GovernanceEngine`                          | 3 hops, confidence reported                           |
| ground truth: `evaluateGovernance` defined in `behavior-os.ts` | confirmed                                             |
| graph answer names the real file                               | confirmed                                             |

The path result is the most informative artifact:

```text
BehaviorOS --method [EXTRACTED]--> .constructor()
          --calls [INFERRED 0.85]--> .createGovernanceEngine()
          --references [EXTRACTED]--> GovernanceEngine
Path confidence: INFERRED (weakest hop: calls 0.85)
```

The graph does not pretend the call edge is extracted. It reports the weakest
hop and the number of equal-length alternatives. That is the right epistemic
posture for impact analysis.

## What the graph is good for (demonstrated)

- **Locating the definition** of a symbol without grepping a 2000-line file.
- **Explaining a node** with its file and line.
- **Connecting two architectural entities** and stating how confident the path is.
- **Bounding a query** to a token budget, with an explicit truncation warning and
  the budget needed to see everything.

## What the graph is not (demonstrated or inferred)

1. **Not proof of learning.** A code graph is structural knowledge. It says
   nothing about whether a lesson was retrieved or applied. The brief already
   separates these; the lab keeps them separate.
2. **Not a change-impact oracle on its own.** The 0.85 `calls` edge is inferred.
   An impact claim that rests on inferred edges must say so. The CLI does.
3. **Not wired into agent task assignment.** No code path reads the graph to
   choose a specialist. Delegation uses declared skills (L04). This is a
   _potential_ integration, not an existing one.
4. **Not a substitute for tests.** L02's ground-truth check covers one symbol.
   A full graph-accuracy benchmark would need a sample of symbols and a
   precision/recall measurement. That is roadmap item R-05.

## Graph-vs-no-graph experiment (not executed)

The brief asks for A/B: same task, same repo snapshot, same model, with and
without graph context; measure accuracy, tool calls, time and wrong assumptions.

This is **NOT_VERIFIED**. It requires a model in the loop and a scoring rubric.
The protocol and fixtures exist (`CHALLENGE.md`); the execution does not.

Honest expectation, stated as a hypothesis rather than a result: the graph should
reduce wrong file assumptions and grep volume on "where is X defined / what
depends on X" questions. It should **not** improve defect detection, which needs
semantics the graph does not encode.

## Verdict

Graph engineering is **operational but manual**: a correct, provenance-aware code
graph used through a CLI and a skill. It is **not** a native tool integration and
**not** yet an input to agent selection or to the learning loop. Claims must be
scoped accordingly.
