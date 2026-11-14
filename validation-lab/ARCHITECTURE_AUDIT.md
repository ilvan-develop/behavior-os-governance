# ARCHITECTURE_AUDIT

## Shape

```text
packages/schemas      Zod contracts (governance, mission, learning, DNA, decision...)
packages/core         48 engines behind one BehaviorOS facade + persistence
packages/orchestrator shell adapter, delegation, control loop, LLM gateway
packages/mcp-server   stdio MCP: 98 tools + 2 resources
packages/sdk          typed client
packages/cli          init/validate/status/simulate/deploy
plugins/opencode-v2   102 bos_* tools + hooks (the native host)
.opencode             skills, agents, commands, plugin loader
dnas/                 21 behavioural patterns
```

The dependency direction is sound: schemas <- core <- orchestrator <- hosts
(plugin, MCP, CLI). The plugin and MCP share tool implementations through core
rather than duplicating logic, which `verify:tool-parity` (98 shared, identical
inputs) enforces mechanically.

## Architectural strengths (evidence-backed)

1. **One enforcement policy, one place.** `action-classification.ts` was
   extracted from the plugin precisely so hosts cannot diverge (file header).
   The intent is right - which is why G-01 is a _content_ bug, not a layering
   bug.
2. **Fail-closed evidence.** `bos_complete_mission` refuses missing, simulated,
   `reported` and executionId-less evidence (L12, 8/8). The simulated-audit
   guard is enforced inside `AuditEngine`, not only at the facade.
3. **Durable state with explicit semantics.** The control loop persists every
   transition, validates state on load, recomputes terminal states instead of
   trusting them, and re-applies `authorizedPhases` on resume (L14). At-least-once
   task semantics are documented rather than implied.
4. **Explainability by construction.** Every delegation decision carries a
   reason; every governance decision carries `firedRules` and a reason; every
   crew/plan decision is recorded. That is what makes the lab's assertions
   meaningful.
5. **Host separation.** The plugin is the native OpenCode integration; MCP is for
   external clients; registering both in `opencode.json` is deliberately avoided
   to prevent a split-brain (two governors, one environment).

## Architectural risks

### AR-1 - Classification semantics are implicit and split

There are at least three action classifiers: `isMutatingAction` (regex),
`isControlPlaneAction` (prefix), and `classifyIrreversibleCommand`
(command-aware). They answer different questions but are used at the same
decision point. G-01 is the result: `git push` is irreversible to one, harmless
to another.

**Recommendation.** One `classifyAction(action) -> { mutates, controlPlane,
irreversibleKind, confidence }` in core, consumed by every host. Unknown input
returns `mutates: true` (fail-closed).

### AR-2 - Security primitives modelled as timestamps

Revocation is `expiresAt = now`. Security state should be explicit
(`revokedAt`, `reason`, `revokedBy`), immutable, and checked at every
authorization point. A single field doing two jobs (expiry and revocation)
creates the S-01 bug and a clock-skew hazard.

### AR-3 - Window vs whole-history verification at the facade

`verifyAuditTrail()` is correct but ambiguous to callers; the durable verifier
is authoritative in the plugin and unused by the facade. Two surfaces, two
meanings, one name. See O-01.

### AR-4 - "Graphify native tools" is not what the repository contains

The brief assumes 12 native `graphify_*` tools. In this tree the plugin has
**zero** references to `graphify_*`; Graphify is a CLI plus a skill that teaches
the agent to call it. That is a legitimate design (the agent uses a binary, not
a tool schema), but it must not be described as native tool integration.

### AR-5 - Documentation density is a maintenance risk

`docs/CLAIMS.md` is long and precise, and `docs-consistency.test.ts` guards tool
names. That is good. The remaining risk is semantic drift: the claim "warn
never changes the verdict" was true, but a lab (and plausibly a reader) assumed
otherwise. Claims should link to the executable test that proves them, not only
to prose.

## Coupling and blast radius

- `BehaviorOS` is a 2000+ line facade over 48 engines. It is cohesive but large;
  every host depends on it. The recent service extractions (MissionService,
  LearningPolicyService, GovernanceEvaluationService) are the right direction.
- The plugin is 1000+ lines of tool registration. Tool-count parity is tested;
  behavioural parity is tested by the lab only for the paths the lab covers.
- The orchestrator's concurrency ledger is in-process only. Any move to
  multi-process execution would make the budget advisory. This is documented,
  which is the correct mitigation.

## Verdict

The architecture is **coherent, layered and honestly documented**, with a
deliberate evidence culture. Its weaknesses are not structural: they are two
semantic gaps (classification, revocation) and one naming gap. All three are
small, testable fixes. Nothing in this audit suggests the design must change.
