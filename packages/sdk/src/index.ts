import { BehaviorOS, type BehaviorOSConfig } from '@behavior-os/core';

export type { BehaviorOSConfig, MissionTransitionResult } from '@behavior-os/core';
export { BehaviorOS } from '@behavior-os/core';
export type {
  Agent,
  AuditReport,
  DNA,
  GovernanceDecision,
  LearningEvent,
  Mission,
  MissionPriority,
  MissionStatus,
  MissionType,
} from '@behavior-os/schemas';

/**
 * The full Behavior-OS SDK.
 *
 * It inherits the entire `BehaviorOS` facade instead of re-declaring a subset:
 * the previous hand-written wrapper exposed 15 of 140+ methods, so an SDK user
 * silently lost decisions, brainstorming, conversations, policies, temporal
 * rules, knowledge graph, memory, fairness and compliance. Inheritance makes
 * surface parity structural — a new facade method is available here the moment
 * it exists, and `sdk.test.ts` fails if the relationship ever becomes a
 * composition again.
 *
 * `BehaviorOS` is re-exported as well, so both import styles are the same
 * object graph and cannot drift.
 */
export class BehaviorOSSDK extends BehaviorOS {
  constructor(config: BehaviorOSConfig = {}) {
    super(config);
  }
}

export default BehaviorOSSDK;
