import type { DNA } from '@behavior-os/schemas';
import { AntipatternEngine } from './antipattern-engine.js';
import { AuditEngine } from './audit-engine.js';
import { BehavioralUXEngine } from './behavioral-ux.js';
import { BrainstormEngine } from './brainstorm-engine.js';
import { ConsensusEngine } from './consensus-engine.js';
import { CrossDnaLearningEngine } from './cross-dna-learning.js';
import { DecisionEngine } from './decision-engine.js';
import { DNALoader } from './dna-loader.js';
import { DriftEngine } from './drift-engine.js';
import { DynamicDNAManager } from './dynamic-dna.js';
import { GovernanceEngine } from './governance-engine.js';
import { LearningEngine } from './learning-engine.js';
import { MetricsEngine } from './metrics-engine.js';
import { MissionEngine } from './mission-engine.js';
import { PragmaticConversationEngine } from './pragmatic-conversation.js';
import { PredictionEngine } from './prediction-engine.js';
import { QualityEngine } from './quality-engine.js';
import { RecommendationEngine } from './recommendation-engine.js';
import { RolePolicyEngine } from './role-policy-engine.js';

export { resolveAuditRoot } from './audit-engine.js';
export * from './code-edit-engine.js';
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
  AntipatternEngine,
  AuditEngine,
  BehavioralUXEngine,
  BrainstormEngine,
  ConsensusEngine,
  CrossDnaLearningEngine,
  DecisionEngine,
  DNALoader,
  DriftEngine,
  DynamicDNAManager,
  GovernanceEngine,
  LearningEngine,
  MetricsEngine,
  MissionEngine,
  PragmaticConversationEngine,
  PredictionEngine,
  QualityEngine,
  RecommendationEngine,
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

  getDNALoader(): DNALoader {
    return this.dnaLoader;
  }
}
