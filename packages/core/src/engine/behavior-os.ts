import type {
  Agent,
  AgentState,
  AuditReport,
  DNA,
  GovernanceDecision,
  LearningEvent,
  LearningImpact,
  LearningType,
  Mission,
  MissionPriority,
  MissionType,
} from '@behavior-os/schemas';
import { EngineRegistry, type LearningEngine, type MissionEngine } from './index.js';

export interface BehaviorOSConfig {
  dnaPath?: string;
  governance?: { enabled?: boolean; level?: 'strict' | 'moderate' | 'lenient' };
  quality?: { enabled?: boolean; minCoverage?: number };
  audit?: { enabled?: boolean };
  learning?: { enabled?: boolean };
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

export class BehaviorOS {
  private registry: EngineRegistry;
  private currentDNA: DNA | null = null;
  private agentState: AgentState;
  private agents: Map<string, Agent> = new Map();
  private readonly config: BehaviorOSConfig;

  constructor(config: BehaviorOSConfig = {}) {
    this.config = config;
    this.registry = new EngineRegistry();
    this.agentState = {
      currentStep: 0,
      selectedDna: null,
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
    this.agentState.selectedDna = dna.name;
    this.agentState.updatedAt = new Date().toISOString();
    this.advanceProtocolStep('bos_select_dna');
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

  // Audit
  runAudit(options: {
    missionId: string;
    agentId: string;
    stages?: string[];
    simulate?: boolean;
  }): AuditReport {
    const auditEngine = this.registry.createAuditEngine();
    const stages = options.stages?.length
      ? options.stages
      : ['lint', 'typecheck', 'security', 'coverage'];

    const report = auditEngine.run({
      ...options,
      stages: stages as import('@behavior-os/schemas').AuditStage[],
    });
    this.advanceProtocolStep('bos_run_audit');
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
  }): Mission {
    const mission = this.getMissionEngine().create({
      ...options,
      type: options.type as MissionType,
      priority: options.priority as MissionPriority,
      dnaPattern: options.dnaPattern ?? this.currentDNA?.name ?? 'default',
      createdBy: options.createdBy ?? 'system',
    });
    this.advanceProtocolStep('bos_create_mission');
    return mission;
  }

  startMission(missionId: string): Mission | null {
    const mission = this.getMissionEngine().start(missionId);
    if (mission) {
      this.advanceProtocolStep('bos_start_mission');
    }
    return mission;
  }

  completeMission(missionId: string): Mission | null {
    return this.getMissionEngine().complete(missionId);
  }

  failMission(missionId: string, reason?: string): Mission | null {
    return this.getMissionEngine().fail(missionId, reason);
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
    return event;
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.getLearningEngine().getInsights(limit);
  }

  // Agent Management
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
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
