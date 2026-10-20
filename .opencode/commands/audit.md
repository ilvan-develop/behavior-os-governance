---
description: Run the Behavior-OS audit and an independent completeness review
agent: auditor
subagent: true
---

Audit mission: $ARGUMENTS

1. Read the mission, the active DNA and the acceptance criteria.
2. Run `bos_run_audit` for the mission. Report the real overall verdict, the
   stages that ran and the evidence they produced.
3. Check the verification ladder evidence supplied by the parent session. List
   every missing gate as a finding, not as a pass.
4. Review the diff for correctness, security, regressions, governance bypasses,
   missing tests and documentation drift.
5. Report findings in severity order with `file:line`, evidence, why it matters
   and a suggested fix. Distinguish verified facts from residual risk.

Do not edit files, push, publish or deploy. If the mission ID is missing, ask
for it instead of guessing.
