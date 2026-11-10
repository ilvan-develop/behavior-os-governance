---

name: Stack Install
description: Install or scaffold a technology stack the safe way. Use when adding a framework, creating a new app/service, initializing a monorepo, or installing dependencies. Forces official-docs-first, CLI-generated code, and real verification instead of hand-written generated files.
---

# Stack Install

The failure mode this skill prevents: an agent writes a "Next.js app", a
"Prisma schema", or a "shadcn setup" from memory, produces stale or invented
config, and then debugs its own hallucination for an hour. The framework CLI and
the official docs already solved that problem.

## Non-negotiables

1. **Docs before code.** Read the official quickstart/installation page for the
   exact version you are installing. Use the `docs-research` skill (or
   `context7`/`find-docs` when available). Do not trust memory for APIs,
   config keys, CLI flags or required files.
2. **CLI, not hand-written generated code.** Scaffold with the official command
   (`create-next-app`, `npm create vite`, `nest new`, `pnpm create`, `uv init`,
   `cargo new`, `dotnet new`, …). Never hand-write files the generator owns:
   lockfiles, framework config, generated clients, migrations, `components.json`,
   `tsconfig` emitted by the tool.
3. **Pin the version you verified.** If the docs describe v15 and the registry
   installs v14, stop and reconcile before continuing.
4. **One change per step.** Install → generate → run the generated dev/build
   command → only then add your own code.
5. **Real evidence.** `pnpm install`, `pnpm typecheck`, `pnpm build`, `pnpm test`
   (or the stack's equivalents) must actually run. A tool response is not
   evidence.
6. **Governance.** A new dependency is a governed change. Check the active DNA
   (`bos_preflight`, `bos_evaluate_governance`) before installing; a `new-dependency`
   signal can be warn/block depending on the pattern.

## Procedure

```text
1. Detect the existing stack and package manager (read manifests, lockfile,
   workspace config). Never assume npm when the repo uses pnpm.
2. Identify the exact official source: framework docs page + version.
3. Choose the CLI command the docs prescribe for THIS package manager.
4. Preflight the install against the active DNA.
5. Run the CLI. Let it generate everything it owns.
6. Run the generated project's own verification command.
7. Add only the integration code the project needs.
8. Run the repository gates (typecheck, lint, test, build) and record evidence.
9. Record the decision and the verified versions with bos_record_learning.
```

## Anti-patterns

| Anti-pattern                                                                        | Correct behavior                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Writing `package.json`, `tsconfig.json`, or `vite.config.ts` by hand "to save time" | Run the scaffold CLI; edit only what the docs say to edit |
| Copying an API from memory                                                          | Open the official reference for the installed version     |
| Installing the newest major without reading its migration guide                     | Read the migration guide, then pin                        |
| Mixing package managers in one repo                                                 | Detect and reuse the existing one                         |
| Claiming "it works" after editing files                                             | Run the real build/test command and quote the output      |

## Output contract

```text
Stack detected:
Official source (URL + version):
CLI command used:
Generated files (owned by the CLI):
Verification commands -> results:
DNA preflight verdict:
Residual risk:
```
