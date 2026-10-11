import type { DNA } from '@behavior-os/schemas';
import { AuditEngine } from './audit-engine';
import { DNALoader } from './dna-loader';
import { GovernanceEngine } from './governance-engine';
import { LearningEngine } from './learning-engine';
import { MissionEngine } from './mission-engine';
import { QualityEngine } from './quality-engine';

export { AuditEngine, DNALoader, GovernanceEngine, LearningEngine, MissionEngine, QualityEngine };
export declare class EngineRegistry {
  private engines;
  private dnaLoader;
  register(name: string, engine: unknown): void;
  get<T = unknown>(name: string): T | undefined;
  createGovernanceEngine(dna: DNA): GovernanceEngine;
  createQualityEngine(dna: DNA): QualityEngine;
  createAuditEngine(): AuditEngine;
  createLearningEngine(): LearningEngine;
  createMissionEngine(dna?: DNA): MissionEngine;
  getDNALoader(): DNALoader;
}
//# sourceMappingURL=index.d.ts.map
