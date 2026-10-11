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
import { EngineRegistry, type LearningEngine, type MissionEngine } from './index';

export interface BehaviorOSConfig {
  dnaPath?: string;
  governance?: { enabled?: boolean; level?: 'strict' | 'moderate' | 'lenient' };
  quality?: { enabled?: boolean; minCoverage?: number };
  audit?: { enabled?: boolean };
  learning?: { enabled?: boolean };
}

export class BehaviorOS {
  private registry: EngineRegistry;
  private currentDNA: DNA | null = null;
  private agentState: AgentState;
  private agents: Map<string, Agent> = new Map();

  constructor(_config: BehaviorOSConfig = {}) {
    this.registry = new EngineRegistry();
    this.agentState = {
      currentStep: 0,
      selectedDna: null,
      activeMission: null,
      stepHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // DNA Management
  async loadDNA(dna: DNA): Promise<void> {
    this.currentDNA = dna;
    this.agentState.selectedDna = dna.name;
    this.agentState.updatedAt = new Date().toISOString();
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
    return govEngine.evaluate({
      action,
      agentId: context.agent,
      context: (context.context || {}) as Record<string, unknown>,
    });
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

    return auditEngine.run({
      ...options,
      stages: stages as import('@behavior-os/schemas').AuditStage[],
    });
  }

  // Missions
  createMission(options: {
    title: string;
    type: string;
    priority: string;
    dnaPattern?: string;
  }): Mission {
    let missionEngine = this.registry.get<MissionEngine>('mission');
    if (!missionEngine) {
      missionEngine = this.registry.createMissionEngine(this.currentDNA ?? undefined);
    }
    return missionEngine.create({
      ...options,
      type: options.type as MissionType,
      priority: options.priority as MissionPriority,
      dnaPattern: options.dnaPattern ?? this.currentDNA?.name ?? 'default',
      createdBy: 'system',
    });
  }

  startMission(missionId: string): Mission | null {
    const missionEngine = this.registry.get<MissionEngine>('mission')!;
    return missionEngine.start(missionId);
  }

  completeMission(missionId: string): Mission | null {
    const missionEngine = this.registry.get<MissionEngine>('mission')!;
    return missionEngine.complete(missionId);
  }

  failMission(missionId: string, reason?: string): Mission | null {
    const missionEngine = this.registry.get<MissionEngine>('mission')!;
    return missionEngine.fail(missionId, reason);
  }

  // Learning
  recordLearning(options: {
    type: string;
    source: string;
    content: string;
    impact: string;
    relatedMission?: string;
    relatedPattern?: string;
  }): LearningEvent {
    let learningEngine = this.registry.get<LearningEngine>('learning');
    if (!learningEngine) {
      learningEngine = this.registry.createLearningEngine();
    }
    return learningEngine.record({
      ...options,
      type: options.type as LearningType,
      impact: options.impact as LearningImpact,
    });
  }

  getInsights(limit = 10): LearningEvent[] {
    const learningEngine = this.registry.get<LearningEngine>('learning')!;
    return learningEngine.getInsights(limit);
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
    const missionEngine = this.registry.get<MissionEngine>('mission')!;
    return missionEngine.list().slice(0, limit);
  }

  getMission(missionId: string): Mission | null {
    const missionEngine = this.registry.get<MissionEngine>('mission')!;
    return missionEngine.get(missionId);
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
  } {
    return {
      engine: true,
      dna: this.currentDNA?.name ?? null,
      missions: this.registry.get<MissionEngine>('mission')?.list().length ?? 0,
      agents: this.agents.size,
      state: this.agentState,
    };
  }
}

export default BehaviorOS;
