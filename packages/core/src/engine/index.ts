import type { DNA } from '@behavior-os/schemas';
import { AuditEngine } from './audit-engine';
import { DNALoader } from './dna-loader';
import { GovernanceEngine } from './governance-engine';
import { LearningEngine } from './learning-engine';
import { MissionEngine } from './mission-engine';
import { QualityEngine } from './quality-engine';

export { AuditEngine, DNALoader, GovernanceEngine, LearningEngine, MissionEngine, QualityEngine };

export class EngineRegistry {
  private engines = new Map<string, unknown>();
  private dnaLoader = new DNALoader();

  register(name: string, engine: unknown): void {
    this.engines.set(name, engine);
  }

  get<T = unknown>(name: string): T | undefined {
    return this.engines.get(name) as T | undefined;
  }

  createGovernanceEngine(dna: DNA): GovernanceEngine {
    const engine = new GovernanceEngine(dna);
    this.register('governance', engine);
    return engine;
  }

  createQualityEngine(dna: DNA): QualityEngine {
    const engine = new QualityEngine(dna);
    this.register('quality', engine);
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

  getDNALoader(): DNALoader {
    return this.dnaLoader;
  }
}
