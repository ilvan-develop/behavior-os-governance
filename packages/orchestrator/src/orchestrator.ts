import { BehaviorOS } from '@behavior-os/core';
import type { GovernanceDecision, Mission } from '@behavior-os/schemas';

/**
 * Orchestrator for autonomous AI agent teams
 * Coordinates multiple agents with DNA-driven governance
 */
export class AutonomousOrchestrator {
  private behaviorOS: BehaviorOS;
  private agents: Map<string, AgentConfig>;
  private queue: MissionQueue;

  constructor() {
    this.behaviorOS = new BehaviorOS();
    this.agents = new Map();
    this.queue = new MissionQueue();
  }

  /**
   * Register an agent with specific capabilities
   */
  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);
    this.behaviorOS.updateState({
      currentStep: 0,
      selectedDna: config.dnaPattern || null,
    });
  }

  /**
   * Execute a mission through the protocol
   */
  async executeMission(mission: Mission, agentId: string): Promise<MissionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Step 1: Select DNA
    await this.behaviorOS.loadDNA({
      name: agent.dnaPattern || 'enterprise-governance',
      version: '1.0.0',
      description: 'Default governance',
      personas: [],
      governance: [],
      quality: [],
    });

    // Step 2-4: Protocol steps handled by BehaviorOS
    const result = await this.behaviorOS.createMission({
      title: mission.title,
      type: mission.type,
      priority: mission.priority,
      createdBy: agentId,
    });

    if (!result) {
      throw new Error('Failed to create mission');
    }

    // Execute mission with governance
    const decision = await this.behaviorOS.evaluateGovernance('execute', {
      missionId: result.id,
      agentId,
    });

    return {
      missionId: result.id,
      decision,
      status: 'executed',
    };
  }

  /**
   * Get system status
   */
  getStatus(): SystemStatus {
    return {
      agents: Array.from(this.agents.keys()),
      dnaPattern: this.behaviorOS.getDNA()?.name || null,
      activeMissions: this.queue.getLength(),
    };
  }
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  dnaPattern: string;
  capabilities: string[];
  authority: 'readonly' | 'write' | 'admin';
}

/**
 * Mission execution result
 */
export interface MissionResult {
  missionId: string;
  decision: GovernanceDecision;
  status: 'executed' | 'failed' | 'pending';
}

/**
 * System status
 */
export interface SystemStatus {
  agents: string[];
  dnaPattern: string | null;
  activeMissions: number;
}

/**
 * Mission queue for priority-based execution
 */
class MissionQueue {
  private missions: Mission[] = [];

  enqueue(mission: Mission): void {
    this.missions.push(mission);
    this.missions.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  dequeue(): Mission | null {
    return this.missions.shift() || null;
  }

  getLength(): number {
    return this.missions.length;
  }
}
