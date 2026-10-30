import type { ExperiencePhase, ExperienceRecord } from '@behavior-os/schemas';

/**
 * G-013: Experiential Learning Loop Engine.
 *
 * Implements the closed loop:
 *   Execute → Observe → Reflect → Abstract → Apply
 *   ↑__________________________________________↓
 *
 * Each cycle produces a {@link ExperienceRecord} that can be promoted
 * to a governance rule via the learning engine.
 */
export class ExperientialLearningEngine {
  /** All completed experience records, oldest first. */
  private records: ExperienceRecord[] = [];
  /** In-progress experiences keyed by id. */
  private active = new Map<string, ExperienceRecord>();

  /**
   * Begin a new experiential cycle for an action.
   *
   * Returns a record in the `execute` phase. Call {@link observe} to advance.
   */
  start(agentId: string, action: string): ExperienceRecord {
    const record: ExperienceRecord = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId,
      action,
      outcome: 'success',
      observation: '',
      reflection: '',
      abstraction: '',
      application: '',
      phase: 'execute',
      confidence: 0,
      createdAt: new Date().toISOString(),
    };
    this.active.set(record.id, record);
    return record;
  }

  /**
   * Advance an in-progress record to the `observe` phase.
   *
   * @param outcome - The observed result of the action.
   * @param observation - What was noticed after execution.
   */
  observe(
    id: string,
    outcome: 'success' | 'failure' | 'partial',
    observation: string,
  ): ExperienceRecord | null {
    const record = this.active.get(id);
    if (record?.phase !== 'execute') return null;
    record.outcome = outcome;
    record.observation = observation;
    record.phase = 'observe';
    return record;
  }

  /**
   * Advance an in-progress record to the `reflect` phase.
   *
   * @param reflection - What was learned from the observation.
   */
  reflect(id: string, reflection: string): ExperienceRecord | null {
    const record = this.active.get(id);
    if (record?.phase !== 'observe') return null;
    record.reflection = reflection;
    record.phase = 'reflect';
    return record;
  }

  /**
   * Advance an in-progress record to the `abstract` phase.
   *
   * @param abstraction - The generalized principle derived.
   * @param confidence - 0..1, how confident the agent is in this abstraction.
   */
  abstract(id: string, abstraction: string, confidence: number): ExperienceRecord | null {
    const record = this.active.get(id);
    if (record?.phase !== 'reflect') return null;
    record.abstraction = abstraction;
    record.confidence = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
    record.phase = 'abstract';
    return record;
  }

  /**
   * Complete the loop by advancing to the `apply` phase.
   *
   * @param application - How the abstraction was applied in a new situation.
   */
  apply(id: string, application: string): ExperienceRecord | null {
    const record = this.active.get(id);
    if (record?.phase !== 'abstract') return null;
    record.application = application;
    record.phase = 'apply';
    this.active.delete(id);
    this.records.push(record);
    return record;
  }

  /** Get all completed experience records. */
  getRecords(): ExperienceRecord[] {
    return [...this.records];
  }

  /** Get all in-progress experience records. */
  getActive(): ExperienceRecord[] {
    return [...this.active.values()];
  }

  /**
   * Summarize the experience loop for an agent:
   * how many cycles completed, average confidence, most common outcome.
   */
  summarize(agentId: string): {
    completed: number;
    active: number;
    avgConfidence: number;
    outcomeBreakdown: Record<string, number>;
  } {
    const agentRecords = this.records.filter((r) => r.agentId === agentId);
    const agentActive = this.active.size;

    const outcomeBreakdown: Record<string, number> = {};
    for (const r of agentRecords) {
      outcomeBreakdown[r.outcome] = (outcomeBreakdown[r.outcome] ?? 0) + 1;
    }

    const avgConfidence =
      agentRecords.length > 0
        ? agentRecords.reduce((sum, r) => sum + r.confidence, 0) / agentRecords.length
        : 0;

    return {
      completed: agentRecords.length,
      active: agentActive,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      outcomeBreakdown,
    };
  }
}

export type { ExperiencePhase, ExperienceRecord };
