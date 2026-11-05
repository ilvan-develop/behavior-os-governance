import type { DNA } from '@behavior-os/schemas';
import { AnomalyDetectionEngine } from './anomaly-detection-engine.js';
import { AntipatternEngine } from './antipattern-engine.js';
import { AuditEngine } from './audit-engine.js';
import { BehavioralUXEngine } from './behavioral-ux.js';
import { BrainstormEngine } from './brainstorm-engine.js';
import { CircuitBreakerIntelligence } from './circuit-breaker-intelligence.js';
import { CognitiveLoadBalancerEngine } from './cognitive-load-engine.js';
import { CollectiveIntelligenceEngine } from './collective-intelligence-engine.js';
import { ComplianceMapperEngine } from './compliance-mapper-engine.js';
import { ConfidenceWeightedGateSelector } from './confidence-weighted-gate-selector.js';
import { ConsensusEngine } from './consensus-engine.js';
import { CounterfactualAuditEngine } from './counterfactual-audit-engine.js';
import { CrossDnaLearningEngine } from './cross-dna-learning.js';
import { CrossDnaPipelineTransferEngine } from './cross-dna-pipeline-transfer-engine.js';
import { CrossDomainTransferEngine } from './cross-domain-transfer-engine.js';
import { DecisionEngine } from './decision-engine.js';
import { DNALoader } from './dna-loader.js';
import { DriftEngine } from './drift-engine.js';
import { DynamicDNAManager } from './dynamic-dna.js';
import { DynamicPolicyEngine } from './dynamic-policy-engine.js';
import { ExperientialLearningEngine } from './experiential-learning-engine.js';
import { ExplainableReportEngine } from './explainable-report-engine.js';
import { ExternalSystemAdapter } from './external-adapter-engine.js';
import { FairnessEngine } from './fairness-engine.js';
import { GovernanceAsCodeEngine } from './governance-as-code-engine.js';
import { GovernanceEngine } from './governance-engine.js';
import { HybridEvaluationEngine } from './hybrid-evaluation-engine.js';
import { KnowledgeGraphEngine } from './knowledge-graph-engine.js';
import { LearningEngine } from './learning-engine.js';
import { MemoryConsolidationEngine } from './memory-consolidation-engine.js';
import { MetaCognitionEngine } from './metacognition-engine.js';
import { MetricsEngine } from './metrics-engine.js';
import { MissionEngine } from './mission-engine.js';
import { NaturalLanguageEngine } from './natural-language-engine.js';
import { PersistentMemoryEngine } from './persistent-memory-engine.js';
import { PipelinePlannerEngine } from './pipeline-planner.js';
import { PipelineRecoveryEngine } from './pipeline-recovery-engine.js';
import { PragmaticConversationEngine } from './pragmatic-conversation.js';
import { PredictionEngine } from './prediction-engine.js';
import { QualityEngine } from './quality-engine.js';
import { RecommendationEngine } from './recommendation-engine.js';
import { RolePolicyEngine } from './role-policy-engine.js';
import { TemporalGovernanceEngine } from './temporal-governance-engine.js';
import { TemporalPatternEngine } from './temporal-pattern-engine.js';
import { ValueAlignmentEngine } from './value-alignment-engine.js';
import { ZeroTrustIdentityEngine } from './zero-trust-identity-engine.js';

export { resolveAuditRoot } from './audit-engine.js';
export * from './code-edit-engine.js';
export type { FairnessInput, ProvenanceCheck } from './fairness-engine.js';
export type {
  AdvanceLearningRecordOptions,
  CreateLearningRecordOptions,
  LearningAdvanceResult,
} from './learning-engine.js';
export { LEARNING_STAGES } from './learning-engine.js';
export type {
  CreateMissionOptions,
  MissionEvidenceInput,
  MissionTransitionErrorCode,
  MissionTransitionOptions,
  MissionTransitionResult,
} from './mission-engine.js';
export * from './pipeline-engine.js';
export {
  AnomalyDetectionEngine,
  AntipatternEngine,
  AuditEngine,
  BehavioralUXEngine,
  BrainstormEngine,
  CircuitBreakerIntelligence,
  CognitiveLoadBalancerEngine,
  ComplianceMapperEngine,
  ConfidenceWeightedGateSelector,
  ConsensusEngine,
  CounterfactualAuditEngine,
  CrossDnaLearningEngine,
  CrossDnaPipelineTransferEngine,
  CrossDomainTransferEngine,
  DecisionEngine,
  DNALoader,
  DriftEngine,
  DynamicDNAManager,
  DynamicPolicyEngine,
  ExperientialLearningEngine,
  ExplainableReportEngine,
  ExternalSystemAdapter,
  FairnessEngine,
  GovernanceAsCodeEngine,
  GovernanceEngine,
  HybridEvaluationEngine,
  KnowledgeGraphEngine,
  LearningEngine,
  MemoryConsolidationEngine,
  MetaCognitionEngine,
  MetricsEngine,
  MissionEngine,
  NaturalLanguageEngine,
  PersistentMemoryEngine,
  PipelinePlannerEngine,
  PipelineRecoveryEngine,
  PragmaticConversationEngine,
  PredictionEngine,
  QualityEngine,
  RecommendationEngine,
  RolePolicyEngine,
  TemporalGovernanceEngine,
  TemporalPatternEngine,
  ValueAlignmentEngine,
  ZeroTrustIdentityEngine,
};

export class EngineRegistry {
  private engines = new Map<string, unknown>();
  private engineDna = new Map<string, DNA>();
  private dnaLoader = new DNALoader();

  register(name: string, engine: unknown): void {
    this.engines.set(name, engine);
  }

  get<T = unknown>(name: string): T | undefined {
    return this.engines.get(name) as T | undefined;
  }

  // Governance and quality engines are bound to a specific DNA. Reuse the
  // existing engine while the DNA reference is unchanged so their internal
  // caches stay effective; recreate only when the DNA actually changes.
  createGovernanceEngine(dna: DNA): GovernanceEngine {
    const existing = this.engines.get('governance');
    if (existing instanceof GovernanceEngine && this.engineDna.get('governance') === dna) {
      return existing;
    }
    const engine = new GovernanceEngine(dna);
    this.engines.set('governance', engine);
    this.engineDna.set('governance', dna);
    return engine;
  }

  createQualityEngine(dna: DNA): QualityEngine {
    const existing = this.engines.get('quality');
    if (existing instanceof QualityEngine && this.engineDna.get('quality') === dna) {
      return existing;
    }
    const engine = new QualityEngine(dna);
    this.engines.set('quality', engine);
    this.engineDna.set('quality', dna);
    return engine;
  }

  createAuditEngine(): AuditEngine {
    const engine = new AuditEngine();
    this.register('audit', engine);
    return engine;
  }

  createFairnessEngine(): FairnessEngine {
    const engine = new FairnessEngine();
    this.register('fairness', engine);
    return engine;
  }

  createLearningEngine(): LearningEngine {
    const engine = new LearningEngine();
    this.register('learning', engine);
    return engine;
  }

  createMissionEngine(dna?: DNA): MissionEngine {
    const engine = new MissionEngine(dna);
    this.register('mission', engine);
    return engine;
  }

  createDecisionEngine(): DecisionEngine {
    const engine = new DecisionEngine();
    this.register('decision', engine);
    return engine;
  }

  createRecommendationEngine(): RecommendationEngine {
    const engine = new RecommendationEngine();
    this.register('recommendation', engine);
    return engine;
  }

  createDriftEngine(): DriftEngine {
    const engine = new DriftEngine();
    this.register('drift', engine);
    return engine;
  }

  createConsensusEngine(): ConsensusEngine {
    const engine = new ConsensusEngine();
    this.register('consensus', engine);
    return engine;
  }

  createPredictionEngine(): PredictionEngine {
    const engine = new PredictionEngine();
    this.register('prediction', engine);
    return engine;
  }

  createCrossDnaLearningEngine(): CrossDnaLearningEngine {
    const engine = new CrossDnaLearningEngine();
    this.register('cross-dna-learning', engine);
    return engine;
  }

  createMetricsEngine(): MetricsEngine {
    const engine = new MetricsEngine();
    this.register('metrics', engine);
    return engine;
  }

  createBrainstormEngine(): BrainstormEngine {
    const engine = new BrainstormEngine();
    this.register('brainstorm', engine);
    return engine;
  }

  createDynamicDNAManager(): DynamicDNAManager {
    const manager = new DynamicDNAManager();
    this.register('dynamic-dna', manager);
    return manager;
  }

  createBehavioralUXEngine(): BehavioralUXEngine {
    const engine = new BehavioralUXEngine();
    this.register('behavioral-ux', engine);
    return engine;
  }

  createAntipatternEngine(): AntipatternEngine {
    const engine = new AntipatternEngine();
    this.register('antipattern', engine);
    return engine;
  }

  createPragmaticConversationEngine(): PragmaticConversationEngine {
    const engine = new PragmaticConversationEngine();
    this.register('pragmatic-conversation', engine);
    return engine;
  }

  createRolePolicyEngine(): RolePolicyEngine {
    const engine = new RolePolicyEngine();
    this.register('role-policy', engine);
    return engine;
  }

  createCognitiveLoadBalancerEngine(): CognitiveLoadBalancerEngine {
    const engine = new CognitiveLoadBalancerEngine();
    this.register('cognitive-load', engine);
    return engine;
  }

  createNaturalLanguageEngine(): NaturalLanguageEngine {
    const engine = new NaturalLanguageEngine();
    this.register('natural-language', engine);
    return engine;
  }

  createTemporalGovernanceEngine(): TemporalGovernanceEngine {
    const engine = new TemporalGovernanceEngine();
    this.register('temporal-governance', engine);
    return engine;
  }

  createKnowledgeGraphEngine(): KnowledgeGraphEngine {
    const engine = new KnowledgeGraphEngine();
    this.register('knowledge-graph', engine);
    return engine;
  }

  createMetaCognitionEngine(): MetaCognitionEngine {
    const engine = new MetaCognitionEngine();
    this.register('metacognition', engine);
    return engine;
  }

  createPersistentMemoryEngine(): PersistentMemoryEngine {
    const engine = new PersistentMemoryEngine();
    this.register('persistent-memory', engine);
    return engine;
  }

  createAnomalyDetectionEngine(): AnomalyDetectionEngine {
    const engine = new AnomalyDetectionEngine();
    this.register('anomaly-detection', engine);
    return engine;
  }

  createExperientialLearningEngine(): ExperientialLearningEngine {
    const engine = new ExperientialLearningEngine();
    this.register('experiential-learning', engine);
    return engine;
  }

  createComplianceMapperEngine(): ComplianceMapperEngine {
    const engine = new ComplianceMapperEngine();
    this.register('compliance-mapper', engine);
    return engine;
  }

  createHybridEvaluationEngine(): HybridEvaluationEngine {
    const engine = new HybridEvaluationEngine();
    this.register('hybrid-evaluation', engine);
    return engine;
  }

  createZeroTrustIdentityEngine(): ZeroTrustIdentityEngine {
    const engine = new ZeroTrustIdentityEngine();
    this.register('zero-trust-identity', engine);
    return engine;
  }

  createDynamicPolicyEngine(): DynamicPolicyEngine {
    const engine = new DynamicPolicyEngine();
    this.register('dynamic-policy', engine);
    return engine;
  }

  createCounterfactualAuditEngine(): CounterfactualAuditEngine {
    const engine = new CounterfactualAuditEngine();
    this.register('counterfactual-audit', engine);
    return engine;
  }

  createExplainableReportEngine(): ExplainableReportEngine {
    const engine = new ExplainableReportEngine();
    this.register('explainable-report', engine);
    return engine;
  }

  createTemporalPatternEngine(): TemporalPatternEngine {
    const engine = new TemporalPatternEngine();
    this.register('temporal-pattern', engine);
    return engine;
  }

  createCrossDomainTransferEngine(): CrossDomainTransferEngine {
    const engine = new CrossDomainTransferEngine();
    this.register('cross-domain-transfer', engine);
    return engine;
  }

  createCrossDnaPipelineTransferEngine(): CrossDnaPipelineTransferEngine {
    const engine = new CrossDnaPipelineTransferEngine();
    this.register('cross-dna-pipeline-transfer', engine);
    return engine;
  }

  createMemoryConsolidationEngine(): MemoryConsolidationEngine {
    const engine = new MemoryConsolidationEngine();
    this.register('memory-consolidation', engine);
    return engine;
  }

  createCircuitBreakerIntelligence(): CircuitBreakerIntelligence {
    const engine = new CircuitBreakerIntelligence();
    this.register('circuit-breaker-intelligence', engine);
    return engine;
  }

  createValueAlignmentEngine(): ValueAlignmentEngine {
    const engine = new ValueAlignmentEngine();
    this.register('value-alignment', engine);
    return engine;
  }

  createCollectiveIntelligenceEngine(): CollectiveIntelligenceEngine {
    const engine = new CollectiveIntelligenceEngine();
    this.register('collective-intelligence', engine);
    return engine;
  }

  createExternalSystemAdapter(): ExternalSystemAdapter {
    const engine = new ExternalSystemAdapter();
    this.register('external-adapter', engine);
    return engine;
  }

  createGovernanceAsCodeEngine(): GovernanceAsCodeEngine {
    const engine = new GovernanceAsCodeEngine();
    this.register('governance-as-code', engine);
    return engine;
  }

  createPipelinePlannerEngine(): PipelinePlannerEngine {
    const engine = new PipelinePlannerEngine();
    this.register('pipeline-planner', engine);
    return engine;
  }

  createPipelineRecoveryEngine(): PipelineRecoveryEngine {
    const engine = new PipelineRecoveryEngine();
    this.register('pipeline-recovery', engine);
    return engine;
  }

  createConfidenceWeightedGateSelector(): ConfidenceWeightedGateSelector {
    const engine = new ConfidenceWeightedGateSelector();
    this.register('confidence-weighted-gate-selector', engine);
    return engine;
  }

  getDNALoader(): DNALoader {
    return this.dnaLoader;
  }
}
