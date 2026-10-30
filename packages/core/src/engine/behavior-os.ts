import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Agent,
  AgentState,
  AgentType,
  AuditReport,
  CodeEditRecord,
  CodeFixProposal,
  CodeFixResult,
  ConsensusVote,
  Decision,
  DecisionOutcome,
  DecisionPolicy,
  DNA,
  DriftInfo,
  EvolutionProposal,
  GovernanceAction,
  GovernanceDecision,
  LearningEvent,
  LearningImpact,
  LearningRecord,
  LearningStage,
  LearningType,
  Mission,
  MissionPriority,
  MissionStatus,
  MissionType,
  Persona,
  PipelineRun,
  Prediction,
  ProtocolStep,
  RankedRecommendation,
  Vote,
} from '@behavior-os/schemas';
import { load as yamlLoad } from 'js-yaml';
import { isControlPlaneAction, isMutatingAction } from '../action-classification.js';
import * as GovernanceLog from '../governance-log.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import type { Store } from '../persistence/store.js';
import { CodeEditEngine, type CodeEditPreview } from './code-edit-engine.js';
import type { DecideOptions } from './decision-engine.js';
import {
  type ConsensusEngine,
  type CrossDnaLearningEngine,
  type DecisionEngine,
  type DriftEngine,
  EngineRegistry,
  type LearningEngine,
  type PredictionEngine,
  type RecommendationEngine,
  type TemporalGovernanceEngine,
} from './index.js';
import type {
  AdvanceLearningRecordOptions,
  CreateLearningRecordOptions,
  LearningAdvanceResult,
} from './learning-engine.js';

import type {
  MissionEvidenceInput,
  MissionTransitionOptions,
  MissionTransitionResult,
} from './mission-engine.js';
import { MissionEngine } from './mission-engine.js';
import {
  type GateContext,
  PipelineEngine,
  type PipelineGate,
  type PreflightResult,
} from './pipeline-engine.js';

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

/** Tool name → step number that is completed by running that tool. */
const PROTOCOL_TOOL_STEPS: Readonly<Record<string, number>> = Object.fromEntries(
  PROTOCOL_STEPS.map((step) => [step.tool, step.number]),
);

/** Current schema version of the persisted {@link BehaviorOSSnapshot}. */
export const BEHAVIOROS_SNAPSHOT_VERSION = 1;

/**
 * Complete, JSON-serializable snapshot of the engine state. Hosts (e.g. the
 * OpenCode plugin) persist this and feed it back to {@link BehaviorOS.importState}
 * so protocol progress, the selected DNA, missions and learnings survive a
 * process restart.
 */
export interface BehaviorOSSnapshot {
  version: typeof BEHAVIOROS_SNAPSHOT_VERSION;
  exportedAt: string;
  agentState: AgentState;
  dna: DNA | null;
  missions: Mission[];
  learnings: LearningEvent[];
  /** Governed lifecycle records (G-014). Optional for pre-G-014 snapshots. */
  learningRecords?: LearningRecord[];
}

/** Deep-clone via JSON so a snapshot only ever contains persistable values. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

export class BehaviorOS {
  private registry: EngineRegistry;
  private currentDNA: DNA | null = null;
  private agentState: AgentState;
  private agents: Map<string, Agent> = new Map();
  private readonly config: BehaviorOSConfig;
  private store: Store | null = null;
  private storeInitError: string | null = null;
  private pipeline: PipelineEngine | null = null;
  private codeEditEngine: CodeEditEngine | null = null;

  constructor(config: BehaviorOSConfig = {}) {
    this.config = config;
    this.registry = new EngineRegistry();
    this.agentState = {
      currentStep: 0,
      selectedDna: null,
      agentId: null,
      persona: null,
      activeMission: null,
      stepHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Preload a DNA pattern when configured so the first governance/quality
    // evaluation does not require an explicit loadDNA() call.
    if (config.dnaPath) {
      void this.loadDNAFromPath(config.dnaPath);
    }

    // Opt-in persistence. Best-effort: a store that is unavailable must never
    // prevent the engine from starting. An injected store takes precedence over
    // the built-in SQLite path.
    const persistence = config.persistence;
    if (persistence?.store) {
      this.store = persistence.store;
      if (persistence.autoHydrate !== false) {
        this.hydrateFromStore();
      }
    } else if (persistence?.path) {
      try {
        this.store = new SqliteStore({ path: persistence.path });
        if (persistence.autoHydrate !== false) {
          this.hydrateFromStore();
        }
      } catch (storeError) {
        this.store = null;
        this.storeInitError = storeError instanceof Error ? storeError.message : String(storeError);
      }
    }
  }

  private async loadDNAFromPath(dnaPath: string): Promise<void> {
    try {
      const { readFileSync } = await import('node:fs');
      const { isAbsolute, resolve } = await import('node:path');
      const { load: yamlLoad } = await import('js-yaml');

      const resolved = isAbsolute(dnaPath) ? dnaPath : resolve(process.cwd(), dnaPath);
      const content = readFileSync(resolved, 'utf-8');
      const dna = this.registry.getDNALoader().load(yamlLoad(content));
      await this.loadDNA(dna);
    } catch {
      // DNA path is best-effort; callers can still loadDNA() explicitly.
    }
  }

  // DNA Management
  async loadDNA(dna: DNA): Promise<void> {
    this.currentDNA = dna;
    // Rebuild the gate pipeline so per-DNA quality gates reflect the new pattern.
    this.pipeline = null;
    // Clear the governance decision cache: decisions were computed under the
    // previous DNA's rules and may no longer be valid after a switch. Stale
    // cache entries would return the old verdict until TTL expiry (5 min),
    // which breaks cross-DNA continuity.
    this.registry.get<import('./index.js').GovernanceEngine>('governance')?.clearCache();
    this.agentState.selectedDna = dna.name;
    // Selecting a DNA also selects its first persona as the acting identity, so
    // audits and governance logs carry a DNA-derived agent rather than a model
    // name. A registered agent bound to this DNA wins over the persona.
    const registered = [...this.agents.values()].find((a) => a.dnaPattern === dna.name);
    if (registered) {
      this.agentState.agentId = registered.id;
      this.agentState.persona = registered.name;
    } else {
      const first = dna.personas[0];
      this.agentState.agentId = null;
      this.agentState.persona = first ? first.role || first.name : null;
      this.ensurePersonaRole(first ?? null);
    }
    this.agentState.updatedAt = new Date().toISOString();
    this.advanceProtocolStep('bos_select_dna');
  }

  // Governed agent identity -------------------------------------------------
  /**
   * Resolves the governed identity acting in this session.
   *
   * Priority: an activated registered agent → the DNA persona → `unassigned`.
   * A model name is never used as an agent id: a session that has not selected
   * a DNA/persona is reported as `unassigned` so the gap is visible instead of
   * being masked by whatever model happens to be running.
   */
  resolveAgentIdentity(): AgentIdentity {
    const dnaPattern = this.currentDNA?.name ?? null;
    const persona = this.agentState.persona;
    const active = this.agentState.agentId ? this.agents.get(this.agentState.agentId) : undefined;

    if (active) {
      return {
        agentId: active.id,
        agent: cloneJson(active),
        persona,
        dnaPattern,
        source: 'registered',
      };
    }
    if (this.agentState.agentId) {
      // Activated explicitly but no longer registered (e.g. after a snapshot
      // import): keep the id the session declared instead of silently dropping it.
      return {
        agentId: this.agentState.agentId,
        agent: null,
        persona,
        dnaPattern,
        source: 'explicit',
      };
    }
    if (persona) {
      return {
        agentId: personaIdentity(persona),
        agent: null,
        persona,
        dnaPattern,
        source: 'persona',
      };
    }
    return {
      agentId: UNASSIGNED_AGENT_ID,
      agent: null,
      persona: null,
      dnaPattern,
      source: 'unassigned',
    };
  }

  /**
   * Activates the agent identity for the session, from a registered agent id or
   * from a persona defined by the active DNA.
   *
   * Passing `name` (plus an unknown `id`) registers a new agent on the fly, so a
   * host command/prompt can name the acting agent without a separate setup step.
   * Returns the resolved identity, or `null` when nothing matched.
   */
  setActiveAgent(selector: {
    id?: string;
    name?: string;
    type?: string;
    capabilities?: string[];
    persona?: string;
  }): AgentIdentity | null {
    if (selector.id && !this.agents.has(selector.id) && selector.name) {
      this.registerAgent({
        id: selector.id,
        name: selector.name,
        type: (selector.type as AgentType) ?? 'operator',
        status: 'idle',
        dnaPattern: this.currentDNA?.name ?? 'default',
        capabilities: selector.capabilities ?? [],
        currentMission: this.agentState.activeMission,
        metrics: {
          tasksCompleted: 0,
          tasksFailed: 0,
          avgResponseTime: 0,
          governanceViolations: 0,
        },
      });
    }

    if (selector.id && this.agents.has(selector.id)) {
      const agent = this.agents.get(selector.id) as Agent;
      this.agentState.agentId = agent.id;
      this.agentState.persona = agent.name;
      this.agentState.updatedAt = new Date().toISOString();
      return this.resolveAgentIdentity();
    }

    if (selector.persona) {
      const wanted = selector.persona.toLowerCase();
      const match = this.currentDNA?.personas.find(
        (p) => p.role.toLowerCase() === wanted || p.name.toLowerCase() === wanted,
      );
      if (!match) return null;
      this.agentState.agentId = null;
      this.agentState.persona = match.role || match.name;
      this.agentState.updatedAt = new Date().toISOString();
      this.ensurePersonaRole(match);
      return this.resolveAgentIdentity();
    }

    return null;
  }

  /**
   * Makes a DNA persona resolvable as a role, **only** when no such role is
   * registered yet — an explicit registration always wins.
   *
   * WHY: role/policy evaluation then works out of the box for every DNA, with
   * zero configuration: the persona becomes attributable in the role engine's
   * audit trail and hosts can attach policies to it without registering a role
   * first. The auto-created role carries no policies and no privileges
   * (canAudit/canEnforce/canTeach all false) — the fail-safe posture: identity
   * and attribution, nothing more. Capabilities are opt-in per registration.
   */
  private ensurePersonaRole(persona: Persona | null): void {
    if (!persona) return;
    const roleId = persona.role.trim() ? persona.role : persona.name;
    if (roleId.trim() === '') return;
    const engine = this.getRolePolicyEngine();
    // Register under both the bare id and the persona-prefixed id so that
    // resolveAgentIdentity()'s `persona:<role>` lookup always finds the role
    // without requiring the host to manually register persona:* entries.
    const personaRoleId = `persona:${roleId}`;
    if (!engine.getRole(roleId)) {
      engine.registerRole({
        id: roleId,
        name: persona.name,
        displayName: persona.name,
        responsibilities: [...(persona.skills ?? [])],
        policies: [],
        canAudit: false,
        canEnforce: false,
        canTeach: false,
      });
    }
    if (!engine.getRole(personaRoleId)) {
      engine.registerRole({
        id: personaRoleId,
        name: persona.name,
        displayName: `${persona.name} (persona)`,
        responsibilities: [...(persona.skills ?? [])],
        policies: [],
        canAudit: false,
        canEnforce: false,
        canTeach: false,
      });
    }
    this.persistRolePolicyState();
  }

  // Protocol state machine --------------------------------------------------
  /**
   * Advances `currentStep` along the 7-step protocol when the given tool maps
   * to a protocol step. Advancement is monotonic (never goes backwards),
   * capped at the final step, and — except for DNA selection itself — requires
   * an active DNA pattern so browsing tools cannot skip the selection step.
   */
  advanceProtocolStep(toolName: string): void {
    const target = PROTOCOL_TOOL_STEPS[toolName];
    if (target === undefined) return;
    if (target > PROTOCOL_TOOL_STEPS.bos_select_dna && !this.currentDNA) return;

    const next = Math.min(Math.max(this.agentState.currentStep, target), PROTOCOL_STEP_COUNT);
    if (next > this.agentState.currentStep) {
      this.agentState.currentStep = next;
      this.agentState.stepHistory.push({
        step: next,
        tool: toolName,
        at: new Date().toISOString(),
      });
      this.agentState.updatedAt = new Date().toISOString();
    }
  }

  getDNA(): DNA | null {
    return this.currentDNA;
  }

  // Governance
  evaluateGovernance(
    action: string,
    context: { agent: string; scope?: string; [key: string]: unknown },
  ): GovernanceDecision {
    if (!this.currentDNA) {
      throw new Error('No DNA loaded. Call loadDNA() first.');
    }

    const startedAt = Date.now();
    const govEngine = this.registry.createGovernanceEngine(this.currentDNA);
    const decision = govEngine.evaluate({
      action,
      agentId: context.agent,
      context: (context.context || {}) as Record<string, unknown>,
    });

    // Governance-level policy: in lenient mode, soften hard denials into
    // escalations so autonomous agents can proceed with awareness of the risk.
    const finalDecision =
      decision.verdict === 'deny' && this.config.governance?.level === 'lenient'
        ? {
            ...decision,
            verdict: 'escalate' as const,
            reason: `${decision.reason} (softened by lenient governance level)`,
          }
        : decision;

    // Self-measurement: every evaluation through any host (plugin, MCP, CLI,
    // orchestrator) is counted here, once, at the single facade choke point.
    // `warn` only collides at the bucket level when the verdict is still
    // allow: the governance engine never emits a `warn` verdict — warnings
    // coexist with allow — so "warned" means "allowed but warned".
    const warned = finalDecision.verdict === 'allow' && (finalDecision.warnings?.length ?? 0) > 0;
    this.getMetricsEngine().recordGovernance(
      warned ? 'warn' : finalDecision.verdict,
      finalDecision.rulesEvaluated.length,
      Date.now() - startedAt,
      this.firedRuleActions(finalDecision),
    );
    return finalDecision;
  }

  /**
   * Map the decision's fired rule ids to their configured actions so metrics
   * can report per-rule impact. Falls back to `unknown` only if a fired rule
   * is missing from the active DNA (which can also not happen, because rules
   * only fire from the active DNA).
   */
  private firedRuleActions(decision: GovernanceDecision): Array<{ id: string; action: string }> {
    return (decision.firedRules ?? []).map((id) => ({
      id,
      action: this.currentDNA?.governance.find((rule) => rule.id === id)?.action ?? 'unknown',
    }));
  }

  // Quality Gates
  checkQuality(metrics: Record<string, number>): { passed: boolean; details: unknown } {
    if (!this.currentDNA) {
      return { passed: true, details: null };
    }

    const qualityEngine = this.registry.createQualityEngine(this.currentDNA);
    const result = qualityEngine.evaluate(metrics);
    return { passed: result.passed, details: result };
  }

  // Quality Engine
  /** Get the quality engine, creating it on first use. */
  getQualityEngine(): import('./quality-engine.js').QualityEngine {
    if (!this.currentDNA) {
      throw new Error('No DNA loaded. Call loadDNA() first.');
    }
    let engine = this.registry.get<import('./quality-engine.js').QualityEngine>('quality');
    if (!engine) engine = this.registry.createQualityEngine(this.currentDNA);
    return engine;
  }

  /** Assess the pragmatic value of a set of code changes. */
  assessPragmaticValue(
    changes: Array<{ addedLines: number; removedLines: number }>,
    metrics: {
      before: { complexity: number; testCoverage: number; rulesCount: number };
      after: { complexity: number; testCoverage: number; rulesCount: number };
    },
  ) {
    return this.getQualityEngine().assessPragmaticValue(changes, metrics);
  }

  // Gate Pipeline -----------------------------------------------------------
  /**
   * Build (once) the gate pipeline. Default gates:
   *  - `governance` (pre, blocking) — a `deny` verdict blocks the action;
   *  - one `quality:<id>` gate per DNA quality gate (post, blocking).
   *
   * Supplying `config.pipeline.gates` replaces the defaults entirely, and
   * `config.pipeline.enabled: false` yields an empty (pass-through) pipeline.
   * The pipeline is rebuilt whenever the DNA changes so per-DNA gates are current.
   */
  getPipelineEngine(): PipelineEngine {
    if (this.pipeline) return this.pipeline;

    const configured = this.config.pipeline?.gates;
    const pipeline = new PipelineEngine(configured);

    if (!configured && this.config.pipeline?.enabled !== false) {
      pipeline.addGate({
        id: 'governance',
        name: 'Governance rules',
        phase: 'pre',
        blocking: true,
        evaluate: (ctx: GateContext) => {
          if (!this.currentDNA) {
            return { status: 'skipped', details: { reason: 'No DNA pattern selected' } };
          }
          const decision = this.evaluateGovernance(ctx.action ?? '', {
            agent: ctx.agentId ?? 'system',
            // Surface the action as a condition flag so DNA rules can match on it,
            // alongside any caller-supplied flags (which take precedence).
            context: { action: ctx.action, ...(ctx.context ?? {}) },
          });
          if (decision.verdict === 'deny') {
            return {
              status: 'failed',
              details: { verdict: decision.verdict, reason: decision.reason },
            };
          }
          if (decision.verdict === 'escalate' || decision.verdict === 'transform') {
            return {
              status: 'warning',
              details: { verdict: decision.verdict, reason: decision.reason },
            };
          }
          return { status: 'passed', details: { verdict: decision.verdict } };
        },
      });

      for (const gate of this.currentDNA?.quality ?? []) {
        pipeline.addGate({
          id: `quality:${gate.id}`,
          name: `Quality gate: ${gate.id}`,
          phase: 'post',
          blocking: true,
          evaluate: (ctx: GateContext) => {
            if (!this.currentDNA) {
              return { status: 'skipped', details: { reason: 'No DNA pattern selected' } };
            }
            const evaluation = this.registry
              .createQualityEngine(this.currentDNA)
              .evaluateGate(gate, ctx.metrics ?? {});
            return { status: evaluation.status, details: { ...evaluation } };
          },
        });
      }
    }

    this.pipeline = pipeline;
    return pipeline;
  }

  /**
   * Synchronously check whether an action may proceed. Runs only the `pre`
   * gates, so this is a real pre-execution veto usable by any host — not just
   * the OpenCode plugin. A blocked pre-flight is persisted to the audit log when
   * a store is attached.
   */
  preflightAction(
    action: string,
    context: { agent: string; context?: Record<string, unknown> } = { agent: 'system' },
  ): PreflightResult {
    const result = this.getPipelineEngine().preflight({
      action,
      agentId: context.agent,
      context: context.context ?? {},
      missionId: this.agentState.activeMission ?? undefined,
    });
    if (!result.allowed) this.store?.savePipelineRun(result.run);
    return result;
  }

  /** Run the full pipeline (pre + post gates) and persist the run. */
  runPipeline(context: GateContext = {}): PipelineRun {
    const run = this.getPipelineEngine().run(context);
    this.store?.savePipelineRun(run);
    return run;
  }

  /** Read persisted pipeline runs, newest first. Empty without a store. */
  listPipelineRuns(limit = 50): PipelineRun[] {
    return this.store?.listPipelineRuns(limit) ?? [];
  }

  // Audit
  /**
   * Runs an audit attributed to the session's governed identity.
   *
   * `agentId` is optional on purpose: when omitted, the id is resolved with
   * {@link resolveAgentIdentity} from the active DNA persona (or a registered
   * agent), so an audit can never be attributed to the model name. An explicit
   * id is honoured as-is, but the DNA pattern and persona are always stamped on
   * the report so the entry stays traceable.
   */
  async runAudit(options: {
    missionId: string;
    agentId?: string;
    stages?: string[];
    simulate?: boolean;
    /** Workspace root for the real stages; see AuditOptions.root. */
    root?: string;
  }): Promise<AuditReport> {
    const auditEngine = this.registry.createAuditEngine();
    const stages = options.stages?.length
      ? options.stages
      : ['lint', 'typecheck', 'security', 'coverage'];
    const identity = this.resolveAgentIdentity();
    // Simulated remains the default for direct engine callers, but the report
    // is annotated and downgraded so it can never be mistaken for a real
    // verification or authorize completion.
    const simulate = options.simulate !== false;

    const report = await auditEngine.run({
      ...options,
      simulate,
      agentId: options.agentId ?? identity.agentId,
      dnaPattern: identity.dnaPattern,
      persona: identity.persona,
      stages: stages as import('@behavior-os/schemas').AuditStage[],
    });
    const annotated: AuditReport = simulate
      ? {
          ...report,
          simulated: true,
          overall: 'warning',
          summary: `SIMULATED — no verification executed. ${report.summary}`,
        }
      : { ...report, simulated: false };

    this.advanceProtocolStep('bos_run_audit');
    this.store?.saveAuditReport(annotated);
    return annotated;
  }

  // Missions
  private getMissionEngine(): MissionEngine {
    let engine = this.registry.get<MissionEngine>('mission');
    if (!engine) {
      engine = this.registry.createMissionEngine(this.currentDNA ?? undefined);
    }
    return engine;
  }

  private getLearningEngine(): LearningEngine {
    let engine = this.registry.get<LearningEngine>('learning');
    if (!engine) {
      engine = this.registry.createLearningEngine();
    }
    return engine;
  }

  createMission(options: {
    title: string;
    description?: string;
    type: string;
    priority: string;
    dnaPattern?: string;
    createdBy?: string;
    tags?: string[];
    /** Gates that must each have passing evidence before completion. */
    requiredChecks?: string[];
    /** `executed` requires real, provenance-stamped evidence for every gate. */
    verificationMode?: 'any' | 'executed';
    /**
     * Whether creating this mission should advance the 7-step protocol. The
     * plugin's auto-mission passes `false` so protocol progress still reflects
     * work the agent performed explicitly. Defaults to `true`.
     */
    advanceProtocol?: boolean;
  }): Mission {
    const { advanceProtocol, ...missionOptions } = options;
    const engine = this.getMissionEngine();
    const mission = engine.create({
      ...missionOptions,
      type: options.type as MissionType,
      priority: options.priority as MissionPriority,
      dnaPattern: options.dnaPattern ?? this.currentDNA?.name ?? 'default',
      createdBy: options.createdBy ?? 'system',
    });
    if (this.store) {
      try {
        this.store.saveMission(mission);
      } catch (error) {
        // Creation must not leave a mission that durable state never saw.
        engine.remove(mission.id);
        throw error;
      }
    }
    if (advanceProtocol !== false) {
      this.advanceProtocolStep('bos_create_mission');
    }
    return mission;
  }

  /**
   * Apply a validated mission transition and persist it atomically.
   *
   * Memory is rolled back when the store write throws, so a failed persistence
   * can never leave the engine ahead of durable state. The write is a single
   * idempotent upsert; no multi-write transaction is claimed.
   */
  transitionMission(
    missionId: string,
    to: MissionStatus,
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const engine = this.getMissionEngine();
    const before = engine.get(missionId);
    const rollback = before ? structuredClone(before) : null;

    const result = engine.transition(missionId, to, options);
    if (!result.ok || !result.changed) return result;

    if (this.store) {
      try {
        this.store.saveMission(result.mission);
      } catch (error) {
        if (rollback) engine.restoreOne(rollback);
        return {
          ok: false,
          code: 'PERSISTENCE_FAILED',
          message: `Failed to persist mission "${missionId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          mission: rollback,
          from: before?.status,
          to,
        };
      }
    }

    const now = new Date().toISOString();
    if (to === 'active') {
      // Starting (or resuming) makes this the single active mission.
      this.agentState.activeMission = missionId;
      this.agentState.updatedAt = now;
    } else if (MissionEngine.isTerminal(to) && this.agentState.activeMission === missionId) {
      this.agentState.activeMission = null;
      this.agentState.updatedAt = now;
    }

    return result;
  }

  /**
   * Append evidence to an in-flight mission and persist it atomically, with the
   * same rollback guarantee as {@link transitionMission}. Used by orchestrators
   * that record each task's verified result as it completes.
   */
  addMissionEvidence(
    missionId: string,
    evidence: MissionEvidenceInput[],
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    const engine = this.getMissionEngine();
    const before = engine.get(missionId);
    const rollback = before ? structuredClone(before) : null;

    const result = engine.addEvidence(missionId, evidence, options);
    if (!result.ok || !result.changed) return result;

    if (this.store) {
      try {
        this.store.saveMission(result.mission);
      } catch (error) {
        if (rollback) engine.restoreOne(rollback);
        return {
          ok: false,
          code: 'PERSISTENCE_FAILED',
          message: `Failed to persist evidence for mission "${missionId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          mission: rollback,
          from: before?.status,
          to: before?.status ?? 'active',
        };
      }
    }

    return result;
  }

  startMission(missionId: string, options: { advanceProtocol?: boolean } = {}): Mission | null {
    const result = this.transitionMission(missionId, 'active');
    if (!result.ok) return null;
    if (result.changed && options.advanceProtocol !== false) {
      this.advanceProtocolStep('bos_start_mission');
    }
    return result.mission;
  }

  completeMission(missionId: string, options: MissionTransitionOptions = {}): Mission | null {
    const result = this.transitionMission(missionId, 'completed', options);
    return result.ok ? result.mission : null;
  }

  failMission(
    missionId: string,
    reason?: string,
    options: Omit<MissionTransitionOptions, 'reason'> = {},
  ): Mission | null {
    const result = this.transitionMission(missionId, 'failed', { ...options, reason });
    return result.ok ? result.mission : null;
  }

  pauseMission(missionId: string, options: MissionTransitionOptions = {}): MissionTransitionResult {
    return this.transitionMission(missionId, 'paused', options);
  }

  resumeMission(
    missionId: string,
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    return this.transitionMission(missionId, 'active', options);
  }

  cancelMission(
    missionId: string,
    options: MissionTransitionOptions = {},
  ): MissionTransitionResult {
    return this.transitionMission(missionId, 'cancelled', options);
  }

  // Learning
  recordLearning(options: {
    type: string;
    source: string;
    content: string;
    impact: string;
    relatedMission?: string;
    relatedPattern?: string;
    /**
     * Whether recording this event should advance the 7-step protocol. Internal
     * automation (e.g. the OpenCode hook capturing tool failures) passes `false`
     * so only agent-driven calls move the protocol forward. Defaults to `true`.
     */
    advanceProtocol?: boolean;
  }): LearningEvent {
    const event = this.getLearningEngine().record({
      ...options,
      type: options.type as LearningType,
      impact: options.impact as LearningImpact,
    });
    this.getMetricsEngine().recordLearningEvent(event.type);
    if (options.advanceProtocol !== false) {
      this.advanceProtocolStep('bos_record_learning');
    }
    this.store?.saveLearning(event);
    return event;
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.getLearningEngine().getInsights(limit);
  }

  /** All recorded learning events, in the order the engine keeps them. */
  getLearningEvents(): LearningEvent[] {
    return this.getLearningEngine().getEvents();
  }

  // Governed learning lifecycle (G-014) --------------------------------------
  /**
   * Open a learning record at the `observation` stage. Promotion is explicit
   * and evidence-backed; see {@link advanceLearningRecord}.
   */
  createLearningRecord(options: CreateLearningRecordOptions): LearningRecord {
    const record = this.getLearningEngine().createRecord(options);
    // Lifecycle records (G-014) must survive a restart like every other
    // governed entity; the learning EVENTS already persist via entity rows,
    // the records ride the same meta channel as role/policy state.
    this.persistLearningRecords();
    return record;
  }

  /** Promote a learning record exactly one lifecycle stage forward. */
  advanceLearningRecord(
    id: string,
    to: LearningStage,
    options: AdvanceLearningRecordOptions = {},
  ): LearningAdvanceResult {
    const result = this.getLearningEngine().advanceRecord(id, to, options);
    // A refused promotion leaves the record untouched — persisting then would
    // just rewrite identical state, so only successful transitions store.
    if (result.ok) this.persistLearningRecords();
    return result;
  }

  /** Write the learning-record lifecycle (G-014) to the store's metadata. */
  private persistLearningRecords(): void {
    if (!this.store) return;
    this.store.setMeta(
      'learning-records',
      JSON.stringify(this.getLearningEngine().snapshotRecords()),
    );
  }

  getLearningRecords(): LearningRecord[] {
    return this.getLearningEngine().getRecords();
  }

  // DNA evolution (learning-driven) -----------------------------------------
  /**
   * Confidence-scored DNA-change proposals derived from repeated learning
   * events. Pure read: nothing is mutated. Default `minConfidence` is 0.8.
   */
  proposeEvolution(
    minConfidence = this.config.evolution?.minConfidence ?? 0.8,
  ): EvolutionProposal[] {
    return this.getLearningEngine().proposeEvolution(
      this.currentDNA?.name ?? 'default',
      minConfidence,
    );
  }

  /**
   * Apply evolution proposals to the active DNA. This only happens when
   * `config.evolution.enabled` is true and the caller passes `apply: true`.
   *
   * Proposals are applied per-type:
   * - `add-warn`: adds a new `warn` rule — no vote required, safe by construction.
   * - `relax-block`: relaxes a `block` rule to `escalate` or `warn` — requires
   *   a vote gate with threshold 0.67 (supermajority).
   * - `add-block`: adds a new `block` rule — requires a vote gate with
   *   threshold 0.90 (near-unanimous).
   *
   * When `votes` are supplied, the decision engine evaluates each vote-gated
   * proposal independently. Proposals without `requiresVote` are applied
   * directly; proposals with `requiresVote` are skipped unless the supplied
   * votes meet or exceed the proposal's `voteThreshold`.
   */
  applyEvolution(
    options: {
      minConfidence?: number;
      apply?: boolean;
      votes?: Vote[];
      policy?: DecisionPolicy;
    } = {},
  ): EvolutionResult {
    const minConfidence = options.minConfidence ?? this.config.evolution?.minConfidence ?? 0.8;
    const proposals = this.proposeEvolution(minConfidence);
    const enabled = this.config.evolution?.enabled === true;

    if (options.apply !== true || !enabled || !this.currentDNA) {
      return { proposals, applied: [], enabled };
    }

    // When votes are supplied, evaluate them against vote-gated proposals.
    let voteApproval: Decision | undefined;
    if (options.votes && options.votes.length > 0) {
      voteApproval = this.decide({
        subject: `DNA evolution (${proposals.length} proposal(s))`,
        votes: options.votes,
        policy: options.policy ?? 'majority',
      });
    }

    const governance = [...this.currentDNA.governance];
    const applied: EvolutionProposal[] = [];
    const voteSkipped: EvolutionProposal[] = [];

    for (const proposal of proposals) {
      if (governance.some((rule) => rule.id === proposal.ruleId)) continue;
      // Guard against the inert rule regression: a proposal whose condition no
      // real host context key can match would never fire.
      if (!proposal.condition) continue;

      // Determine the effective action for this proposal
      let ruleAction: 'warn' | 'escalate' | 'block' = 'warn';

      // Vote-gate check for proposals that require approval.
      // Only vote-gated proposals are affected; add-warn proposals
      // (requiresVote: false) are applied directly.
      if (proposal.requiresVote && (proposal.voteThreshold ?? 0) > 0) {
        if (voteApproval?.outcome !== 'approved') {
          voteSkipped.push(proposal);
          continue;
        }
        const totalWeight = voteApproval.approve + voteApproval.reject + voteApproval.abstain;
        const approvalRatio = totalWeight > 0 ? voteApproval.approve / totalWeight : 0;
        if (approvalRatio < proposal.voteThreshold) {
          voteSkipped.push(proposal);
          continue;
        }
      }

      if (proposal.changeType === 'relax-block') {
        // Relax: find the existing block/escalate rule and soften it
        const existing = governance.find((r) => r.action === 'block' || r.action === 'escalate');
        if (existing) {
          ruleAction = existing.action === 'block' ? 'escalate' : 'warn';
          existing.action = ruleAction;
          existing.conditions = [...(existing.conditions ?? []), proposal.condition];
          existing.description = `${existing.description ?? ''} [relaxed by evolution]`;
          applied.push(proposal);
          continue;
        }
        // No block/escalate rule to relax — skip
        continue;
      }

      if (proposal.changeType === 'add-block') {
        ruleAction = 'block';
      }

      // Add the new rule
      const level =
        (ruleAction as 'warn' | 'escalate' | 'block') === 'block'
          ? 'critical'
          : (ruleAction as 'warn' | 'escalate' | 'block') === 'escalate'
            ? 'high'
            : 'medium';
      governance.push({
        id: proposal.ruleId,
        level,
        action: ruleAction as GovernanceAction,
        conditions: [proposal.condition],
        description: proposal.description,
      });
      applied.push(proposal);
    }

    if (applied.length > 0) {
      // New object identity so the registry rebuilds the DNA-bound engines.
      this.currentDNA = { ...this.currentDNA, governance };
      this.registry.createGovernanceEngine(this.currentDNA);
      this.pipeline = null;
      for (const proposal of applied) {
        this.recordLearning({
          type: 'optimization',
          source: 'dna-evolution',
          content: `Applied ${proposal.changeType} rule ${proposal.ruleId} (confidence ${proposal.confidence})`,
          impact: proposal.changeType === 'add-block' ? 'high' : 'medium',
          relatedPattern: proposal.pattern,
          advanceProtocol: false,
        });
      }
    }

    return {
      proposals,
      applied,
      enabled,
      voteSkipped,
      ...(voteApproval ? { decision: voteApproval } : {}),
    };
  }

  /**
   * Confidence-scored code-fix proposals derived from repeated `fix` events.
   * This is a pure read — no files are touched. Default `minConfidence` is
   * three `fix` events of impact `critical` reach ~0.84 and qualify.
   */
  proposeCodeFixes(minConfidence = this.config.evolution?.minConfidence ?? 0.8): CodeFixProposal[] {
    return this.getLearningEngine().proposeCodeFixes(minConfidence);
  }

  /**
   * Apply code-fix proposals to persistent storage. Three independent locks must
   * all be satisfied (same design as `applyEvolution`):
   * 1. `config.evolution.enabled === true`;
   * 2. the call passes `apply: true`;
   * 3. when `votes` are supplied, the decision engine approves them.
   *
   * Unlike `applyEvolution`, this does **not** mutate the active DNA — it only
   * records each accepted proposal so the agent can act on it later.
   */
  applyCodeFixes(
    options: {
      minConfidence?: number;
      apply?: boolean;
      votes?: Vote[];
      policy?: DecisionPolicy;
    } = {},
  ): CodeFixApplyResult {
    const minConfidence = options.minConfidence ?? this.config.evolution?.minConfidence ?? 0.8;
    const proposals = this.proposeCodeFixes(minConfidence);
    const enabled = this.config.evolution?.enabled === true;

    if (options.apply !== true || !enabled) {
      return { proposals, applied: [], rejected: [], enabled };
    }

    let decision: Decision | undefined;
    let voteOutcome: DecisionOutcome | undefined;
    let voteTally: { approve: number; reject: number; abstain: number } | undefined;
    if (options.votes && options.votes.length > 0) {
      decision = this.decide({
        subject: `Code fix evolution (${proposals.length} proposal(s))`,
        votes: options.votes,
        policy: options.policy,
      });
      voteOutcome = decision.outcome;
      voteTally = { approve: decision.approve, reject: decision.reject, abstain: decision.abstain };
      if (decision.outcome !== 'approved') {
        // Record the refusal so the proposal history stays versioned: a rejected
        // proposal is evidence, not noise.
        const rejected = this.recordCodeFixResults(proposals, {
          applied: false,
          voteOutcome,
          voteTally,
        });
        return { proposals, applied: [], rejected, enabled, decision };
      }
    }

    // Only *applied* records block a re-application, so a proposal that was
    // rejected once can still be approved later.
    const existingPatterns = new Set(
      this.listCodeFixResults()
        .filter((result) => result.applied)
        .map((result) => result.pattern),
    );
    const fresh = proposals.filter((proposal) => !existingPatterns.has(proposal.pattern));
    const applied = this.recordCodeFixResults(fresh, {
      applied: true,
      ...(voteOutcome ? { voteOutcome } : {}),
      ...(voteTally ? { voteTally } : {}),
    });
    for (const result of applied) {
      this.recordLearning({
        type: 'optimization',
        source: 'code-fix-evolution',
        content: `Applied code fix for pattern ${result.pattern} (confidence ${result.confidence})`,
        impact: 'medium',
        relatedPattern: result.pattern,
        advanceProtocol: false,
      });
    }

    return { proposals, applied, rejected: [], enabled, ...(decision ? { decision } : {}) };
  }

  /**
   * Persist one {@link CodeFixResult} per proposal. Best effort: without a store
   * the records are still returned, like the rest of the engine.
   */
  private recordCodeFixResults(
    proposals: CodeFixProposal[],
    options: {
      applied: boolean;
      voteOutcome?: DecisionOutcome;
      voteTally?: { approve: number; reject: number; abstain: number };
    },
  ): CodeFixResult[] {
    return proposals.map((proposal) => {
      const result: CodeFixResult = {
        id: `fixr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        proposalId: proposal.id,
        pattern: proposal.pattern,
        confidence: proposal.confidence,
        applied: options.applied,
        ...(options.voteOutcome ? { voteOutcome: options.voteOutcome } : {}),
        ...(options.voteTally ? { voteTally: options.voteTally } : {}),
        ...(this.agentState.activeMission ? { missionId: this.agentState.activeMission } : {}),
        timestamp: new Date().toISOString(),
      };
      this.store?.saveCodeFixResult(result);
      return result;
    });
  }

  /**
   * Read persisted code-fix results, newest first. Empty without a store.
   */
  listCodeFixResults(limit = 50): CodeFixResult[] {
    return this.store?.listCodeFixResults(limit) ?? [];
  }

  // Governed code editing ------------------------------------------------
  /** The lazily created code-edit engine, bound to `config.codeEdit.root`. */
  getCodeEditEngine(): CodeEditEngine {
    if (!this.codeEditEngine) {
      this.codeEditEngine = new CodeEditEngine({
        root: this.config.codeEdit?.root,
        extensions: this.config.codeEdit?.extensions,
      });
    }
    return this.codeEditEngine;
  }

  /** Read persisted code-edit records (dry-runs and refusals included). */
  listCodeEdits(limit = 50): CodeEditRecord[] {
    return this.store?.listCodeEdits(limit) ?? [];
  }

  /**
   * Validate, preview and (only when the locks allow it) apply a single-text
   * replacement edit to a file inside the workspace.
   *
   * Four independent guards, in order:
   * 1. the guard rails in {@link CodeEditEngine.preview} (path inside the root,
   *    editable extension, unique match, size cap);
   * 2. `apply: true` — without it this is a **dry run** and nothing is written;
   * 3. `config.codeEdit.enabled === true` — the opt-in lock;
   * 4. when `votes` are supplied, the decision engine must approve them.
   *
   * Every evaluated edit is recorded (applied or not) with the before/after
   * hashes, so refusals are auditable instead of invisible. The write itself is
   * atomic and refuses a stale `expectedBeforeHash` instead of overwriting
   * concurrent changes.
   */
  applyCodeEdit(options: {
    file: string;
    find: string;
    replace: string;
    apply?: boolean;
    expectedBeforeHash?: string;
    votes?: Vote[];
    policy?: DecisionPolicy;
    missionId?: string;
  }): CodeEditApplyResult {
    const enabled = this.config.codeEdit?.enabled === true;
    const engine = this.getCodeEditEngine();

    let preview: CodeEditPreview;
    try {
      preview = engine.preview({
        file: options.file,
        find: options.find,
        replace: options.replace,
      });
    } catch (error) {
      return {
        preview: null,
        record: null,
        applied: false,
        enabled,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const base = {
      enabled,
      preview,
      missionId: options.missionId,
    };
    const record = (
      applied: boolean,
      reason: string,
      vote?: {
        outcome: DecisionOutcome;
        tally: { approve: number; reject: number; abstain: number };
      },
    ): CodeEditRecord => {
      const identity = this.resolveAgentIdentity();
      const entry: CodeEditRecord = {
        id: `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: preview.file,
        beforeHash: preview.beforeHash,
        afterHash: preview.afterHash,
        bytesBefore: preview.bytesBefore,
        bytesAfter: preview.bytesAfter,
        addedLines: preview.addedLines,
        removedLines: preview.removedLines,
        occurrences: preview.occurrences,
        applied,
        reason,
        agentId: identity.agentId,
        dnaPattern: identity.dnaPattern,
        ...(vote ? { voteOutcome: vote.outcome, voteTally: vote.tally } : {}),
        ...((options.missionId ?? this.agentState.activeMission)
          ? { missionId: options.missionId ?? this.agentState.activeMission ?? undefined }
          : {}),
        timestamp: new Date().toISOString(),
      };
      this.store?.saveCodeEdit(entry);
      return entry;
    };

    if (options.apply !== true) {
      return { ...base, record: record(false, 'dry-run'), applied: false, reason: 'dry-run' };
    }
    if (!enabled) {
      return {
        ...base,
        record: record(false, 'opt-in-disabled'),
        applied: false,
        reason: 'opt-in-disabled',
      };
    }

    let decision: Decision | undefined;
    if (options.votes && options.votes.length > 0) {
      decision = this.decide({
        subject: `Code edit ${preview.file}`,
        votes: options.votes,
        policy: options.policy,
      });
      const tally = {
        approve: decision.approve,
        reject: decision.reject,
        abstain: decision.abstain,
      };
      if (decision.outcome !== 'approved') {
        return {
          ...base,
          record: record(false, 'vote-rejected', { outcome: decision.outcome, tally }),
          applied: false,
          reason: 'vote-rejected',
          decision,
        };
      }
    }

    try {
      engine.apply(
        { file: options.file, find: options.find, replace: options.replace },
        { expectedBeforeHash: options.expectedBeforeHash },
      );
    } catch (error) {
      return {
        ...base,
        record: record(false, 'guard-refused'),
        applied: false,
        reason: 'guard-refused',
        error: error instanceof Error ? error.message : String(error),
        ...(decision ? { decision } : {}),
      };
    }

    const appliedRecord = record(true, 'applied');
    this.recordLearning({
      type: 'optimization',
      source: 'code-edit',
      content: `Applied governed edit to ${preview.file} (${preview.beforeHash.slice(0, 19)} -> ${preview.afterHash.slice(0, 19)})`,
      impact: 'medium',
      relatedMission: appliedRecord.missionId,
      advanceProtocol: false,
    });
    return { ...base, record: appliedRecord, applied: true, ...(decision ? { decision } : {}) };
  }

  // Decisions (voting/quorum) ----------------------------------------------
  private getDecisionEngine(): DecisionEngine {
    let engine = this.registry.get<DecisionEngine>('decision');
    if (!engine) engine = this.registry.createDecisionEngine();
    return engine;
  }

  /**
   * Resolve a subject by weighted vote. `policy`/`quorum` fall back to the
   * `decision` config. The outcome is persisted when a store is attached.
   */
  decide(options: DecideOptions): Decision {
    const { policy, quorum, ...rest } = options;
    const decision = this.getDecisionEngine().decide({
      ...rest,
      policy: policy ?? this.config.decision?.policy,
      quorum: quorum ?? this.config.decision?.quorum,
      missionId: rest.missionId ?? this.agentState.activeMission ?? undefined,
    });
    this.store?.saveDecision(decision);
    this.getMetricsEngine().recordConsensus(
      decision.outcome,
      options.votes.length,
      options.votes.reduce((sum, vote) => sum + (vote.weight ?? 1), 0),
    );
    return decision;
  }

  /** Read persisted decisions, newest first. Empty without a store. */
  listDecisions(limit = 50): Decision[] {
    return this.store?.listDecisions(limit) ?? [];
  }

  // Recommendations ----------------------------------------------------------
  /**
   * Scored recommendations derived from recent learning events. Uses
   * {@link RecommendationEngine}.
   */
  recommend(limit = 5, ageLimitHours = 168): RankedRecommendation[] {
    let engine = this.registry.get<RecommendationEngine>('recommendation');
    if (!engine) engine = this.registry.createRecommendationEngine();
    return engine.recommend(this.getLearningEngine().getEvents(), limit, ageLimitHours);
  }

  // Drift detection --------------------------------------------------------
  /**
   * Compare two DNA snapshots and return the behavioral drift between them.
   * A drift is significant when `totalChanges >= 2`.
   */
  compareDNADrift(dnaA: DNA, dnaB: DNA): DriftInfo {
    return this.getDriftEngine().compare(dnaA, dnaB);
  }

  // Drift (public accessor for host tools) ----------------------------------
  /** Get the drift engine, creating it on first use. */
  getDriftEngine(): DriftEngine {
    let engine = this.registry.get<DriftEngine>('drift');
    if (!engine) engine = this.registry.createDriftEngine();
    return engine;
  }

  // Consensus ----------------------------------------------------------------
  /**
   * Resolve a multi-agent consensus round. Votes are weighted; ties and
   * all-abstain resolve to `rejected` (fail-safe).
   */
  resolveConsensus(options: {
    subject: string;
    votes: ConsensusVote[];
    policy?: 'unanimous' | 'supermajority' | 'majority';
    quorum?: number;
  }): import('./consensus-engine.js').ConsensusOutcome {
    let engine = this.registry.get<ConsensusEngine>('consensus');
    if (!engine) engine = this.registry.createConsensusEngine();
    return engine.resolve(options);
  }

  // Prediction ---------------------------------------------------------------
  /**
   * Predict likely future governance events from learning history.
   */
  predict(limit = 5): Prediction[] {
    let engine = this.registry.get<PredictionEngine>('prediction');
    if (!engine) engine = this.registry.createPredictionEngine();
    return engine.predict(this.getLearningEngine().getEvents(), limit);
  }

  // Cross-DNA Learning -------------------------------------------------------
  /**
   * Suggest learning transfers from one DNA to another based on shared patterns.
   */
  suggestCrossDnaTransfer(sourceDna: DNA, targetDna: DNA, minConfidence = 0.5) {
    let engine = this.registry.get<CrossDnaLearningEngine>('cross-dna-learning');
    if (!engine) engine = this.registry.createCrossDnaLearningEngine();
    return engine.suggestTransfers(
      sourceDna,
      targetDna,
      this.getLearningEngine().getEvents(),
      minConfidence,
    );
  }

  // Metrics & Observability -------------------------------------------------
  /** Get current system-wide metrics snapshot. */
  getMetrics() {
    return this.getMetricsEngine().metrics;
  }

  /** Lazily-created metrics engine shared by all instrumentation points. */
  private getMetricsEngine(): import('./metrics-engine.js').MetricsEngine {
    let engine = this.registry.get<import('./metrics-engine.js').MetricsEngine>('metrics');
    if (!engine) engine = this.registry.createMetricsEngine();
    return engine;
  }

  /** Reset all governance metrics. */
  resetMetrics(): void {
    this.getMetricsEngine().reset();
  }

  /** Record a governance evaluation for metrics tracking. */
  recordGovernanceEvent(
    verdict: 'allow' | 'deny' | 'escalate' | 'warn' | 'log',
    rulesEvaluated: number,
    latencyMs: number,
    firedRules?: Array<{ id: string; action: string }>,
  ): void {
    this.getMetricsEngine().recordGovernance(verdict, rulesEvaluated, latencyMs, firedRules);
    // Mirror the event into the hash-chained governance log so the same
    // `bos_get_log` / `bos_verify_audit_trail` observability is available to
    // MCP hosts, not just the OpenCode plugin (Finding #8: dual audit systems).
    // 'log' maps to 'info' in the governance log outcome vocabulary.
    const logOutcome: GovernanceLog.GovernanceLogOutcome =
      verdict === 'log' ? 'info' : verdict === 'allow' ? 'allow' : verdict;
    GovernanceLog.appendGovernanceLog({
      kind: 'permission',
      outcome: logOutcome,
      dna: this.currentDNA?.name ?? null,
      step: this.agentState.currentStep,
      mission: this.agentState.activeMission ?? null,
      action: firedRules?.map((r) => r.action).join(',') ?? 'unknown',
      detail: `rulesEvaluated=${rulesEvaluated} latency=${latencyMs}ms`,
    });
  }

  // Governance Log (read / verify / sink) ----------------------------------
  // Exposed so MCP hosts (not just the OpenCode plugin) can read the
  // hash-chained governance log and verify its integrity (Finding #8).

  /** Return the most recent governance log events (newest last), capped at `limit`. */
  getGovernanceLog(limit = 50): GovernanceLog.GovernanceLogEvent[] {
    return GovernanceLog.getGovernanceLog(limit);
  }

  /** Enable or reset the durable append-only JSONL audit sink. */
  initGovernanceLogSink(filePath: string | null): void {
    GovernanceLog.initGovernanceLogSink(filePath);
  }

  /** Current sink status: `path` is null when the durable sink is disabled. */
  getGovernanceLogSink(): { path: string | null; writeErrors: number } {
    return GovernanceLog.getGovernanceLogSinkStatus();
  }

  /** Current chain head + anchor, for external attestation. */
  getGovernanceChainHead(): { head: string; anchor: string; length: number } {
    return GovernanceLog.getGovernanceChainHead();
  }

  /**
   * Verify the in-memory hash chain over the retained events.
   * Returns `{ valid, checked, complete }` — `complete: false` means only
   * the retained window was attested, not the evicted history.
   */
  verifyAuditTrail(): GovernanceLog.ChainVerification {
    return GovernanceLog.verifyGovernanceLog();
  }

  // Brainstorming & Collaboration ------------------------------------------
  /** Get the brainstorm engine, creating it on first use. */
  getBrainstorm(): import('./brainstorm-engine.js').BrainstormEngine {
    let engine = this.registry.get<import('./brainstorm-engine.js').BrainstormEngine>('brainstorm');
    if (!engine) engine = this.registry.createBrainstormEngine();
    return engine;
  }

  /** Create a new brainstorming session. */
  createBrainstormSession(title: string, participants: string[], dnaPattern: string) {
    return this.getBrainstorm().createSession(title, participants, dnaPattern);
  }

  /** Get a brainstorming session. */
  getBrainstormSession(sessionId: string) {
    return this.getBrainstorm().getSession(sessionId);
  }

  /** List all brainstorming sessions. */
  listBrainstormSessions() {
    return this.getBrainstorm().listSessions();
  }

  // Dynamic DNA ------------------------------------------------------------
  /** Get the dynamic DNA manager. */
  getDynamicDNAManager() {
    let manager = this.registry.get<import('./dynamic-dna.js').DynamicDNAManager>('dynamic-dna');
    if (!manager) manager = this.registry.createDynamicDNAManager();
    return manager;
  }

  // Behavioral UX ----------------------------------------------------------
  /** Get the behavioral UX engine. */
  getBehavioralUX() {
    let engine =
      this.registry.get<import('./behavioral-ux.js').BehavioralUXEngine>('behavioral-ux');
    if (!engine) engine = this.registry.createBehavioralUXEngine();
    return engine;
  }

  // Anti-Pattern Engine ----------------------------------------------------
  /** Get the anti-pattern detection engine. */
  getAntipatternEngine() {
    let engine =
      this.registry.get<import('./antipattern-engine.js').AntipatternEngine>('antipattern');
    if (!engine) engine = this.registry.createAntipatternEngine();
    return engine;
  }

  // Pragmatic Conversation Engine ------------------------------------------
  /** Get the pragmatic conversation engine. */
  getPragmaticConversation() {
    let engine =
      this.registry.get<import('./pragmatic-conversation.js').PragmaticConversationEngine>(
        'pragmatic-conversation',
      );
    if (!engine) engine = this.registry.createPragmaticConversationEngine();
    return engine;
  }

  // Role & Policy Engine ----------------------------------------------------
  /** Get the role/policy enforcement engine. */
  getRolePolicyEngine(): import('./role-policy-engine.js').RolePolicyEngine {
    let engine =
      this.registry.get<import('./role-policy-engine.js').RolePolicyEngine>('role-policy');
    if (!engine) engine = this.registry.createRolePolicyEngine();
    return engine;
  }

  // Cognitive Load Engine -----------------------------------------------------
  /** Get the cognitive load balancer engine. */
  getCognitiveLoadBalancer(): import('./cognitive-load-engine.js').CognitiveLoadBalancerEngine {
    let engine =
      this.registry.get<import('./cognitive-load-engine.js').CognitiveLoadBalancerEngine>(
        'cognitive-load',
      );
    if (!engine) engine = this.registry.createCognitiveLoadBalancerEngine();
    return engine;
  }

  // Natural Language Engine ---------------------------------------------------
  /** Get the natural language rules engine. */
  getNaturalLanguageEngine(): import('./natural-language-engine.js').NaturalLanguageEngine {
    let engine =
      this.registry.get<import('./natural-language-engine.js').NaturalLanguageEngine>(
        'natural-language',
      );
    if (!engine) engine = this.registry.createNaturalLanguageEngine();
    return engine;
  }

  // Temporal Governance Engine --------------------------------------------------
  /**
   * Get the temporal governance engine for time-based rule evaluation.
   * Wraps existing governance rules with temporal windows (absolute, recurring, cron).
   */
  getTemporalGovernanceEngine(): TemporalGovernanceEngine {
    let engine = this.registry.get<TemporalGovernanceEngine>('temporal-governance');
    if (!engine) engine = this.registry.createTemporalGovernanceEngine();
    return engine;
  }

  /**
   * Add a temporal rule to the active configuration. Temporal rules wrap an
   * existing governance rule and make it active only during specific time windows.
   */
  addTemporalRule(
    rule: Omit<import('./temporal-governance-engine.js').TemporalRule, 'id' | 'createdAt'>,
  ): { id: string; ok: boolean } {
    const engine = this.getTemporalGovernanceEngine();
    const result = engine.addTemporalRule(rule);
    // Persist if store is available
    this.persistTemporalState();
    return result;
  }

  /** Evaluate all temporal rules against a context at the current time. */
  evaluateTemporal(
    context: import('./temporal-governance-engine.js').TemporalEvaluationContext,
  ): import('./temporal-governance-engine.js').TemporalCheckResult {
    return this.getTemporalGovernanceEngine().evaluate(context);
  }

  /** Evaluate a DNA's governance rules with temporal overrides applied. */
  evaluateDNAWithTemporal(
    dna: DNA,
    context: import('./temporal-governance-engine.js').TemporalEvaluationContext,
  ): {
    effectiveRules: import('@behavior-os/schemas').GovernanceRule[];
    temporalOverrides: import('./temporal-governance-engine.js').TemporalRule[];
  } {
    return this.getTemporalGovernanceEngine().evaluateDNA(dna, context);
  }

  /** Write the temporal governance engine state to the store's metadata (no-op unsaved). */
  private persistTemporalState(): void {
    if (!this.store) return;
    const engine = this.registry.get<TemporalGovernanceEngine>('temporal-governance');
    if (!engine) return;
    this.store.setMeta('temporal-governance-state', JSON.stringify(engine.getTemporalRules()));
  }

  // MetaCognition Engine (G-002) ---------------------------------------------
  /**
   * Get the metacognition engine for reasoning path reconstruction and bias detection.
   */
  getMetaCognition(): import('./metacognition-engine.js').MetaCognitionEngine {
    let engine =
      this.registry.get<import('./metacognition-engine.js').MetaCognitionEngine>('metacognition');
    if (!engine) engine = this.registry.createMetaCognitionEngine();
    return engine;
  }

  /**
   * G-009: Get the anomaly detection engine for behavioral deviation scoring.
   */
  getAnomalyDetection(): import('./anomaly-detection-engine.js').AnomalyDetectionEngine {
    let engine =
      this.registry.get<import('./anomaly-detection-engine.js').AnomalyDetectionEngine>(
        'anomaly-detection',
      );
    if (!engine) engine = this.registry.createAnomalyDetectionEngine();
    return engine;
  }

  /**
   * G-013: Get the experiential learning engine for the Execute→Observe→Reflect→Abstract→Apply loop.
   */
  getExperientialLearning(): import('./experiential-learning-engine.js').ExperientialLearningEngine {
    let engine =
      this.registry.get<import('./experiential-learning-engine.js').ExperientialLearningEngine>(
        'experiential-learning',
      );
    if (!engine) engine = this.registry.createExperientialLearningEngine();
    return engine;
  }

  /**
   * G-016: Get the compliance mapper engine for regulatory rule mapping.
   */
  getComplianceMapper(): import('./compliance-mapper-engine.js').ComplianceMapperEngine {
    let engine =
      this.registry.get<import('./compliance-mapper-engine.js').ComplianceMapperEngine>(
        'compliance-mapper',
      );
    if (!engine) engine = this.registry.createComplianceMapperEngine();
    return engine;
  }

  /**
   * G-004: Get the hybrid evaluation engine for symbolic-neural combined decisions.
   */
  getHybridEvaluation(): import('./hybrid-evaluation-engine.js').HybridEvaluationEngine {
    let engine =
      this.registry.get<import('./hybrid-evaluation-engine.js').HybridEvaluationEngine>(
        'hybrid-evaluation',
      );
    if (!engine) engine = this.registry.createHybridEvaluationEngine();
    return engine;
  }

  /**
   * G-010: Get the zero-trust identity engine for DID-based agent identity.
   */
  getZeroTrustIdentity(): import('./zero-trust-identity-engine.js').ZeroTrustIdentityEngine {
    let engine =
      this.registry.get<import('./zero-trust-identity-engine.js').ZeroTrustIdentityEngine>(
        'zero-trust-identity',
      );
    if (!engine) engine = this.registry.createZeroTrustIdentityEngine();
    return engine;
  }

  /**
   * G-011: Get the dynamic policy engine for risk-adaptive enforcement.
   */
  getDynamicPolicy(): import('./dynamic-policy-engine.js').DynamicPolicyEngine {
    let engine =
      this.registry.get<import('./dynamic-policy-engine.js').DynamicPolicyEngine>('dynamic-policy');
    if (!engine) engine = this.registry.createDynamicPolicyEngine();
    return engine;
  }

  /**
   * G-017: Get the counterfactual audit engine for forensic what-if analysis.
   */
  getCounterfactualAudit(): import('./counterfactual-audit-engine.js').CounterfactualAuditEngine {
    let engine =
      this.registry.get<import('./counterfactual-audit-engine.js').CounterfactualAuditEngine>(
        'counterfactual-audit',
      );
    if (!engine) engine = this.registry.createCounterfactualAuditEngine();
    return engine;
  }

  /**
   * G-018: Get the explainable report engine for stakeholder-friendly summaries.
   */
  getExplainableReport(): import('./explainable-report-engine.js').ExplainableReportEngine {
    let engine =
      this.registry.get<import('./explainable-report-engine.js').ExplainableReportEngine>(
        'explainable-report',
      );
    if (!engine) engine = this.registry.createExplainableReportEngine();
    return engine;
  }

  /**
   * G-005: Get the temporal pattern engine for recurring behavior detection.
   */
  getTemporalPattern(): import('./temporal-pattern-engine.js').TemporalPatternEngine {
    let engine =
      this.registry.get<import('./temporal-pattern-engine.js').TemporalPatternEngine>(
        'temporal-pattern',
      );
    if (!engine) engine = this.registry.createTemporalPatternEngine();
    return engine;
  }

  /**
   * G-007: Get the cross-domain knowledge transfer engine.
   */
  getCrossDomainTransfer(): import('./cross-domain-transfer-engine.js').CrossDomainTransferEngine {
    let engine =
      this.registry.get<import('./cross-domain-transfer-engine.js').CrossDomainTransferEngine>(
        'cross-domain-transfer',
      );
    if (!engine) engine = this.registry.createCrossDomainTransferEngine();
    return engine;
  }

  /**
   * R-023: Get the cross-DNA pipeline transfer engine.
   * Finds transferable pipeline phases between DNA patterns —
   * e.g., transferring Surgical Team's zero-defect testing phase to DevOps Pipeline.
   */
  getCrossDnaPipelineTransfer(): import('./cross-dna-pipeline-transfer-engine.js').CrossDnaPipelineTransferEngine {
    let engine = this.registry.get<
      import('./cross-dna-pipeline-transfer-engine.js').CrossDnaPipelineTransferEngine
    >('cross-dna-pipeline-transfer');
    if (!engine) engine = this.registry.createCrossDnaPipelineTransferEngine();
    return engine;
  }

  /**
   * F-024: Get the confidence-weighted gate selector.
   * Uses confidence scores to determine which gates from cross-DNA transfers
   * should be recommended for adoption in the target pipeline.
   */
  getConfidenceWeightedGateSelector(): import('./confidence-weighted-gate-selector.js').ConfidenceWeightedGateSelector {
    let engine = this.registry.get<
      import('./confidence-weighted-gate-selector.js').ConfidenceWeightedGateSelector
    >('confidence-weighted-gate-selector');
    if (!engine) engine = this.registry.createConfidenceWeightedGateSelector();
    return engine;
  }

  /**
   * G-008: Get the memory consolidation engine.
   */
  getMemoryConsolidation(): import('./memory-consolidation-engine.js').MemoryConsolidationEngine {
    let engine =
      this.registry.get<import('./memory-consolidation-engine.js').MemoryConsolidationEngine>(
        'memory-consolidation',
      );
    if (!engine) engine = this.registry.createMemoryConsolidationEngine();
    return engine;
  }

  /**
   * G-012: Get the circuit breaker intelligence engine.
   */
  getCircuitBreakerIntelligence(): import('./circuit-breaker-intelligence.js').CircuitBreakerIntelligence {
    let engine = this.registry.get<
      import('./circuit-breaker-intelligence.js').CircuitBreakerIntelligence
    >('circuit-breaker-intelligence');
    if (!engine) engine = this.registry.createCircuitBreakerIntelligence();
    return engine;
  }

  /**
   * G-014: Get the value alignment engine.
   */
  getValueAlignment(): import('./value-alignment-engine.js').ValueAlignmentEngine {
    let engine =
      this.registry.get<import('./value-alignment-engine.js').ValueAlignmentEngine>(
        'value-alignment',
      );
    if (!engine) engine = this.registry.createValueAlignmentEngine();
    return engine;
  }

  /**
   * G-015: Get the collective intelligence engine.
   */
  getCollectiveIntelligence(): import('./collective-intelligence-engine.js').CollectiveIntelligenceEngine {
    let engine =
      this.registry.get<import('./collective-intelligence-engine.js').CollectiveIntelligenceEngine>(
        'collective-intelligence',
      );
    if (!engine) engine = this.registry.createCollectiveIntelligenceEngine();
    return engine;
  }

  /**
   * G-019: Get the external system adapter engine.
   */
  getExternalSystemAdapter(): import('./external-adapter-engine.js').ExternalSystemAdapter {
    let engine =
      this.registry.get<import('./external-adapter-engine.js').ExternalSystemAdapter>(
        'external-adapter',
      );
    if (!engine) engine = this.registry.createExternalSystemAdapter();
    return engine;
  }

  /**
   * G-020: Get the governance-as-code engine.
   */
  getGovernanceAsCode(): import('./governance-as-code-engine.js').GovernanceAsCodeEngine {
    let engine =
      this.registry.get<import('./governance-as-code-engine.js').GovernanceAsCodeEngine>(
        'governance-as-code',
      );
    if (!engine) engine = this.registry.createGovernanceAsCodeEngine();
    return engine;
  }

  /**
   * G-021: Get the DNA-adaptive pipeline planner engine.
   * Maps DNA + project context to a construction pipeline with
   * phases, gates, agents, and auto-loadable skills.
   */
  getPipelinePlanner(): import('./pipeline-planner.js').PipelinePlannerEngine {
    let engine =
      this.registry.get<import('./pipeline-planner.js').PipelinePlannerEngine>('pipeline-planner');
    if (!engine) engine = this.registry.createPipelinePlannerEngine();
    return engine;
  }

  /**
   * R-022: Get the pipeline recovery engine (Auto-Recovery / Self-Healing).
   * When a phase gate fails, this engine generates fix proposals,
   * applies high-confidence fixes automatically, and escalates only
   * when recovery is not possible — enabling full autonomous construction.
   */
  getPipelineRecovery(): import('./pipeline-recovery-engine.js').PipelineRecoveryEngine {
    let engine =
      this.registry.get<import('./pipeline-recovery-engine.js').PipelineRecoveryEngine>(
        'pipeline-recovery',
      );
    if (!engine) engine = this.registry.createPipelineRecoveryEngine();
    return engine;
  }

  /**
   * Create a meta-decision from a governance evaluation, including reasoning path,
   * confidence scoring, bias detection, and self-critique.
   */
  createMetaDecision(
    decision: import('@behavior-os/schemas').GovernanceDecision,
    options: {
      context?: Record<string, unknown>;
      agentId?: string;
      dnaPattern?: string;
      additionalEvidence?: string[];
    } = {},
  ): import('./metacognition-engine.js').MetaDecision {
    return this.getMetaCognition().createMetaDecision(decision, {
      context: options.context ?? {},
      agentId: options.agentId ?? this.resolveAgentIdentity().agentId ?? 'unknown',
      ...options,
    });
  }

  /**
   * Get statistics about the meta-cognition engine.
   */
  getMetaCognitionStats() {
    return this.getMetaCognition().getStats();
  }

  // Knowledge Graph Engine (G-001) -------------------------------------------
  /**
   * Get the knowledge graph engine for structured relationship queries and inference.
   */
  getKnowledgeGraph(): import('./knowledge-graph-engine.js').KnowledgeGraphEngine {
    let engine =
      this.registry.get<import('./knowledge-graph-engine.js').KnowledgeGraphEngine>(
        'knowledge-graph',
      );
    if (!engine) engine = this.registry.createKnowledgeGraphEngine();
    return engine;
  }

  /**
   * Add a node to the knowledge graph.
   */
  addKnowledgeNode(node: import('@behavior-os/schemas').KnowledgeGraphNode): void {
    this.getKnowledgeGraph().addNode(node);
  }

  /**
   * Add an edge to the knowledge graph.
   */
  addKnowledgeEdge(edge: import('@behavior-os/schemas').KnowledgeGraphEdge): void {
    this.getKnowledgeGraph().addEdge(edge);
  }

  /**
   * Query the knowledge graph with traversal and filtering.
   */
  queryKnowledgeGraph(
    query: import('@behavior-os/schemas').KnowledgeQuery,
  ): import('@behavior-os/schemas').KnowledgeResult {
    return this.getKnowledgeGraph().query(query);
  }

  /**
   * Populate the knowledge graph from existing Behavior-OS state.
   * This is called automatically on hydration to rebuild the graph.
   */
  populateKnowledgeGraph(options: {
    agents?: Array<{ id: string; name: string; type: string; dnaPattern?: string }>;
    missions?: Array<{
      id: string;
      title: string;
      type: string;
      status: string;
      dnaPattern?: string;
    }>;
    rules?: Array<{ id: string; level: string; action: string }>;
    learnings?: Array<{ id: string; type: string; source: string; content: string }>;
    decisions?: Array<{ id: string; subject: string; outcome: string }>;
  }): void {
    this.getKnowledgeGraph().populateFromState(options);
  }

  /**
   * Get statistics about the knowledge graph.
   */
  getKnowledgeGraphStats() {
    return this.getKnowledgeGraph().getStats();
  }

  // Persistent Memory Engine (G-003) -------------------------------------------
  /**
   * Get the persistent memory engine for durable memory management.
   * Integrates the knowledge graph and metacognition engines with SQLite storage.
   */
  getPersistentMemory(): import('./persistent-memory-engine.js').PersistentMemoryEngine {
    let engine =
      this.registry.get<import('./persistent-memory-engine.js').PersistentMemoryEngine>(
        'persistent-memory',
      );
    if (!engine) {
      engine = this.registry.createPersistentMemoryEngine();
      // Wire up dependencies
      engine.setStore(this.store ?? undefined);
      engine.setKnowledgeGraph(this.getKnowledgeGraph());
    }
    return engine;
  }

  /**
   * Save a memory (knowledge graph node) to persistent storage.
   */
  saveMemory(
    node: import('@behavior-os/schemas').KnowledgeGraphNode,
    options?: { expiresAt?: string; relevanceScore?: number },
  ): void {
    this.getPersistentMemory().saveMemory(node, options);
  }

  /**
   * Save a meta-decision to persistent storage.
   */
  saveMetaDecision(decision: import('./metacognition-engine.js').MetaDecision): void {
    this.getPersistentMemory().saveMetaDecision(decision);
  }

  /**
   * Recall a memory by node ID.
   */
  recallMemory(nodeId: string): import('@behavior-os/schemas').KnowledgeGraphNode | null {
    return this.getPersistentMemory().recallMemory(nodeId);
  }

  /**
   * Recall memories relevant to a context (graph traversal with scoring).
   */
  recallRelevant(
    startNodeId: string,
    options: { maxDepth?: number; minScore?: number; nodeTypes?: string[] } = {},
  ): import('./persistent-memory-engine.js').MemoryRecallResult[] {
    return this.getPersistentMemory().recallRelevant(startNodeId, options);
  }

  /**
   * Reconstruct agent context from past missions, decisions, and learnings.
   */
  reconstructContext(agentId: string): {
    missions: string[];
    decisions: import('./metacognition-engine.js').MetaDecision[];
    learnings: string[];
  } {
    return this.getPersistentMemory().reconstructContext(agentId);
  }

  /**
   * Consolidate in-memory knowledge graph state to persistent storage.
   */
  consolidateMemory(): { savedNodes: number; savedEdges: number } {
    return this.getPersistentMemory().consolidate();
  }

  /**
   * Get statistics about persistent memory usage.
   */
  getPersistentMemoryStats() {
    return this.getPersistentMemory().getStats();
  }

  /**
   * Register a role through the facade so the change is persisted when a store
   * is attached. The engine itself stays store-free: hosts call the facade,
   * the facade writes the snapshot, the engine owns the decision logic.
   */
  registerRole(
    role: import('@behavior-os/schemas').Role,
  ): import('./role-policy-engine.js').RolePolicyRegistration {
    const result = this.getRolePolicyEngine().registerRole(role);
    if (result.success) this.persistRolePolicyState();
    return result;
  }

  /** Define a policy rule through the facade (persisted like registerRole). */
  defineRolePolicy(
    policy: import('@behavior-os/schemas').PolicyRule,
  ): import('./role-policy-engine.js').RolePolicyRegistration {
    const result = this.getRolePolicyEngine().definePolicy(policy);
    if (result.success) this.persistRolePolicyState();
    return result;
  }

  /**
   * Evaluate an action against the role/policy registry through the facade, and
   * persist the (bounded) audit trail so decisions survive a restart.
   */
  evaluateRoleAction(
    actor: import('./role-policy-engine.js').RoleActorContext,
    action: string,
  ): import('./role-policy-engine.js').RoleDecision {
    const decision = this.getRolePolicyEngine().evaluate(actor, action);
    // Hot path: the permission hook evaluates every mutating tool call.
    // A benign decision (no policy matched, actor already known) does not
    // change the durable registry — persisting it would pay a store write
    // per tool call. The in-memory trail still records every decision; the
    // snapshot is persisted when the decision is meaningful: a policy
    // actually matched, or the fail-safe fired (unknown role → require).
    if (decision.matchedPolicy || decision.action === 'require') {
      this.persistRolePolicyState();
    }
    return decision;
  }

  /** Write the role/policy engine state to the store's metadata (no-op unsaved). */
  private persistRolePolicyState(): void {
    if (!this.store) return;
    const engine =
      this.registry.get<import('./role-policy-engine.js').RolePolicyEngine>('role-policy');
    if (!engine) return;
    this.store.setMeta('role-policy-state', JSON.stringify(engine.snapshot()));
  }

  // Agent Management
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.store?.saveAgent(agent);
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // Protocol State
  getState(): AgentState {
    return this.agentState;
  }

  updateState(updates: Partial<AgentState>): void {
    this.agentState = { ...this.agentState, ...updates, updatedAt: new Date().toISOString() };
  }

  // Mission Management
  /**
   * List missions with optional filters applied BEFORE the limit. The filters
   * were once documented but applied by two hosts, which is how implementations
   * diverged; the facade owns these semantics now.
   */
  listMissions(
    limit = 50,
    filters: { status?: MissionStatus; type?: MissionType; priority?: MissionPriority } = {},
  ): Mission[] {
    return this.getMissionEngine()
      .list()
      .filter((mission) => !filters.status || mission.status === filters.status)
      .filter((mission) => !filters.type || mission.type === filters.type)
      .filter((mission) => !filters.priority || mission.priority === filters.priority)
      .slice(0, limit);
  }

  getMission(missionId: string): Mission | null {
    return this.getMissionEngine().get(missionId);
  }

  /**
   * The single source of truth for how a DNA deny becomes an enforcement
   * effect. A restrictive DNA must stay escapable: denies never apply to the
   * governance control plane (reading/acting on governance is not an
   * *operation* on the governed environment) or to read-only inspection
   * tools, otherwise a bootstrap deadlock would be inescapable. The verdict
   * is still recorded by the enforcement host, never silently lost.
   */
  bootstrapDenyOverride(action: string, decision: GovernanceDecision): boolean {
    return (
      decision.verdict === 'deny' && (isControlPlaneAction(action) || !isMutatingAction(action))
    );
  }

  /**
   * Read every YAML pattern in a directory through the registry's validating
   * DNA loader, keyed by file basename. Loading without validation let an
   * invalid `dna as DNA` cast propagate half-shaped patterns into loadDNA();
   * validation failures instead become reported errors a host can surface.
   */
  async loadDNAFromDirectory(
    directory: string,
  ): Promise<{ patterns: Map<string, DNA>; errors: string[] }> {
    const patterns = new Map<string, DNA>();
    const errors: string[] = [];
    const files = (await readdir(directory)).filter((file) => /\.(yaml|yml)$/.test(file));
    for (const file of files) {
      const name = file.replace(/\.(yaml|yml)$/, '');
      try {
        const content = await readFile(join(directory, file), 'utf-8');
        const parsed: unknown = yamlLoad(content);
        const dna =
          parsed !== null && typeof parsed === 'object'
            ? this.registry.getDNALoader().load(parsed)
            : null;
        if (dna) {
          patterns.set(name, dna);
        } else {
          errors.push(`${file}: empty document`);
        }
      } catch (error) {
        errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { patterns, errors };
  }

  getAgentState(): AgentState {
    return this.agentState;
  }

  // Persistence -------------------------------------------------------------
  /**
   * Export the complete engine state as a JSON-serializable snapshot. Callers
   * (e.g. the OpenCode plugin via `ctx.storage`) persist the result and restore
   * it later with {@link importState} so state survives a process restart.
   */
  exportState(): BehaviorOSSnapshot {
    return cloneJson({
      version: BEHAVIOROS_SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      agentState: this.agentState,
      dna: this.currentDNA,
      missions: this.getMissionEngine().snapshot(),
      learnings: this.getLearningEngine().snapshot(),
      learningRecords: this.getLearningEngine().snapshotRecords(),
    });
  }

  /**
   * Restore engine state from a snapshot produced by {@link exportState}.
   * Returns `true` on success and `false` for a missing or incompatible
   * snapshot, leaving the current state untouched in that case.
   */
  importState(snapshot: BehaviorOSSnapshot | null | undefined): boolean {
    if (!snapshot || snapshot.version !== BEHAVIOROS_SNAPSHOT_VERSION) return false;
    try {
      if (snapshot.agentState && typeof snapshot.agentState === 'object') {
        const restored = cloneJson(snapshot.agentState) as AgentState;
        // Snapshots written before agent identity existed have no `agentId`/
        // `persona`; normalise them so the identity resolver always has a value.
        this.agentState = {
          ...restored,
          agentId: restored.agentId ?? null,
          persona: restored.persona ?? null,
        };
      }
      this.currentDNA = snapshot.dna ?? null;
      // The rebuilt pipeline must reflect the restored DNA's quality gates.
      this.pipeline = null;

      // Rebind the DNA-scoped engines to the restored DNA so a decision cached
      // under a previous pattern can never leak into the restored session.
      if (this.currentDNA) {
        this.registry.createGovernanceEngine(this.currentDNA);
        this.registry.createQualityEngine(this.currentDNA);
      }

      this.getMissionEngine().restore(snapshot.missions ?? []);
      this.getLearningEngine().restore(snapshot.learnings ?? []);
      this.getLearningEngine().restoreRecords(snapshot.learningRecords ?? []);
      return true;
    } catch {
      return false;
    }
  }

  // Persistence (attached Store) ---------------------------------------------
  /** Restore missions/learnings/agents from the attached store. */
  private hydrateFromStore(): void {
    if (!this.store) return;
    this.getMissionEngine().restore(this.store.listMissions());
    this.getLearningEngine().restore(this.store.listLearnings(1000));
    for (const agent of this.store.listAgents()) {
      this.agents.set(agent.id, agent);
    }
    // Role/policy state hydrates lazily: an engine with no persisted state
    // (no meta key yet) is not instantiated just to store nothing.
    const roleStateRaw = this.store.getMeta('role-policy-state');
    if (roleStateRaw) {
      try {
        this.getRolePolicyEngine().restore(JSON.parse(roleStateRaw));
      } catch {
        // A corrupt snapshot must not block startup; the engine simply
        // starts empty and the next facade mutation re-persists clean state.
      }
    }
    // Learning lifecycle record (G-014) hydrates from its meta snapshot.
    const learningRecordsRaw = this.store.getMeta('learning-records');
    if (learningRecordsRaw) {
      try {
        this.getLearningEngine().restoreRecords(JSON.parse(learningRecordsRaw));
      } catch {
        // Corrupt snapshot: start with the event restore above and let the
        // next record mutation re-persist a clean lifecycle.
      }
    }
  }

  /**
   * Persist all current in-memory state to the store (no-op without one). Uses
   * the store's {@link Store.withTransaction} so that writes are atomic when the
   * store supports transactions (e.g. `PostgresStore`). Await this call for
   * stores backed by connection pools.
   */
  async persistAll(): Promise<void> {
    const store = this.store;
    if (!store) return;
    await store.withTransaction(async () => {
      for (const mission of this.getMissionEngine().snapshot()) store.saveMission(mission);
      for (const event of this.getLearningEngine().snapshot()) store.saveLearning(event);
      this.persistLearningRecords();
      for (const agent of this.agents.values()) store.saveAgent(agent);
      this.persistRolePolicyState();
    });
  }

  /** Read persisted audit reports, newest first. Empty without a store. */
  listAuditReports(limit = 50): AuditReport[] {
    return this.store?.listAuditReports(limit) ?? [];
  }

  /** Whether a persistence store is attached. */
  hasPersistence(): boolean {
    return this.store !== null;
  }

  /** Close the attached store, if any. */
  closeStore(): void {
    this.store?.close();
    this.store = null;
  }

  simulateAction(
    action: string,
    context: { agent: string; context?: Record<string, unknown> },
  ): GovernanceDecision {
    return this.evaluateGovernance(action, context);
  }

  compareDNAVersions(
    dna1: DNA,
    dna2: DNA,
  ): {
    score1: number;
    score2: number;
    difference: number;
    recommendation: string;
  } {
    const score1 = this.scoreDNA(dna1);
    const score2 = this.scoreDNA(dna2);
    const difference = Math.abs(score1 - score2);

    return {
      score1,
      score2,
      difference,
      recommendation: difference > 1 ? 'Significant difference detected' : 'Similar DNA patterns',
    };
  }

  private scoreDNA(dna: DNA): number {
    let score = 0;
    if (dna.version?.includes('v2')) score += 2;
    if (dna.personas.length > 3) score += 1;
    if (dna.governance.length > 5) score += 1;
    if (dna.quality.length > 3) score += 1;
    return score;
  }

  // Status
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
    /** true when a durable store is active, false when it failed to initialise, null when no persistence configured. */
    store: boolean | null;
    /** Error message when the store failed to initialise, null otherwise. */
    storeError: string | null;
  } {
    return {
      engine: true,
      dna: this.currentDNA?.name ?? null,
      missions: this.registry.get<MissionEngine>('mission')?.list().length ?? 0,
      agents: this.agents.size,
      state: this.agentState,
      config: {
        governance: this.config.governance?.level ?? 'strict',
        qualityEnabled: this.config.quality?.enabled ?? true,
        auditEnabled: this.config.audit?.enabled ?? true,
        learningEnabled: this.config.learning?.enabled ?? true,
      },
      store: this.store ? true : this.storeInitError ? false : null,
      storeError: this.storeInitError,
    };
  }
}

export default BehaviorOS;
