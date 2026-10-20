import { LearningRecordSchema } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os';
import { LEARNING_STAGES } from '../src/engine/learning-engine';

const base = {
  title: 'Brace escaping broke Windows globs',
  content: 'Collector received an unescaped path and dropped the run.',
  source: 'mission:s4-test',
  impact: 'high' as const,
};

describe('Learning lifecycle (G-014)', () => {
  it('opens a record at observation with no transitions', () => {
    const bos = new BehaviorOS();
    const record = bos.createLearningRecord(base);

    expect(record.stage).toBe('observation');
    expect(record.transitions).toEqual([]);
    expect(record.evidence).toEqual([]);
    expect(LEARNING_STAGES[0]).toBe('observation');
    expect(() => LearningRecordSchema.parse(record)).not.toThrow();
  });

  it('advances exactly one stage at a time and keeps an auditable trail', () => {
    const bos = new BehaviorOS();
    const record = bos.createLearningRecord(base);

    for (const [index, stage] of LEARNING_STAGES.slice(1).entries()) {
      const result = bos.advanceLearningRecord(record.id, stage, {
        actor: 'persona:architect',
        reason: `promotion ${index + 1}`,
        evidence: stage === 'validated' ? ['pnpm test: 659 cases passed'] : [],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.record.stage).toBe(stage);
      expect(result.record.transitions).toHaveLength(index + 1);
      expect(result.record.transitions.at(-1)).toMatchObject({
        from: LEARNING_STAGES[index],
        to: stage,
        actor: 'persona:architect',
      });
    }

    const stored = bos.getLearningRecords()[0];
    expect(stored?.stage).toBe('monitored');
    expect(stored?.transitions.map((transition) => transition.to)).toEqual([
      'lesson',
      'candidate',
      'validated',
      'policy',
      'monitored',
    ]);
    expect(() => LearningRecordSchema.parse(stored)).not.toThrow();
  });

  it('refuses a skipped stage and leaves the record untouched', () => {
    const bos = new BehaviorOS();
    const record = bos.createLearningRecord(base);

    const skipped = bos.advanceLearningRecord(record.id, 'candidate');
    expect(skipped.ok).toBe(false);
    if (skipped.ok) return;
    expect(skipped.code).toBe('INVALID_TRANSITION');

    const stored = bos.getLearningRecords()[0];
    expect(stored?.stage).toBe('observation');
    expect(stored?.transitions).toEqual([]);
  });

  it('refuses a regression from a terminal stage', () => {
    const bos = new BehaviorOS();
    const record = bos.createLearningRecord(base);
    for (const stage of LEARNING_STAGES.slice(1)) {
      const result = bos.advanceLearningRecord(record.id, stage, {
        evidence: ['verified in a real run'],
      });
      expect(result.ok).toBe(true);
    }

    const regression = bos.advanceLearningRecord(record.id, 'policy');
    expect(regression.ok).toBe(false);
    if (regression.ok) return;
    expect(regression.code).toBe('INVALID_TRANSITION');
    expect(bos.getLearningRecords()[0]?.stage).toBe('monitored');
  });

  it('requires evidence before a record can be validated', () => {
    const bos = new BehaviorOS();
    const record = bos.createLearningRecord(base);
    bos.advanceLearningRecord(record.id, 'lesson');
    bos.advanceLearningRecord(record.id, 'candidate');

    const unverified = bos.advanceLearningRecord(record.id, 'validated', {
      evidence: ['   '],
    });
    expect(unverified.ok).toBe(false);
    if (unverified.ok) return;
    expect(unverified.code).toBe('EVIDENCE_REQUIRED');
    expect(bos.getLearningRecords()[0]?.stage).toBe('candidate');

    const verified = bos.advanceLearningRecord(record.id, 'validated', {
      evidence: ['pnpm test: 659 cases passed'],
    });
    expect(verified.ok).toBe(true);
  });

  it('reports an unknown record as NOT_FOUND', () => {
    const bos = new BehaviorOS();
    const result = bos.advanceLearningRecord('learn-rec-does-not-exist', 'lesson');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('persists records across a snapshot round trip and keeps advancing', () => {
    const first = new BehaviorOS();
    const record = first.createLearningRecord({
      ...base,
      relatedMission: 'mission-s4',
      evidence: ['observed in the audit log'],
    });
    first.advanceLearningRecord(record.id, 'lesson');
    first.advanceLearningRecord(record.id, 'candidate');
    first.advanceLearningRecord(record.id, 'validated', {
      evidence: ['pnpm test: 659 cases passed'],
      actor: 'persona:architect',
    });

    // A real serialization boundary: snapshots are persisted as JSON.
    const snapshot = JSON.parse(JSON.stringify(first.exportState()));

    const second = new BehaviorOS();
    expect(second.importState(snapshot)).toBe(true);

    const restored = second.getLearningRecords();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: record.id,
      stage: 'validated',
      relatedMission: 'mission-s4',
    });
    expect(restored[0]?.evidence).toEqual([
      'observed in the audit log',
      'pnpm test: 659 cases passed',
    ]);
    expect(restored[0]?.transitions.map((transition) => transition.to)).toEqual([
      'lesson',
      'candidate',
      'validated',
    ]);

    // The restored record is a live record, not a frozen copy: promotions and
    // their evidence requirement still apply after the restart.
    const invalid = second.advanceLearningRecord(record.id, 'monitored');
    expect(invalid.ok).toBe(false);

    const promoted = second.advanceLearningRecord(record.id, 'policy', {
      actor: 'persona:architect',
      reason: 'encoded after restart',
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.record.stage).toBe('policy');
  });

  it('restores a pre-G-014 snapshot without records instead of failing', () => {
    const bos = new BehaviorOS();
    const snapshot = bos.exportState() as unknown as Record<string, unknown>;
    delete snapshot.learningRecords;

    expect(bos.importState(snapshot as never)).toBe(true);
    expect(bos.getLearningRecords()).toEqual([]);
  });
});
