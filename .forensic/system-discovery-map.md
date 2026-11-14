# Forensic Engineering Pipeline — Phase 02: System Discovery Map
**Repository:** Behavior-OS  
**Execution Timestamp:** 2026-11-14T18:57:30+01:00  
**Knowledge Graph Size:** 3,869 nodes, 59 major communities (extracted via Graphify)

---

## 1. Monorepo Structure & Package Inventory

```
behavior-os/ (root workspace)
├── packages/
│   ├── schemas/        @behavior-os/schemas@2.3.0       (Zod domain schemas: 91 objects, 64 enums)
│   ├── core/           @behavior-os/core@2.3.0          (48 engines, BehaviorOS facade, services, persistence)
│   ├── sdk/            @behavior-os/sdk@2.3.0           (TypeScript client SDK wrapping Core/MCP)
│   ├── cli/            @behavior-os/cli@2.3.0           (CLI commands: init, validate, status, drift, etc.)
│   ├── mcp-server/     @behavior-os/mcp-server@2.3.0    (MCP server: 98 tools, 2 resources, stdio transport)
│   └── orchestrator/   behavioros-orchestrator@1.0.1    (Autonomous task orchestration, retry, circuit breaker)
├── plugins/
│   └── opencode-v2/    @behavior-os/opencode-plugin@2.1.0 (OpenCode V2 native plugin: 102 tools, hooks)
├── examples/           behavioros-examples@1.0.0        (Consumer integration examples)
├── dnas/               21 production DNA patterns (YAML)
├── .opencode/          Agents, commands, skills, and behavioros.ts plugin loader
└── scripts/            Verification ladder, governance conformance, capability scanners
```

### Dependency Graph
```
@behavior-os/schemas (zero runtime deps, Zod v4)
       ▲
       │
@behavior-os/core ─────────► node:sqlite (Node >= 22)
  ▲         ▲
  │         │
  │     behavioros-orchestrator
  │         ▲
  │         │
@behavior-os/sdk, @behavior-os/cli, @behavior-os/mcp-server, @behavior-os/opencode-plugin
```

---

## 2. Core Engines & Service Architecture

The `@behavior-os/core` package exposes 48 specialized engines through the unifying `BehaviorOS` facade and dedicated domain services:

| Domain | Key Engines & Services | File Location |
|---|---|---|
| **Governance & Policy** | `GovernanceEngine`, `GovernanceEvaluationService`, `DynamicPolicyEngine`, `TemporalGovernanceEngine`, `RolePolicyEngine` | `packages/core/src/engine/governance-engine.ts`, `services/governance-evaluation-service.ts` |
| **Identity & Access** | `ZeroTrustIdentityEngine`, `ActionClassificationEngine` | `packages/core/src/engine/zero-trust-identity-engine.ts`, `action-classification.ts` |
| **Pipeline & Execution** | `PipelineEngine`, `EngineeringCycleEngine` | `packages/core/src/engine/pipeline-engine.ts`, `engineering-cycle-engine.ts` |
| **Quality & Audit** | `QualityEngine`, `AuditEngine`, `CounterfactualAuditEngine` | `packages/core/src/engine/quality-engine.ts`, `audit-engine.ts` |
| **Decisions & Consensus** | `DecisionEngine`, `ConsensusEngine`, `CollectiveIntelligenceEngine` | `packages/core/src/engine/decision-engine.ts`, `consensus-engine.ts` |
| **Learning & Adaptation** | `LearningEngine`, `LearningPolicyService`, `ExperientialLearningEngine`, `PredictionEngine`, `CrossDomainTransferEngine` | `packages/core/src/engine/learning-engine.ts`, `services/learning-policy-service.ts` |
| **Memory & Context** | `MemoryConsolidationEngine`, `ContextReconstructionEngine` | `packages/core/src/engine/memory-consolidation-engine.ts` |
| **Mission & Lifecycle** | `MissionEngine`, `MissionService` | `packages/core/src/engine/mission-engine.ts`, `services/mission-service.ts` |
| **Drift & Antipatterns** | `DriftEngine`, `AntipatternEngine`, `AnomalyDetectionEngine` | `packages/core/src/engine/drift-engine.ts`, `antipattern-engine.ts` |
| **Persistence** | `SQLiteStore` (9 tables: missions, learnings, decisions, audits, etc.) | `packages/core/src/persistence/sqlite-store.ts` |

---

## 3. OpenCode V2 Native Plugin Integration

- **Entrypoint:** `plugins/opencode-v2/src/index.ts`
- **Exposed Tools:** 102 tools (prefixed with `bos_`)
  - 98 shared tools matching the MCP interface
  - 4 plugin-only loop control tools: `bos_start_loop`, `bos_resume_loop`, `bos_loop_status`, `bos_approve_loop`
- **Hooks Implemented:**
  1. `tool.execute.before`: Evaluates governance before any mutating action.
  2. `tool.execute.after`: Emits telemetry and captures execution logs.
  3. `session.prompt`: Automatically infers DNA intent, handles mission lifecycle, injects chief plan.
  4. `session.context`: Surfaces active DNA, current protocol step, active mission, and identity.
  5. `permission.evaluate`: Fast-path fail-closed evaluation intercepting unauthorized actions.
- **Project Opt-In Architecture:**
  The globally installed plugin remains dormant unless a project contains `.behavioros/config.json` (or `.behavioros/state.json`).

---

## 4. MCP Server Integration

- **Server Package:** `packages/mcp-server`
- **Transport:** Standard Input/Output (`stdio`) only (RFC-compliant, fail-safe).
- **Tools:** 98 tools wrapping the core engine facade with strict parameter serialization.
- **Resources:**
  - `behavioros://protocol/steps` — Canonical 7-step progression guide.
  - `behavioros://dna/catalog` — Dynamic discovery of 21 bundled DNA patterns.

---

## 5. End-to-End Execution Trace

```
Agent Action Request (e.g. bash "git push" or "npm publish")
       │
       ▼
OpenCode V2 / MCP Entrypoint
       │
       ▼
Permission / Before-Execute Hook (`plugins/opencode-v2/src/governance.ts`)
       │
       ▼
Action Classification (`packages/core/src/action-classification.ts`)
  ── Classifies: mutating vs read-only, risk level, resource target
       │
       ▼
Governance Evaluation (`packages/core/src/services/governance-evaluation-service.ts`)
  ── Evaluates Active DNA Rules (sterile-field, change-control, etc.)
  ── Evaluates Role Policies
  ── Checks Control-Plane Immunity (prevents deadlock)
       │
       ├─── DENIED ──► Write Monotonic Governance Log (SQLite / Memory Ring Buffer)
       │                 Emit Synthetic Agent Warning Notice
       │                 Block Execution (throw / return ask/deny)
       │
       └─── ALLOWED ──► Forward to Gate Pipeline (`packages/core/src/engine/pipeline-engine.ts`)
                         Execute Action
                         Post-Execute Telemetry & Metrics Capture
                         Advance Protocol Step & Record Verification
```
