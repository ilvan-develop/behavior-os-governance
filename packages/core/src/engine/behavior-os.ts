import type {
  Agent,
  AgentState,
  AgentType,
  AuditReport,
  CodeFixProposal,
  CodeFixResult,
  Decision,
  DecisionOutcome,
  DecisionPolicy,
  DNA,
  DriftInfo,
  EvolutionProposal,
  GovernanceDecision,
  LearningEvent,
  LearningImpact,
  LearningType,
  Mission,
  MissionPriority,
  MissionType,
  PipelineRun,
  RankedRecommendation,
  Vote,
} from '@behavior-os/schemas';
import { SqliteStore } from '../persistence/sqlite-store.js';
import type { Store } from '../persistence/store.js';
import type { DecideOptions } from './decision-engine.js';
import {
  type DecisionEngine,
  type DriftEngine,
  EngineRegistry,
  type LearningEngine,
  type MissionEngine,
  type RecommendationEngine,
} from './index.js';
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
}

/** Outcome of {@link BehaviorOS.applyEvolution}. */
export interface EvolutionResult {
  /** Proposals that met the confidence bar (including already-applied ones). */
  proposals: EvolutionProposal[];
  /** The subset that was actually written into the active DNA. */
  applied: EvolutionProposal[];
  /** Whether `config.evolution.enabled` allowed writing. */
  enabled: boolean;
  /** Present when votes were supplied to gate the change. */
  decision?: Decision;
}

/** Outcome of {@link BehaviorOS.applyCodeFixes}. */
export interface CodeFixApplyResult {
  /** Proposals that met the confidence bar (including already-applied ones). */
  proposals: CodeFixProposal[];
  /** The subset that was persisted as {@link CodeFixResult} records. */
  applied: CodeFixResult[];
  /** Whether `config.evolution.enabled` allowed writing. */
  enabled: boolean;
  /** Present when votes were supplied to gate the change. */
  decision?: Decision;
}

/**
 * The canonical 7-step agent protocol. `currentStep` tracks the next step the
 * agent should perform (0-based index into this list), advancing monotonically
 * as the corresponding tool is exercised.
 */
export const PROTOCOL_STEP_COUNT = 7;

/** Tool name → step number that is completed by running that tool. */
const PROTOCOL_TOOL_STEPS: Readonly<Record<string, number>> = {
  bos_select_dna: 1,
  bos_list_dna: 2,
  bos_get_state: 3,
  bos_create_mission: 4,
  bos_start_mission: 5,
  bos_run_audit: 6,
  bos_record_learning: 7,
};

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
  private pipeline: PipelineEngine | null = null;

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
      } catch {
        this.store = null;
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
      return this.resolveAgentIdentity();
    }

    return null;
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

    const govEngine = this.registry.createGovernanceEngine(this.currentDNA);
    const decision = govEngine.evaluate({
      action,
      agentId: context.agent,
      context: (context.context || {}) as Record<string, unknown>,
    });

    // Governance-level policy: in lenient mode, soften hard denials into
    // escalations so autonomous agents can proceed with awareness of the risk.
    if (decision.verdict === 'deny' && this.config.governance?.level === 'lenient') {
      return {
        ...decision,
        verdict: 'escalate',
        reason: `${decision.reason} (softened by lenient governance level)`,
      };
    }
    return decision;
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
  runAudit(options: {
    missionId: string;
    agentId?: string;
    stages?: string[];
    simulate?: boolean;
  }): AuditReport {
    const auditEngine = this.registry.createAuditEngine();
    const stages = options.stages?.length
      ? options.stages
      : ['lint', 'typecheck', 'security', 'coverage'];
    const identity = this.resolveAgentIdentity();

    const report = auditEngine.run({
      ...options,
      agentId: options.agentId ?? identity.agentId,
      dnaPattern: identity.dnaPattern,
      persona: identity.persona,
      stages: stages as import('@behavior-os/schemas').AuditStage[],
    });
    this.advanceProtocolStep('bos_run_audit');
    this.store?.saveAuditReport(report);
    return report;
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
    type: string;
    priority: string;
    dnaPattern?: string;
    createdBy?: string;
    /**
     * Whether creating this mission should advance the 7-step protocol. The
     * plugin's auto-mission passes `false` so protocol progress still reflects
     * work the agent performed explicitly. Defaults to `true`.
     */
    advanceProtocol?: boolean;
  }): Mission {
    const mission = this.getMissionEngine().create({
      ...options,
      type: options.type as MissionType,
      priority: options.priority as MissionPriority,
      dnaPattern: options.dnaPattern ?? this.currentDNA?.name ?? 'default',
      createdBy: options.createdBy ?? 'system',
    });
    if (options.advanceProtocol !== false) {
      this.advanceProtocolStep('bos_create_mission');
    }
    this.store?.saveMission(mission);
    return mission;
  }

  startMission(missionId: string, options: { advanceProtocol?: boolean } = {}): Mission | null {
    const mission = this.getMissionEngine().start(missionId);
    if (mission) {
      // Starting a mission makes it the single active mission for the session.
      this.agentState.activeMission = mission.id;
      this.agentState.updatedAt = new Date().toISOString();
      if (options.advanceProtocol !== false) {
        this.advanceProtocolStep('bos_start_mission');
      }
      this.store?.saveMission(mission);
    }
    return mission;
  }

  completeMission(missionId: string): Mission | null {
    const mission = this.getMissionEngine().complete(missionId);
    if (mission && this.agentState.activeMission === missionId) {
      this.agentState.activeMission = null;
      this.agentState.updatedAt = new Date().toISOString();
    }
    if (mission) this.store?.saveMission(mission);
    return mission;
  }

  failMission(missionId: string, reason?: string): Mission | null {
    const mission = this.getMissionEngine().fail(missionId, reason);
    if (mission && this.agentState.activeMission === missionId) {
      this.agentState.activeMission = null;
      this.agentState.updatedAt = new Date().toISOString();
    }
    if (mission) this.store?.saveMission(mission);
    return mission;
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
    if (options.advanceProtocol !== false) {
      this.advanceProtocolStep('bos_record_learning');
    }
    this.store?.saveLearning(event);
    return event;
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.getLearningEngine().getInsights(limit);
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
   * When `votes` are supplied the change must first be approved by the decision
   * engine. Only `warn` rules are ever added, so an applied proposal can never
   * block an action.
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

    let decision: Decision | undefined;
    if (options.votes && options.votes.length > 0) {
      decision = this.decide({
        subject: `DNA evolution (${proposals.length} proposal(s))`,
        votes: options.votes,
        policy: options.policy,
      });
      if (decision.outcome !== 'approved') {
        return { proposals, applied: [], enabled, decision };
      }
    }

    const governance = [...this.currentDNA.governance];
    const applied: EvolutionProposal[] = [];
    for (const proposal of proposals) {
      if (governance.some((rule) => rule.id === proposal.ruleId)) continue;
      governance.push({
        id: proposal.ruleId,
        level: 'medium',
        action: 'warn',
        conditions: [{ type: 'pattern', value: proposal.pattern }],
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
          content: `Applied ${proposal.kind} rule ${proposal.ruleId} (confidence ${proposal.confidence})`,
          impact: 'medium',
          relatedPattern: proposal.pattern,
          advanceProtocol: false,
        });
      }
    }

    return { proposals, applied, enabled, ...(decision ? { decision } : {}) };
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
      return { proposals, applied: [], enabled };
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
        return { proposals, applied: [], enabled, decision };
      }
    }

    const applied: CodeFixResult[] = [];
    const existingPatterns = new Set(this.listCodeFixResults().map((r) => r.pattern));
    for (const proposal of proposals) {
      if (existingPatterns.has(proposal.pattern)) continue;
      const result: CodeFixResult = {
        id: `fixr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        proposalId: proposal.id,
        pattern: proposal.pattern,
        confidence: proposal.confidence,
        applied: true,
        ...(voteOutcome ? { voteOutcome, voteTally } : {}),
        timestamp: new Date().toISOString(),
        missionId: this.agentState.activeMission ?? undefined,
      };
      this.store?.saveCodeFixResult(result);
      this.recordLearning({
        type: 'optimization',
        source: 'code-fix-evolution',
        content: `Applied code-fix proposal ${result.id} (confidence ${result.confidence})`,
        impact: 'medium',
        relatedPattern: proposal.pattern,
        advanceProtocol: false,
      });
      applied.push(result);
    }

    return { proposals, applied, enabled, ...(decision ? { decision } : {}) };
  }

  /**
   * Read persisted code-fix results, newest first. Empty without a store.
   */
  listCodeFixResults(limit = 50): CodeFixResult[] {
    return this.store?.listCodeFixResults(limit) ?? [];
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
    let engine = this.registry.get<DriftEngine>('drift');
    if (!engine) engine = this.registry.createDriftEngine();
    return engine.compare(dnaA, dnaB);
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
  listMissions(limit = 50): Mission[] {
    return this.getMissionEngine().list().slice(0, limit);
  }

  getMission(missionId: string): Mission | null {
    return this.getMissionEngine().get(missionId);
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
      for (const agent of this.agents.values()) store.saveAgent(agent);
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
    };
  }
}

export default BehaviorOS;
