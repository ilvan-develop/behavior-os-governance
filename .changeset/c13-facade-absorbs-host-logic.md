---
"@behavior-os/core": minor
"@behavior-os/mcp-server": patch
"@behavior-os/opencode-plugin": minor
---

The facade absorbs duplicated host logic (audit repair #5):

- `listMissions(limit, filters)` owns the filtered-then-limited semantics
  both `bos_list_missions` hosts used to copy by hand.
- `loadDNAFromDirectory(dir)` routes every YAML pattern through the
  validating `DNALoader` and returns per-file errors — the plugin's
  unvalidated `dna as DNA` cast is gone.
- `bootstrapDenyOverride(action, decision)` centralises the policy that a
  DNA deny never locks the control plane or read-only tools; the mutation
  vocabulary moved to core as `isMutatingAction`/`isControlPlaneAction`
  and the plugin keeps a one-line alias.
