import { AuditEngine } from './audit-engine';
import { DNALoader } from './dna-loader';
import { GovernanceEngine } from './governance-engine';
import { LearningEngine } from './learning-engine';
import { MissionEngine } from './mission-engine';
import { QualityEngine } from './quality-engine';

export { AuditEngine, DNALoader, GovernanceEngine, LearningEngine, MissionEngine, QualityEngine };
export class EngineRegistry {
  engines = new Map();
  dnaLoader = new DNALoader();
  register(name, engine) {
    this.engines.set(name, engine);
  }
  get(name) {
    return this.engines.get(name);
  }
  createGovernanceEngine(dna) {
    const engine = new GovernanceEngine(dna);
    this.register('governance', engine);
    return engine;
  }
  createQualityEngine(dna) {
    const engine = new QualityEngine(dna);
    this.register('quality', engine);
    return engine;
  }
  createAuditEngine() {
    const engine = new AuditEngine();
    this.register('audit', engine);
    return engine;
  }
  createLearningEngine() {
    const engine = new LearningEngine();
    this.register('learning', engine);
    return engine;
  }
  createMissionEngine(dna) {
    const engine = new MissionEngine(dna);
    this.register('mission', engine);
    return engine;
  }
  getDNALoader() {
    return this.dnaLoader;
  }
}
//# sourceMappingURL=index.js.map
