---
name: Release Gates
description: Prepare a release without performing human-gated actions. Use when asked to version, tag, publish, deploy or hand off a release candidate.
---

# Release gates

Release actions are human gates. An agent prepares the change and reports the
exact command a human must run. An agent never pushes, tags, publishes or
deploys.

## Preconditions

- Every applicable gate in the verification ladder passed with observed output.
- The governance audit ran and its verdict is known.
- `docs/CLAIMS.md` matches the measured state.
- The working tree contains only the intended change.
- The release notes describe user-visible behavior, not internal activity.

## Prepare

1. Run `pnpm verify:all` and keep the output.
2. Confirm the version bump with `pnpm changeset`.
3. Review the generated changelog and the diff.
4. State the rollback path.
5. Produce the handoff:

```text
Release candidate:
Version:
Evidence (gates and verdict):
Known limitations:
Commands for the human:
Rollback:
```

## Human-only commands

The following are never run from an agent session. Present them for a human to
execute:

```bash
pnpm changeset version
pnpm release
git tag <version>
git push --follow-tags
```

## Refuse to proceed when

- A gate failed or was not run.
- The audit verdict is not `pass` and the residual risk is not accepted.
- The change bypasses a DNA rule or a repository permission.
- A secret or an uncommitted unrelated change is present.
- The release depends on an unverified platform field or API.
