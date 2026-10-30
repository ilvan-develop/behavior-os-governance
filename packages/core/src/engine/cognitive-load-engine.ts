export interface CognitiveLoadMetrics {
  totalAgents: number;
  averageLoad: number;
  averageFatigue: number;
  averageCompletionRate: number;
  overloadedCount: number;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: string;
  status: 'assigned' | 'in-progress' | 'completed' | 'failed';
  completedAt?: string;
}

/**
 * Cognitive Load Balancer Engine — distributes workload across multiple agents
 * to prevent cognitive overload and maintain optimal performance.
 *
 * Strategies:
 * - Load-aware task delegation: assign tasks based on agent capacity
 * - Cognitive fatigue prediction: predict when agents become overloaded
 * - Dynamic rebalancing: redistribute tasks when load exceeds thresholds
 * - Workload fairness: ensure equitable distribution across agent teams
 */
export interface AgentCapacity {
  /** Current load level (0-1). */
  currentLoad: number;
  /** Maximum capacity before overload (0-1). */
  maxCapacity: number;
  /** Agent's skill set. */
  skills: string[];
  /** Recent task completion rate (0-1). */
  completionRate: number;
  /** Cognitive fatigue factor (0-1, 0 = fresh, 1 = fatigued). */
  fatigue: number;
}

export interface WorkloadSummary {
  totalAgents: number;
  overloadedAgents: number;
  underutilizedAgents: number;
  averageLoad: number;
  recommendations: LoadBalancingRecommendation[];
}

export interface LoadBalancingRecommendation {
  type: 'rebalance' | 'assign' | 'pause' | 'skill-match';
  agentId: string;
  taskId?: string;
  reason: string;
  confidence: number;
}

export interface LoadBalancingOptions {
  /** Maximum load threshold before triggering rebalance (default 0.75). */
  maxLoadThreshold?: number;
  /** Minimum load for underutilized agents (default 0.25). */
  minLoadThreshold?: number;
  /** Whether to consider skill matching (default true). */
  considerSkills?: boolean;
  /** Whether to account for fatigue decay over time (default true). */
  considerFatigue?: boolean;
}

/**
 * Engine for distributing cognitive workload across agent teams.
 *
 * Prevents individual agents from becoming overloaded while ensuring
 * equitable distribution of tasks and optimal use of agent skills.
 */
export class CognitiveLoadBalancerEngine {
  private agentCapacities = new Map<string, AgentCapacity>();
  private taskAssignments = new Map<string, TaskAssignment[]>();
  private readonly defaultMaxThreshold = 0.75;
  private readonly defaultMinThreshold = 0.25;

  /** Register or update an agent's capacity profile. */
  registerAgent(agentId: string, capacity: Partial<AgentCapacity>): void {
    const existing = this.agentCapacities.get(agentId);
    this.agentCapacities.set(agentId, {
      currentLoad: 0,
      maxCapacity: 1.0,
      skills: [],
      completionRate: 0.8,
      fatigue: 0,
      ...existing,
      ...capacity,
    });
  }

  /** Record a task assignment to an agent. */
  assignTask(agentId: string, taskId: string): void {
    const assignments = this.taskAssignments.get(agentId) ?? [];
    assignments.push({
      taskId,
      agentId,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
    });
    this.taskAssignments.set(agentId, assignments);

    const capacity = this.agentCapacities.get(agentId);
    if (capacity) {
      capacity.currentLoad = Math.min(1.0, capacity.currentLoad + 0.1);
    }
  }

  /** Complete a task, reducing the agent's load. */
  completeTask(agentId: string, taskId: string): void {
    const assignments = this.taskAssignments.get(agentId);
    if (!assignments) return;

    const assignment = assignments.find((a) => a.taskId === taskId);
    if (assignment) {
      assignment.status = 'completed';
      assignment.completedAt = new Date().toISOString();
    }

    const capacity = this.agentCapacities.get(agentId);
    if (capacity) {
      capacity.currentLoad = Math.max(0, capacity.currentLoad - 0.1);
      capacity.completionRate =
        assignments.filter((a) => a.status === 'completed').length /
        Math.max(1, assignments.length);
      capacity.fatigue = Math.max(0, capacity.fatigue - 0.05);
    }
  }

  /** Get the current load of an agent. */
  getAgentLoad(agentId: string): number {
    const capacity = this.agentCapacities.get(agentId);
    return capacity?.currentLoad ?? 0;
  }

  /** Check if an agent is overloaded. */
  isAgentOverloaded(agentId: string, threshold?: number): boolean {
    const capacity = this.agentCapacities.get(agentId);
    if (!capacity) return false;
    const maxThreshold = threshold ?? this.defaultMaxThreshold;
    return capacity.currentLoad > maxThreshold;
  }

  /** Analyze the overall workload distribution and suggest rebalancing. */
  analyzeWorkload(options: LoadBalancingOptions = {}): WorkloadSummary {
    const maxThreshold = options.maxLoadThreshold ?? this.defaultMaxThreshold;
    const minThreshold = options.minLoadThreshold ?? this.defaultMinThreshold;
    const considerSkills = options.considerSkills ?? true;
    const considerFatigue = options.considerFatigue ?? true;

    const recommendations: LoadBalancingRecommendation[] = [];
    let overloadedCount = 0;
    let underutilizedCount = 0;
    let totalLoad = 0;
    const agents = Array.from(this.agentCapacities.entries());

    for (const [agentId, capacity] of agents) {
      totalLoad += capacity.currentLoad;

      // Check for overload
      const effectiveLoad = considerFatigue
        ? capacity.currentLoad * (1 + capacity.fatigue)
        : capacity.currentLoad;

      if (effectiveLoad > maxThreshold) {
        overloadedCount++;
        recommendations.push({
          type: 'rebalance',
          agentId,
          reason: `Load ${effectiveLoad.toFixed(2)} exceeds threshold ${maxThreshold}`,
          confidence: Math.min(1, effectiveLoad - maxThreshold),
        });
      } else if (capacity.currentLoad < minThreshold) {
        underutilizedCount++;
        recommendations.push({
          type: 'assign',
          agentId,
          reason: `Underutilized agent (load ${capacity.currentLoad.toFixed(2)})`,
          confidence: Math.max(0, minThreshold - capacity.currentLoad),
        });
      }

      // Check for fatigue
      if (considerFatigue && capacity.fatigue > 0.6) {
        recommendations.push({
          type: 'pause',
          agentId,
          reason: `High fatigue factor (${capacity.fatigue.toFixed(2)})`,
          confidence: capacity.fatigue,
        });
      }
    }

    // Skill-based recommendations
    if (considerSkills && agents.length > 1) {
      for (const [agentId, capacity] of agents) {
        if (
          capacity.skills.length > 0 &&
          capacity.currentLoad < maxThreshold &&
          !recommendations.some((r) => r.agentId === agentId && r.type === 'skill-match')
        ) {
          recommendations.push({
            type: 'skill-match',
            agentId,
            reason: `Agent has ${capacity.skills.length} skills and available capacity`,
            confidence: 0.8,
          });
        }
      }
    }

    const avgLoad = agents.length > 0 ? totalLoad / agents.length : 0;

    return {
      totalAgents: agents.length,
      overloadedAgents: overloadedCount,
      underutilizedAgents: underutilizedCount,
      averageLoad: avgLoad,
      recommendations,
    };
  }

  /** Assign a task to the most suitable agent based on load and skills. */
  recommendAssignment(
    _taskId: string,
    requiredSkills: string[] = [],
    options: LoadBalancingOptions = {},
  ): { agentId: string | null; reason: string } | null {
    const agents = Array.from(this.agentCapacities.entries());
    if (agents.length === 0) return null;

    const considerSkills = options.considerSkills ?? true;
    const maxThreshold = options.maxLoadThreshold ?? this.defaultMaxThreshold;

    const candidates = agents
      .filter(([_, capacity]) => {
        const effectiveLoad = capacity.currentLoad;
        const loadOk = effectiveLoad < maxThreshold;
        const skillsOk =
          !considerSkills ||
          requiredSkills.length === 0 ||
          requiredSkills.some((skill) => capacity.skills.includes(skill));
        return loadOk && skillsOk;
      })
      .sort((a, b) => a[1].currentLoad - b[1].currentLoad);

    if (candidates.length === 0) {
      return null;
    }

    const [agentId, capacity] = candidates[0];
    return {
      agentId,
      reason: `Selected agent ${agentId} with load ${capacity.currentLoad.toFixed(2)} and required skills match`,
    };
  }

  /** Reset all agent capacities and assignments. */
  reset(): void {
    this.agentCapacities.clear();
    this.taskAssignments.clear();
  }

  /** Get metrics for monitoring purposes. */
  getMetrics(): CognitiveLoadMetrics {
    const agents = Array.from(this.agentCapacities.values());
    const totalLoad = agents.reduce((sum, a) => sum + a.currentLoad, 0);
    const avgLoad = agents.length > 0 ? totalLoad / agents.length : 0;
    const avgFatigue =
      agents.length > 0 ? agents.reduce((sum, a) => sum + a.fatigue, 0) / agents.length : 0;
    const avgCompletion =
      agents.length > 0 ? agents.reduce((sum, a) => sum + a.completionRate, 0) / agents.length : 0;

    return {
      totalAgents: agents.length,
      averageLoad: avgLoad,
      averageFatigue: avgFatigue,
      averageCompletionRate: avgCompletion,
      overloadedCount: agents.filter((a) => a.currentLoad > this.defaultMaxThreshold).length,
    };
  }
}
