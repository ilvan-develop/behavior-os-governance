import type {
  Agent,
  AgentState,
  AuditReport,
  DNA,
  GovernanceDecision,
  LearningEvent,
  Mission,
} from '@behavior-os/schemas';
export interface BehaviorOSConfig {
  dnaPath?: string;
  governance?: {
    enabled?: boolean;
    level?: 'strict' | 'moderate' | 'lenient';
  };
  quality?: {
    enabled?: boolean;
    minCoverage?: number;
  };
  audit?: {
    enabled?: boolean;
  };
  learning?: {
    enabled?: boolean;
  };
}
export declare class BehaviorOS {
  private registry;
  private currentDNA;
  private agentState;
  private agents;
  constructor(config?: BehaviorOSConfig);
  loadDNA(dna: DNA): Promise<void>;
  getDNA(): DNA | null;
  evaluateGovernance(
    action: string,
    context: {
      agent: string;
      scope?: string;
      [key: string]: unknown;
    },
  ): GovernanceDecision;
  checkQuality(metrics: Record<string, number>): {
    passed: boolean;
    details: unknown;
  };
  runAudit(options: { missionId: string; agentId: string; stages?: string[] }): AuditReport;
  createMission(options: {
    title: string;
    type: string;
    priority: string;
    dnaPattern?: string;
  }): Mission;
  startMission(missionId: string): Mission | null;
  recordLearning(options: {
    type: string;
    source: string;
    content: string;
    impact: string;
  }): LearningEvent;
  getInsights(limit?: number): LearningEvent[];
  registerAgent(agent: Agent): void;
  getAgent(agentId: string): Agent | undefined;
  listAgents(): Agent[];
  getState(): AgentState;
  updateState(updates: Partial<AgentState>): void;
  listMissions(limit?: number): Mission[];
  getMission(missionId: string): Mission | null;
  getAgentState(): AgentState;
  simulateAction(action: string, context: unknown): GovernanceDecision;
  compareDNAVersions(
    dna1: DNA,
    dna2: DNA,
  ): {
    score1: number;
    score2: number;
    difference: number;
    recommendation: string;
  };
  private scoreDNA;
  getStatus(): {
    engine: boolean;
    dna: string | null;
    missions: number;
    agents: number;
    state: AgentState;
  };
}
export default BehaviorOS;
//# sourceMappingURL=behavior-os.d.ts.map
