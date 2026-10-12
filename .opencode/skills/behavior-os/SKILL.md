---
name: Behavior-OS
description: Govern agent actions with Behavior-OS. Use when a task involves governance, DNA patterns, missions, audits, compliance, production changes, or any risky/mutating action. Selects the right DNA pattern, follows the 7-step protocol, and explains governance blocks.
---

# Behavior-OS

Behavior-OS wraps the agent with a governance layer. A **DNA pattern** defines the
rules (governance, quality gates, personas) for the current task. Until a DNA pattern is
selected, no action is governed.

## When to use

- Before mutating files, running shell commands, or deploying.
- When the user mentions governance, compliance, missions, DNA, audits, or a domain
  (HIPAA, trading, Web3, embedded, …).
- When an action is blocked with a `[Behavior-OS:…]` message.

## 7-step protocol

Run the steps in order; the `currentStep` is monotonic (1→7) and surfaced by the
`session.context` hook.

1. `bos_select_dna` — pick the pattern that matches the task.
2. `bos_list_dna` — confirm the pattern and its rules.
3. `bos_get_state` — resolve the current state.
4. `bos_create_mission` — create a mission for the work.
5. `bos_start_mission` — start it.
6. `bos_run_audit` — audit (lint/typecheck/security/coverage/performance/governance).
7. `bos_record_learning` — record the outcome.

## Choosing a DNA pattern

If unsure, let the `session.prompt` hook auto-select from the user's intent, or pick from
these common matches:

| Intent signals | Pattern |
|---|---|
| deploy, release, CI/CD, rollback | `devops-pipeline` |
| kubernetes, helm, cluster | `cloud-native` |
| patient, PHI, HIPAA, clinical | `healthcare-hipaa` |
| production change, zero-defect, sterile | `surgical-team` |
| trading, order book, latency, risk | `fintech-trading` |
| transaction, payment, KYC/AML | `financial-compliance` |
| SOX, financial reporting, controls | `enterprise-sox` |
| model training, drift, dataset | `ai-ml-pipeline` |
| smart contract, wallet, on-chain | `blockchain-web3` |
| sprint, agile, MVP | `startup-agile` |

To stop blocking in a restrictive session, select a warn-only pattern such as
`lean-factory`.

## Governance enforcement

The plugin enforces rules through the `permission.evaluate` hook:

- **`deny`** — the action is blocked (e.g. `surgical-team` blocks any `production`
  change). `--auto` does **not** override an explicit deny.
- **`ask`** — the action requires approval (e.g. `devops-pipeline` escalates any
  `deployment`).
- **`allow`** — no matching rule.

A block message looks like:

```text
[Behavior-OS:Surgical Team] Blocked by rule: sterile-field (Block any non-approved production changes)
```

When blocked, do not retry blindly: report the rule to the user, switch to an appropriate
DNA pattern if the task genuinely conflicts, or reduce the change to satisfy the rule.

## Domain condition flags

Rules match on flags derived from the action, command text, and resources, for example:
`production`, `deployment`, `change`, `production-change`, `critical-action`,
`breaking-change`, `privilege-escalation`, `new-dependency`, `patient-record`, `pii-data`,
`financial-transaction`, `high-value`. Pass extra flags as `context` to
`bos_evaluate_governance` when the heuristics cannot infer them.
