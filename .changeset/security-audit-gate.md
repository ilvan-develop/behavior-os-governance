---
---

Fix the dependency audit gate: upgrade `@changesets/cli` to 3 and `lint-staged`
to 16, pin `markdown-it` to the patched 14.3.3 inside typedoc's own range, and
run `security:audit` from `verify:all` and CI. No published package behaviour
changes, so no version bump.
