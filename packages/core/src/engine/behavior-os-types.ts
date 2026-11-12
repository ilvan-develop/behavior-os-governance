/**
 * Pure domain definitions for the BehaviorOS facade: configuration, result and
 * snapshot types, the canonical protocol step list and agent identity helpers.
 *
 * They live here, separate from the facade class, so the facade file stays
 * focused on behaviour and every host imports the same contracts from one
 * place. `behavior-os.ts` re-exports everything defined here, so existing
 * `import { … } from './behavior-os.js'` call sites keep working unchanged.
 */
import type {
  Agent,
  AgentState,
  CodeEditRecord,
  CodeFixProposal,
  CodeFixResult,
  Decision,
  DecisionPolicy,
  DNA,
  EvolutionProposal,
  LearningEvent,
  LearningRecord,
  Mission,
  ProtocolStep,
} from '@behavior-os/schemas';
import type { Store } from '../persistence/store.js';
import type { CodeEditPreview } from './code-edit-engine.js';
import type { PolicyLedgerState } from './learning-engine.js';
import type { PipelineGate } from './pipeline-engine.js';
import type { RolePolicyState } from './role-policy-engine.js';

export interface BehaviorOSConfig {
  dnaPath?: string;
  governance?: { enabled?: boolean; level?: 'strict' | 'moderate' | 'lenient' };
  quality?: { enabled?: boolean; minCoverage?: number };
  audit?: { enabled?: boolean };
  learning?: { enabled?: boolean };
  /**
   * Opt-in persistence. `path` opens the built-in SQLite store (no dependency);
   * `store` injects any {@link Store} — for example a `PostgresStore` — and takes
   * precedence. `autoHydrate` (default true) restores the engine on construction.
   * A store that cannot be opened degrades to memory instead of failing.
   */
  persistence?: { path?: string; store?: Store; autoHydrate?: boolean };
  /**
   * Gate pipeline. When enabled (default), {@link BehaviorOS.preflightAction}
   * runs the `pre` gates synchronously and can block an action *before* it
   * executes. Pass `gates` to replace the default gates entirely.
   */
  pipeline?: { enabled?: boolean; gates?: PipelineGate[] };
  /** Defaults for {@link BehaviorOS.decide} when a call omits `policy`/`quorum`. */
  decision?: { policy?: DecisionPolicy; quorum?: number };
  /**
   * Learning-driven DNA evolution. Proposals are always available (read-only);
   * applying one requires `enabled: true` **and** an explicit `apply: true`
   * call. Evolution can only add `warn` rules — never blocking ones.
   */
  evolution?: { enabled?: boolean; minConfidence?: number };
  /**
   * Governed code editing. Off by default: `applyCodeEdit` always computes and
   * records a preview (the dry-run), but only rewrites a file when
   * `codeEdit.enabled === true` **and** the call passes `apply: true` (and, when
   * votes are supplied, the decision engine approves them).
   */
  codeEdit?: { enabled?: boolean; root?: string; extensions?: readonly string[] };
}

/**
 * Outcome of {@link BehaviorOS.applyCodeEdit}.
 *
 * A preview is always computed when the request is valid, even when nothing is
 * written: that is what makes the dry-run the default and the refusal explicit.
 */
export interface CodeEditApplyResult {
  /** Validation result, diff and hashes; `null` when a guard rail refused it. */
  preview: CodeEditPreview | null;
  /** Persisted evaluation record (dry-runs, refusals and applications alike). */
  record: CodeEditRecord | null;
  /** Whether the file on disk was rewritten. */
  applied: boolean;
  /** Whether `config.codeEdit.enabled` allowed writing. */
  enabled: boolean;
  /** Why nothing was written: `dry-run`, `opt-in-disabled`, `vote-rejected`, … */
  reason?: string;
  /** Guard-rail message when the request itself was refused. */
  error?: string;
  /** Present when votes were supplied to gate the change. */
  decision?: Decision;
}

/** Outcome of {@link BehaviorOS.applyEvolution}. */
export interface EvolutionResult {
  /** Proposals that met the confidence bar (including already-applied ones). */
  proposals: EvolutionProposal[];
  /** The subset that was actually written into the active DNA. */
  applied: EvolutionProposal[];
  /** Proposals skipped because their vote gate was not satisfied. */
  voteSkipped?: EvolutionProposal[];
  /** Whether `config.evolution.enabled` allowed writing. */
  enabled: boolean;
  /** Present when votes were supplied to gate the change. */
  decision?: Decision;
}

/** Outcome of {@link BehaviorOS.applyCodeFixes}. */
export interface CodeFixApplyResult {
  /** Proposals that met the confidence bar (including already-applied ones). */
  proposals: CodeFixProposal[];
  /** The subset that was persisted as `applied: true` {@link CodeFixResult} records. */
  applied: CodeFixResult[];
  /**
   * Proposals rejected by a vote, persisted as `applied: false` records so the
   * refusal is part of the versioned history instead of disappearing.
   */
  rejected: CodeFixResult[];
  /** Whether `config.evolution.enabled` allowed writing. */
  enabled: boolean;
  /** Present when votes were supplied to gate the change. */
  decision?: Decision;
}

/**
 * The canonical 7-step agent protocol — the single source of truth for step
 * numbers, names and the tool that completes each step. The MCP resource
 * `behavioros://protocol/steps` and the OpenCode plugin both serve this list,
 * so the three can no longer disagree.
 *
 * `currentStep` tracks the next step the agent should perform (0-based index
 * into this list), advancing monotonically as the corresponding tool runs.
 */
export const PROTOCOL_STEPS: readonly ProtocolStep[] = [
  {
    number: 1,
    name: 'Select DNA Pattern',
    description: 'Choose the behavioural DNA that will govern the session.',
    tool: 'bos_select_dna',
    required: true,
  },
  {
    number: 2,
    name: 'Confirm DNA Rules',
    description: 'Read the rules, quality gates and personas of the selected DNA.',
    tool: 'bos_list_dna',
    required: true,
  },
  {
    number: 3,
    name: 'Resolve State',
    description: 'Read the current protocol state before acting.',
    tool: 'bos_get_state',
    required: true,
  },
  {
    number: 4,
    name: 'Create Mission',
    description: 'Record the work as a mission so that it is auditable.',
    tool: 'bos_create_mission',
    required: true,
  },
  {
    number: 5,
    name: 'Start Mission',
    description: 'Start the mission and begin its governed execution.',
    tool: 'bos_start_mission',
    required: true,
  },
  {
    number: 6,
    name: 'Run Audit',
    description: 'Run the audit stages against the mission evidence.',
    tool: 'bos_run_audit',
    required: true,
  },
  {
    number: 7,
    name: 'Record Learning',
    description: 'Record what the run taught the organisation.',
    tool: 'bos_record_learning',
    required: true,
  },
];

/** Number of steps in {@link PROTOCOL_STEPS}. */
export const PROTOCOL_STEP_COUNT = PROTOCOL_STEPS.length;

/** Current schema version of the persisted {@link BehaviorOSSnapshot}. */
export const BEHAVIOROS_SNAPSHOT_VERSION = 2;

/** Versions {@link BehaviorOS.importState} can read (v1 predates graph state). */
export type BehaviorOSSnapshotVersion = 1 | typeof BEHAVIOROS_SNAPSHOT_VERSION;

/**
 * Complete, JSON-serializable snapshot of the engine state. Hosts (e.g. the
 * OpenCode plugin) persist this and feed it back to {@link BehaviorOS.importState}
 * so protocol progress, the selected DNA, missions and learnings survive a
 * process restart.
 */
export interface BehaviorOSSnapshot {
  version: BehaviorOSSnapshotVersion;
  exportedAt: string;
  agentState: AgentState;
  dna: DNA | null;
  missions: Mission[];
  learnings: LearningEvent[];
  /** Governed lifecycle records (G-014). Optional for pre-G-014 snapshots. */
  learningRecords?: LearningRecord[];
  /** Governed policy version ledger (Sprint 2). Optional for older snapshots. */
  policyLedger?: PolicyLedgerState;
  /**
   * Role/policy registry (roles, rules and recent decisions). Optional for
   * older snapshots; without it a registered role would vanish on restart and
   * every edit by that agent would fall back to the unknown-role fail-safe.
   */
  rolePolicy?: RolePolicyState;
  /**
   * Registered agents. Optional for older snapshots. Without it a restart keeps
   * the declared `agentState.agentId` but loses the agent record (type,
   * capabilities), so the type-based role fallback cannot run.
   */
  agents?: Agent[];
  /**
   * Knowledge graph (G-001). Optional for v1 snapshots. Without it every node
   * and edge written by `bos_add_knowledge_node` / `bos_record_learning`
   * disappeared on restart even though the graph is a first-class resource.
   */
  knowledgeGraph?: {
    nodes: import('@behavior-os/schemas').KnowledgeGraphNode[];
    edges: import('@behavior-os/schemas').KnowledgeGraphEdge[];
  };
  /**
   * Time-based governance rules. Optional for v1 snapshots. The SQLite store
   * already keeps them in `meta:temporal-governance-state`; the snapshot is the
   * durable channel for hosts that persist through `exportState()`.
   */
  temporalRules?: import('./temporal-governance-engine.js').TemporalRule[];
}

/** Agent id used when a session has not selected a DNA/persona or an agent. */
export const UNASSIGNED_AGENT_ID = 'unassigned';

/** Deterministic identity for a DNA persona acting without a registered agent. */
export function personaIdentity(persona: string): string {
  return `persona:${persona}`;
}

/**
 * The governed agent acting in a session.
 *
 * `agentId` is always derivable from the DNA/persona or an explicitly
 * registered agent — never from the model name — so an audit or governance
 * entry can be traced back to a role that the DNA actually authorises.
 */
export interface AgentIdentity {
  /** Id recorded in audits, governance decisions and the governance log. */
  agentId: string;
  /** Registered agent, when one is active. */
  agent: Agent | null;
  /** Persona selected from the active DNA. */
  persona: string | null;
  /** Active DNA pattern name. */
  dnaPattern: string | null;
  /** Where the identity came from. */
  source: 'registered' | 'explicit' | 'persona' | 'unassigned';
}
