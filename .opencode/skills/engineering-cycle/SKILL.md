---
name: Engineering Cycle
description: Run the repository change workflow from understanding to verified learning. Use for features, bug fixes, refactors, audits and any multi-step change that touches code, tests or documentation.
---

# Engineering cycle

This is the repeatable path for a change in Behavior-OS. It complements the
permanent rules in `AGENTS.md` and the 7-step governance protocol.

## 1. Understand

Restate the request and write the acceptance criteria. Separate what is asked
from what you assume. If the request conflicts with an existing rule, surface
the conflict before editing.

## 2. Discover

Read the file, its tests and the relevant documentation before changing
behavior. Search for existing patterns instead of inventing a second way.
Check `docs/CLAIMS.md` when a public statement may be affected.

## 3. Ground

Confirm API names, config fields, CLI flags and environment variables against
the source or the official documentation. Never fill a gap with a guess.

## 4. Plan

Choose the smallest safe diff. One concern per change. Name the files, the test
that proves the behavior and the gates that must pass.

## 5. Implement

Preserve unrelated code and settings. Add the test with the change. Keep the
change reviewable; do not mix formatting, refactoring and features.

## 6. Validate

Run the verification ladder in `AGENTS.md`. Stop at the first failure and report
the exact output. Do not weaken a gate to make it pass.

## 7. Review

For a risky change, ask the `reviewer` agent for an independent read-only
review. The author is not the reviewer. Resolve findings or record why they are
accepted.

## 8. Learn

Record the verified outcome with `bos_record_learning`. Update
`docs/CLAIMS.md` when a measured public claim changed. Prepare release actions
for a human; never push, tag, publish or deploy from an agent session.

## Stop conditions

- A DNA rule returns `deny`.
- A gate fails and its cause is outside the change.
- The required evidence cannot be produced in this environment.
- The change would weaken a permission, a test or a documented guarantee.

Report the condition and the evidence. Do not continue by working around it.
