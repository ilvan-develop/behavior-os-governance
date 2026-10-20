---
description: Independent read-only review of the current diff
agent: reviewer
subagent: true
---

Review $ARGUMENTS

If no target is given, review the current working-tree diff. Use read-only
commands only: `git status`, `git diff`, `git log` and `git show`.

Check correctness, security, regressions, governance bypasses, test quality and
documentation drift. Report findings in severity order, each with `file:line`,
evidence, why it matters and a suggested fix.

If there are no findings, say so and list the checks you actually performed. Do
not edit files, push, publish or deploy.
