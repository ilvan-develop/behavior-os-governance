import { BehaviorOS, type BehaviorOSConfig } from '@behavior-os/core';
import type {
  AuditReport,
  DNA,
  GovernanceDecision,
  LearningEvent,
  Mission,
} from '@behavior-os/schemas';

export type { BehaviorOSConfig } from '@behavior-os/core';
export { BehaviorOS } from '@behavior-os/core';
export type {
  Agent,
  AuditReport,
  DNA,
  GovernanceDecision,
  LearningEvent,
  Mission,
} from '@behavior-os/schemas';

export class BehaviorOSSDK {
  private bos: BehaviorOS;

  constructor(config: BehaviorOSConfig = {}) {
    this.bos = new BehaviorOS(config);
  }

  // DNA Management
  async loadDNA(dna: DNA): Promise<void> {
    await this.bos.loadDNA(dna);
  }

  getDNA(): DNA | null {
    return this.bos.getDNA();
  }

  // Governance
  evaluateGovernance(
    action: string,
    context: { agent: string; scope?: string; [key: string]: unknown },
  ): GovernanceDecision {
    return this.bos.evaluateGovernance(action, context);
  }

  // Quality
  checkQuality(metrics: Record<string, number>): { passed: boolean; details: unknown } {
    return this.bos.checkQuality(metrics);
  }

  // Audit
  runAudit(options: { missionId: string; agentId: string; stages?: string[] }): AuditReport {
    return this.bos.runAudit(options);
  }

  // Missions
  createMission(options: {
    title: string;
    type: string;
    priority: string;
    dnaPattern?: string;
  }): Mission {
    return this.bos.createMission(options);
  }

  startMission(missionId: string): Mission | null {
    return this.bos.startMission(missionId);
  }

  // Learning
  recordLearning(options: {
    type: string;
    source: string;
    content: string;
    impact: string;
  }): LearningEvent {
    return this.bos.recordLearning(options);
  }

  getInsights(limit = 10): LearningEvent[] {
    return this.bos.getInsights(limit);
  }

  // Status
  getStatus() {
    return this.bos.getStatus();
  }

  getState() {
    return this.bos.getState();
  }
}

export default BehaviorOSSDK;
