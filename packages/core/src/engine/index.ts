import type { DNA } from '@behavior-os/schemas';
import { AuditEngine } from './audit-engine.js';
import { DNALoader } from './dna-loader.js';
import { GovernanceEngine } from './governance-engine.js';
import { LearningEngine } from './learning-engine.js';
import { MissionEngine } from './mission-engine.js';
import { QualityEngine } from './quality-engine.js';

export * from './pipeline-engine.js';
export { AuditEngine, DNALoader, GovernanceEngine, LearningEngine, MissionEngine, QualityEngine };

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

  getDNALoader(): DNALoader {
    return this.dnaLoader;
  }
}
