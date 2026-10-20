# Behavior-OS API Reference

Verified against `packages/core/src/engine/behavior-os.ts` and
`packages/sdk/src/index.ts`. Everything listed exists with these shapes; there are
no planned-but-missing methods. Counts live in [`CLAIMS.md`](./CLAIMS.md),
commands in [`CLI.md`](./CLI.md) and [`COMMANDS.md`](./COMMANDS.md).

## BehaviorOS (core)

```typescript
import { BehaviorOS } from '@behavior-os/core';

class BehaviorOS {
  constructor(config?: BehaviorOSConfig);

  // DNA
  loadDNA(dna: DNA): Promise<void>;
  getDNA(): DNA | null;

  // Identity (never a model name)
  resolveAgentIdentity(): AgentIdentity;   // { agentId, agent, persona, dnaPattern, source }
  setActiveAgent(selector: {
    id?: string; name?: string; type?: string; capabilities?: string[]; persona?: string;
  }): AgentIdentity | null;
  registerAgent(agent: Agent): void;
  getAgent(id: string): Agent | undefined;
  listAgents(): Agent[];

  // Protocol
  advanceProtocolStep(toolName: string): void;

  // Governance, quality, gates
  evaluateGovernance(
    action: string,
    context: { agent: string; scope?: string; [key: string]: unknown },
  ): GovernanceDecision;                   // throws when no DNA is loaded
  simulateAction(action: string, context: { agent: string; context?: Record<string, unknown> }): GovernanceDecision;
  checkQuality(metrics: Record<string, number>): { passed: boolean; details: unknown };
  preflightAction(action: string, context?: { agent: string; context?: Record<string, unknown> }): PreflightResult;
  runPipeline(context?: GateContext): PipelineRun;
  listPipelineRuns(limit?: number): PipelineRun[];
  getPipelineEngine(): PipelineEngine;     // addGate / removeGate / getGates / run / preflight

  // Missions
  createMission(options: {
    title: string; type: string; priority: string;
    dnaPattern?: string; createdBy?: string; requiredChecks?: string[]; advanceProtocol?: boolean;
  }): Mission;
  startMission(missionId: string, options?: { advanceProtocol?: boolean }): Mission | null;
  completeMission(missionId: string, options?: MissionTransitionOptions): Mission | null;
  failMission(missionId: string, reason?: string, options?: Omit<MissionTransitionOptions, 'reason'>): Mission | null;
  transitionMission(missionId: string, to: MissionStatus, options?: MissionTransitionOptions): MissionTransitionResult;
  pauseMission(missionId: string, options?: MissionTransitionOptions): MissionTransitionResult;
  resumeMission(missionId: string, options?: MissionTransitionOptions): MissionTransitionResult;
  cancelMission(missionId: string, options?: MissionTransitionOptions): MissionTransitionResult;
  listMissions(limit?: number): Mission[];   // default 50
  getMission(missionId: string): Mission | null;

  // Audit
  runAudit(options: { missionId: string; agentId?: string; stages?: string[]; simulate?: boolean }): AuditReport;
  listAuditReports(limit?: number): AuditReport[];

  // Learning, evolution, recommendations
  recordLearning(options: {
    type: string; source: string; content: string; impact: string; relatedMission?: string;
  }): LearningEvent;
  getInsights(limit?: number): LearningEvent[];                        // default 10
  proposeEvolution(minConfidence?: number): EvolutionProposal[];        // default 0.8, read-only
  applyEvolution(options?: {
    minConfidence?: number; apply?: boolean; votes?: Vote[]; policy?: DecisionPolicy;
  }): { proposals: EvolutionProposal[]; applied: EvolutionProposal[]; enabled: boolean; decision?: Decision };
  proposeCodeFixes(minConfidence?: number): CodeFixProposal[];
  applyCodeFixes(options?: {
    minConfidence?: number; apply?: boolean; votes?: Vote[]; policy?: DecisionPolicy;
  }): CodeFixApplyResult;
  listCodeFixResults(limit?: number): CodeFixResult[];                  // needs a store
  listCodeEdits(limit?: number): CodeEditRecord[];                      // needs a store
  recommend(limit?: number, ageLimitHours?: number): RankedRecommendation[]; // defaults 5 / 168
  decide(options: DecideOptions): Decision;
  listDecisions(limit?: number): Decision[];
  compareDNADrift(dnaA: DNA, dnaB: DNA): DriftInfo;
  compareDNAVersions(dnaA: DNA, dnaB: DNA): {
    score1: number; score2: number; difference: number; recommendation: string;
  };

  // Governed code editing (dry-run unless codeEdit.enabled && apply)
  applyCodeEdit(options: {
    file: string; find: string; replace: string;
    apply?: boolean; expectedBeforeHash?: string;
    votes?: Vote[]; policy?: DecisionPolicy; missionId?: string;
  }): CodeEditApplyResult;
  getCodeEditEngine(): CodeEditEngine;

  // State & persistence
  getState(): AgentState;
  getAgentState(): AgentState;
  updateState(updates: Partial<AgentState>): void;
  getStatus(): {
    engine: boolean;
    dna: string | null;
    missions: number;
    agents: number;
    state: AgentState;
    config: {
      governance: 'strict' | 'moderate' | 'lenient';
      qualityEnabled: boolean;
      auditEnabled: boolean;
      learningEnabled: boolean;
    };
  };
  exportState(): BehaviorOSSnapshot;
  importState(snapshot: BehaviorOSSnapshot | null | undefined): boolean;
  persistAll(): Promise<void>;
  hasPersistence(): boolean;
  closeStore(): void;
}
```

### BehaviorOSConfig

```typescript
interface BehaviorOSConfig {
  dnaPath?: string;                       // loaded best-effort in the constructor
  governance?: { enabled?: boolean; level?: 'strict' | 'moderate' | 'lenient' };
  quality?: { enabled?: boolean };
  audit?: { enabled?: boolean };
  learning?: { enabled?: boolean };
  persistence?: { path?: string; store?: Store; autoHydrate?: boolean };
  pipeline?: { enabled?: boolean; gates?: PipelineGate[] };
  decision?: { policy?: DecisionPolicy; quorum?: number };
  evolution?: { enabled?: boolean; minConfidence?: number };
  codeEdit?: { enabled?: boolean; root?: string; extensions?: readonly string[] };
}
```

### DecideOptions

```typescript
import type { DecideOptions } from '@behavior-os/core';

interface DecideOptions {
  subject: string;
  votes: Vote[];
  policy?: 'majority' | 'supermajority' | 'unanimous';
  quorum?: number;
  missionId?: string;
}
```

## BehaviorOSSDK

`@behavior-os/sdk` re-exports `BehaviorOS` and the schema types, and adds a thin
wrapper over the same engine. Its methods are **synchronous** except `loadDNA`:

```typescript
import { BehaviorOSSDK } from '@behavior-os/sdk';

class BehaviorOSSDK {
  constructor(config?: BehaviorOSConfig);   // no separate SDKOptions type

  loadDNA(dna: DNA): Promise<void>;
  getDNA(): DNA | null;

  evaluateGovernance(
    action: string,
    context: { agent: string; scope?: string; [key: string]: unknown },
  ): GovernanceDecision;

  checkQuality(metrics: Record<string, number>): { passed: boolean; details: unknown };

  createMission(options: {
    title: string; type: string; priority: string; dnaPattern?: string;
    requiredChecks?: string[];
  }): Mission;
  startMission(missionId: string, options?: { advanceProtocol?: boolean }): Mission | null;
  transitionMission(
    missionId: string,
    to: MissionStatus,
    options?: MissionTransitionOptions,
  ): MissionTransitionResult;

  recordLearning(options: {
    type: string; source: string; content: string; impact: string; relatedMission?: string;
  }): LearningEvent;
  getInsights(limit?: number): LearningEvent[];

  getStatus(): ReturnType<BehaviorOS['getStatus']>;
  getState(): AgentState;
}
```

## MCP tools

The MCP server exposes **30 tools** and 2 resources; the OpenCode plugin adds
`bos_get_log` and `bos_verify_audit_trail` (32). The full argument list is in
[`COMMANDS.md`](./COMMANDS.md).

Tool names used in earlier drafts of this document that **do not exist**:
`bos_get_dna_pattern`, `bos_list_dna_patterns`, `bos_get_mission`,
`bos_get_audit_report`, `bos_get_patterns`, `bos_display_dna`,
`bos_validate_dna`, `bos_resolve_truth`. Mission lifecycle is exposed through
`bos_complete_mission`, `bos_fail_mission` and `bos_cancel_mission`; pause and
resume are `BehaviorOS` methods (`pauseMission`, `resumeMission`) and are not
tools in S1.
