import { EngineRegistry } from './index';
export class BehaviorOS {
  registry;
  currentDNA = null;
  agentState;
  agents = new Map();
  constructor(_config = {}) {
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
  async loadDNA(dna) {
    this.currentDNA = dna;
    this.agentState.selectedDna = dna.name;
    this.agentState.updatedAt = new Date().toISOString();
  }
  getDNA() {
    return this.currentDNA;
  }
  // Governance
  evaluateGovernance(action, context) {
    if (!this.currentDNA) {
      throw new Error('No DNA loaded. Call loadDNA() first.');
    }
    const govEngine = this.registry.createGovernanceEngine(this.currentDNA);
    return govEngine.evaluate({
      action,
      agentId: context.agent,
      context: context.context || {},
    });
  }
  // Quality Gates
  checkQuality(metrics) {
    if (!this.currentDNA) {
      return { passed: true, details: null };
    }
    const qualityEngine = this.registry.createQualityEngine(this.currentDNA);
    const result = qualityEngine.evaluate(metrics);
    return { passed: result.passed, details: result };
  }
  // Audit
  runAudit(options) {
    const auditEngine = this.registry.createAuditEngine();
    const stages = options.stages?.length
      ? options.stages
      : ['lint', 'typecheck', 'security', 'coverage'];
    return auditEngine.run({
      ...options,
      stages: stages,
    });
  }
  // Missions
  createMission(options) {
    let missionEngine = this.registry.get('mission');
    if (!missionEngine) {
      missionEngine = this.registry.createMissionEngine(this.currentDNA ?? undefined);
    }
    return missionEngine.create({
      ...options,
      type: options.type,
      priority: options.priority,
      dnaPattern: options.dnaPattern ?? this.currentDNA?.name ?? 'default',
      createdBy: 'system',
    });
  }
  startMission(missionId) {
    const missionEngine = this.registry.get('mission');
    return missionEngine.start(missionId);
  }
  completeMission(missionId) {
    const missionEngine = this.registry.get('mission');
    return missionEngine.complete(missionId);
  }
  failMission(missionId, reason) {
    const missionEngine = this.registry.get('mission');
    return missionEngine.fail(missionId, reason);
  }
  // Learning
  recordLearning(options) {
    let learningEngine = this.registry.get('learning');
    if (!learningEngine) {
      learningEngine = this.registry.createLearningEngine();
    }
    return learningEngine.record({
      ...options,
      type: options.type,
      impact: options.impact,
    });
  }
  getInsights(limit = 10) {
    const learningEngine = this.registry.get('learning');
    return learningEngine.getInsights(limit);
  }
  // Agent Management
  registerAgent(agent) {
    this.agents.set(agent.id, agent);
  }
  getAgent(agentId) {
    return this.agents.get(agentId);
  }
  listAgents() {
    return Array.from(this.agents.values());
  }
  // Protocol State
  getState() {
    return this.agentState;
  }
  updateState(updates) {
    this.agentState = { ...this.agentState, ...updates, updatedAt: new Date().toISOString() };
  }
  // Mission Management
  listMissions(limit = 50) {
    const missionEngine = this.registry.get('mission');
    return missionEngine.list().slice(0, limit);
  }
  getMission(missionId) {
    const missionEngine = this.registry.get('mission');
    return missionEngine.get(missionId);
  }
  getAgentState() {
    return this.agentState;
  }
  simulateAction(action, context) {
    return this.evaluateGovernance(action, context);
  }
  compareDNAVersions(dna1, dna2) {
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
  scoreDNA(dna) {
    let score = 0;
    if (dna.version?.includes('v2')) score += 2;
    if (dna.personas.length > 3) score += 1;
    if (dna.governance.length > 5) score += 1;
    if (dna.quality.length > 3) score += 1;
    return score;
  }
  // Status
  getStatus() {
    return {
      engine: true,
      dna: this.currentDNA?.name ?? null,
      missions: this.registry.get('mission')?.list().length ?? 0,
      agents: this.agents.size,
      state: this.agentState,
    };
  }
}
export default BehaviorOS;
//# sourceMappingURL=behavior-os.js.map
