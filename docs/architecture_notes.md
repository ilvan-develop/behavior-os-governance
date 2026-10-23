# Architecture Notes — the WHY behind the code

Small, honest, and focused on *why* decisions were made — never on *what* the
code does. For counts and public claims, `docs/CLAIMS.md` is the single source
of truth; `docs/ARCHITECTURE.md` describes the layers. This file exists so
future maintainers don't undo a decision because its reason was never written
down.

## 2026-10-22 — Pragmatic cycle 1 (broken windows + orthogonality)

### Facade getters instead of registry casts (13 `as any` removed)

The MCP server used to reach engines with `(bos as any).registry.get('x')`.
The **why**: the server is a host; hosts belong to the outside interface, not
the internals. Casts of that kind are silent contract breaks — when a facade
getter is added, TypeScript fails *at compile time* instead of an MCP tool
failing at request time. The getters (`getBrainstorm()`, `getDriftEngine()`,
`getLearningEvents()`) follow the same lazy-create pattern the facade already
used, so no second lifecycle model was introduced (DRY).

### DRY dedupe: one resolver per engine, not three

`createBrainstormSession`/`getBrainstormSession`/`listBrainstormSessions` each
duplicated the lazy-resolve block for the brainstorm engine. One getter now
holds that logic; the three methods are one-liners. **Why**: three copies of a
lifecycle rule is three places to get it wrong (e.g. adding persistence to one
and forgetting the others).

### `resolvedBy` now actually attributed on conversation resolve

The schema defines `solution`, `resolvedBy` attribution rules elsewhere, but
the pragmatic conversation never recorded *who* resolved it — the parameter
was accepted and silently dropped. Attribution is a governance concern: an
audit trail that says "the conversation was resolved" without "by whom" is
half an evidence trail. The schema field is optional, so historic records stay
valid.

### `ux['profiles']` → `getProfile(agentId)`

The server was reading a private-ish map by string key — a silent break waiting
for the day the map is renamed or replaced. Encapsulation here is not style:
the BehavioralUX engine owns its profile lifecycle; hosts ask, they don't
reach.

### Windows silent execution (carried from earlier same-day cycle)

All process spawns set `windowsHide: true`; `pnpm` invocations use
`shell: true` (the only way on Windows to resolve `pnpm`/`pnpm.cmd` shims) and
build the command line as a single string because Node deprecates
`spawn(cmd, args, { shell: true })` (DEP0190). Stages run sequentially: two
`tsc` processes in parallel caused green projects to report false failures
under contention — a deterministic gate must not be flaky.
`scripts/win-window-probe.mjs` measures visible windows during a command and
exits 0 when there were none, so "no visible CMD window" is a **gate**, not a
promise.

### Role/policy state persists through the store's meta, not new tables

The role policy engine snapshot (roles, rules, bounded trail) is written under
a single `role-policy-state` meta key. Three new entity tables were considered
and rejected on purpose: (1) the state is one logical unit restored whole, not
something queried per row; (2) entity tables would extend the `Store`
interface, forcing every store implementation — including a host's custom
adapter — to grow for a payload that is pure JSON; (3) the meta path keeps the
documented table count and every persistence claim untouched. The engine stays
store-free (`snapshot()`/`restore()` of plain JSON); the facade is the only
place that knows about the store, so direct engine use in tests never mutates
hidden files.

### Zero-visible-windows is a gate, not a memory

The probe (`scripts/win-window-probe.mjs`) and its wrapper gate
(`scripts/verify-windows.mjs`) exist because a one-time measurement of
"zero CMD flashes" decays: the next spawn someone writes with
`args + shell: true` re-opens the leak silently. The gate re-measures on every
verification run against the topology that actually leaked before (a `pnpm`
`.cmd` shim resolved through `shell: true`), and both it and the probe hide
themselves (`windowsHide`, DEP0190-safe single-string commands) — a window gate
that flashes windows to prove there are none would be lying with its own
instrument. Non-Windows runners skip with exit 0 so the ladder stays portable.

### Host logic belongs in the facade, not in one host's pocket

Three pieces of *policy* lived in host code where only one enforcement surface
could benefit. The deny-override rule — "a DNA deny never locks the control
plane or read-only tools" — was a comment next to one implementation in the
plugin; it is now `BehaviorOS.bootstrapDenyOverride()` with its
classification helper (`isMutatingAction`, `isControlPlaneAction`) exported
from core, and the plugin's `governance.ts` keeps only a one-line alias.
Mission filters were applied in two hosts with a "matching the MCP tool"
comment as their only coordination mechanism; the facade signature
`listMissions(limit, filters)` owns the filtered-then-limited semantics and
both handlers became a single call. DNA-directory loading in the plugin
parsed YAML and cast `dna as DNA` with no schema validation — a half-shaped
pattern could reach `loadDNA()`; the facade method now routes every file
through the validating `DNALoader` and returns per-file errors instead of
casting. The rule of thumb: **if both hosts would want the same behaviour,
it is not host logic — it is facade logic.** Tests: `facade-host-logic.test.ts`.

### Learning records ride the meta channel, not a new table

G-014 records were durable only inside the plugin's ctx.storage snapshot
(`exportState` already carried `learningRecords`) while the SQLite/Postgres
store — the cross-host source of truth — never saw them. Rather than minting
a 10th entity table (table-count ripples in upkeep, and `Store` stays
generic), the records follow the precedent set by `role-policy-state`: a
plain-JSON meta key (`learning-records`), written by the facade on record
creation and on every *successful* promotion (a refused promotion rewrites
identical state, so it must not store), restored at construction with the
same corrupt-snapshot fail-safe. Bounded by design: lifecycle records end at
`monitored`; if they ever outgrow a meta value, the documented upgrade path
is an entity table — but volume, not ideology, triggers it. MCP's
`bos_record_learning` then gained the same `learningId`/`stage`/`evidence`
promotion verb the plugin already had, so the two hosts agree on one
lifecycle, spelled `actor: 'mcp'` vs the plugin's `session` in the
transition trail. The plugin host now also accepts the shared
`BEHAVIOROS_DB_PATH`, giving its facade the store the MCP server already
uses — sessions persist records, roles, decisions and missions through the
facade instead of only through ctx.storage.

### Role policies are a second authority, evaluated after the DNA

The audit found the 21st engine enforcing nothing: zero callers outside its
own tools. Closing that loop means the plugin's permission hook consults the
role/policy registry for every mutating, non-control-plane action **after**
the DNA verdict is already applied — a role decision can only block or
escalate further, never downgrade a DNA verdict — and the enforcement path
reuses the same bootstrap escape (control-plane and read-only stay
unreachable by role policies). The plugin also gained the five role tools that already existed in
the MCP server: being able to define policies from inside the governed
session is what makes the enforcement loop actually usable. Cost control
matters here: the hook runs per tool call, so benign "no policy matched"
decisions skip the store meta write (the bounded trail still records them in
memory; persistence happens when a policy matches or the fail-safe fires).

### Metrics are instrumented at the facade, not at hosts

The audit found `bos_get_metrics` permanently zero: `recordGovernanceEvent`
existed on the facade but no host ever called it. Asking every host to remember
to record metrics is a blame-distribution anti-pattern, so the instrumentation
lives at the facade: `evaluateGovernance()`, `decide()` and `recordLearning()`
record into the shared `MetricsEngine` themselves — every host (plugin, MCP,
CLI, orchestrator) is measured with zero host changes. A second dead report —
`topRules` returning a constant `[]` — was fixed by adding a structured
`firedRules` field to `GovernanceDecision` (in contrast to `rulesEvaluated`,
which lists rules *examined*, not fired), so the engine reports what matched
without the facade string-parsing the reason text. Bucket semantics worth
knowing: the governance engine never emits a `warn` verdict (warnings coexist
with allow), so `warned` counts allow-with-warning, and `denied`/`escalated`
count the effective verdict (lenient softening included). `bos_reset_metrics`
now calls `resetMetrics()` on the facade instead of reaching into the engine
registry with a cast.

### Evolution only proposes rules that can actually fire

The learning→governance loop was dead twice over: no host ever passed
`evolution.enabled`, and even when enabled the applied rule's condition key
(`pattern`) had no producer in any real context bag, so the rule could never
match. Both halves are now closed by construction. The learning engine buckets
actionable events by their tool token (`source: "tool:<name>"`, the shape the
plugin records on tool errors) and emits a condition on the `tool` context key
that real hosts actually send; events without a tool token produce **no
proposal at all** — in a governance system, a rule that cannot match is not a
warning, it is dead code. `applyEvolution` skips any proposal without one as a
second guard. Hosts opt in via `BEHAVIOROS_EVOLUTION=true` (both MCP and
plugin); evolution can still only add `warn` rules and still needs an explicit
`apply: true` per call.

### Persona activation auto-registers an unprivileged role

`loadDNA` and `setActiveAgent` auto-register the active persona as a role —
only if no role with that id exists. An explicit registration always wins, so
the two paths never fight. The auto role carries no policies and no
capabilities: it exists so that (1) role attribution works for *every* DNA
without configuration, and (2) hosts can attach policies to a persona without
first registering it. Privileges (`canAudit`, `canEnforce`, `canTeach`) are
opt-in by explicit registration — an automatic pathway that granted powers
would be a governance hole disguised as convenience.

### Role-based policy: a resolution layer, not a second DNA

The `RolePolicyEngine` (cycle 2) does not re-implement governance rules: DNA
rules keep governing by pattern; the role engine answers a different question —
*which deterministic demand applies to the actor holding this role for this
action?* Resolution order (role → persona → agentId), strictest-match-wins,
fail-safe escalation on unknown roles, and a bounded audit trail are the whole
contract on purpose: a policy engine whose matching logic needs a manual is a
policy engine nobody will register roles into.

### Learning events are the facade path, not a second path

When a pragmatic conversation resolves, the record goes through
`BehaviorOS.recordLearning()` instead of the learning engine directly. Same
data, one door: the facade is where mission association, governance stamping
and persistence live; bypassing it would create learnings the mission ledger
cannot see.
