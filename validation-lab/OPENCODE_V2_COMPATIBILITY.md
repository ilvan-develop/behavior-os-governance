# OPENCODE_V2_COMPATIBILITY

The brief warns - correctly - that V1 plugins do not run on V2 and that the
plugin API changed. This audit checks the actual environment, not the intent.

## Installed environment

| Item               | Value                                                                         | How verified                 |
| ------------------ | ----------------------------------------------------------------------------- | ---------------------------- |
| Plugin API package | `@opencode/plugin@^2.0.0-beta.10`                                             | `package.json` (root)        |
| Plugin entry       | `plugins/opencode-v2/src/index.ts`                                            | build target                 |
| Loader (project)   | `.opencode/plugins/behavioros.ts`                                             | `verify:opencode`            |
| Loader (global)    | `C:\Users\waldi\.config\opencode\plugins\behavioros.js`                       | `verify:opencode`            |
| Hooks used         | `execute.before`, `execute.after`, `prompt`, `context`, permission `evaluate` | `verify:plugin`              |
| Tools              | 102 unique `bos_*`                                                            | `verify:plugin`, parity gate |

## Executed checks

`pnpm verify:opencode` -> **42/42 passed**, including:

- 8 skills discoverable, `behavior-os` skill lists the 7 real protocol steps.
- plugin loaders are single-scope, versioned and distinct.
- plugin exposes **102 unique** `bos_*` tools.
- the plugin package builds the loader target (`tsc -p tsconfig.build.json` + DNA copy).
- external MCP config never enters V2 config.
- control-plane files are not git-ignored (20 trackable).

`pnpm verify:plugin` -> hook report:

```
Tool hooks     : execute.before, execute.after
Session hooks  : prompt, context
Permission hook: evaluate
Tools (102)    : registered
Governance     : "deploy to production" denied under surgical-team
Log            : bos_get_log returned 7 entries incl. dna_selected + permission deny
Protocol flow  : step 1 complete, currentStep = 3
Agents         : governed preamble applied to build, review
```

That is a live plugin registration, a real permission deny, a real governance
log entry and a real protocol step advance - not a static schema check.

`pnpm verify:tool-parity` -> **98 MCP tools, 102 plugin tools, 98 shared with
identical inputs, 4 declared plugin-only** (`bos_start_loop`, `bos_resume_loop`,
`bos_loop_status`, `bos_approve_loop` - loop orchestration is host-specific).

## V1 -> V2 evidence

- The plugin imports the V2 plugin contract and registers tools through it; the
  build target compiles against `@opencode/plugin@2`.
- Hooks used are V2 names (`execute.before/after`, `prompt`, `context`), not the
  V1 tool wrapper shape.
- The plugin is loaded from `.opencode/plugins/` with a separate global loader,
  and the verifier asserts the two loaders are distinct and single-scope.

## Risks and limits

1. **Beta API.** `2.0.0-beta.10` is a beta. A minor bump can change hook
   signatures. The verifier catches registration breakage, not semantic drift in
   hook payloads.
2. **No end-to-end session transcript.** The lab exercises registration, a
   permission deny, log entries and protocol progression. It does not replay a
   full multi-turn session with tool results, so event ordering under load is
   not proven.
3. **`smoke:mcp` not run in this session.** Tool parity and registration are
   verified; a live stdio MCP round-trip is available via `pnpm smoke:mcp` but
   was not executed here. Treated as B (integrated), not C (operational).
4. **Graphify is not a native plugin tool.** `verify:plugin` lists 102 `bos_*`
   tools; none is `graphify_*`. Graph access is a CLI plus a skill. Any statement
   that the plugin exposes graph tools is unsupported by this tree.
5. **Duplicate-host guard.** `setup()` disables a duplicate `behavioros` MCP
   server to prevent split-brain; opt-out is
   `BEHAVIOROS_ALLOW_DUPLICATE_HOST=true`. This is the correct failure mode for
   two governors.

## Verdict

The OpenCode V2 integration is **operational and verified for registration,
enforcement, logging and protocol progression**. It is not proven for full
multi-turn session semantics on a beta API, and it does not expose Graphify as
native tools.
