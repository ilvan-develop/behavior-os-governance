import { describe, expect, it } from 'vitest';
import {
  detectOvertake,
  mergeSnapshots,
  planPersist,
  readStoredManifest,
} from '../src/storage-sync.js';

describe('storage-sync', () => {
  describe('readStoredManifest', () => {
    it('reads a stamped envelope', () => {
      expect(readStoredManifest({ revision: 7, writer: 'p1-abc' })).toEqual({
        revision: 7,
        writer: 'p1-abc',
      });
    });

    it('treats a legacy/absent stamp as revision 0 and no writer', () => {
      expect(readStoredManifest({ version: 1 })).toEqual({ revision: 0, writer: null });
      expect(readStoredManifest(null)).toEqual({ revision: 0, writer: null });
      expect(readStoredManifest(undefined)).toEqual({ revision: 0, writer: null });
    });
  });

  describe('planPersist', () => {
    it('adopts a newer snapshot written by another instance', () => {
      const plan = planPersist({
        localRevision: 2,
        instanceId: 'inst-B',
        storedRevision: 5,
        storedWriter: 'inst-A',
      });
      expect(plan.adopt).toBe(true);
      expect(plan.nextRevision).toBe(6);
    });

    it('does not adopt a snapshot written by itself', () => {
      const plan = planPersist({
        localRevision: 7,
        instanceId: 'inst-A',
        storedRevision: 5,
        storedWriter: 'inst-A',
      });
      expect(plan.adopt).toBe(false);
      expect(plan.nextRevision).toBe(8);
    });

    it('never adopts an older foreign snapshot', () => {
      const plan = planPersist({
        localRevision: 9,
        instanceId: 'inst-B',
        storedRevision: 4,
        storedWriter: 'inst-A',
      });
      expect(plan.adopt).toBe(false);
      expect(plan.nextRevision).toBe(10);
    });

    it('keeps revisions strictly monotonic even when two writers race', () => {
      // Racing on the same revision: each write must still advance the counter.
      const a = planPersist({
        localRevision: 3,
        instanceId: 'inst-A',
        storedRevision: 3,
        storedWriter: 'inst-B',
      });
      const b = planPersist({
        localRevision: 3,
        instanceId: 'inst-B',
        storedRevision: 3,
        storedWriter: 'inst-A',
      });
      expect(a.nextRevision).toBe(4);
      expect(b.nextRevision).toBe(4);
      expect(a.adopt).toBe(false);
      expect(b.adopt).toBe(false);
    });

    it('does not adopt when no writer is recorded', () => {
      const plan = planPersist({
        localRevision: 1,
        instanceId: 'inst-A',
        storedRevision: 4,
        storedWriter: null,
      });
      expect(plan.adopt).toBe(false);
      expect(plan.nextRevision).toBe(5);
    });
  });

  describe('mergeSnapshots', () => {
    const mission = (id: string, title: string) => ({ id, title });

    it('unions missions by id, foreign (newer) wins on collision', () => {
      const merged = mergeSnapshots(
        { missions: [mission('m1', 'local-edit'), mission('m2', 'local-only')] },
        { missions: [mission('m1', 'foreign-edit'), mission('m3', 'foreign-only')] },
      );
      const titles = merged.missions.map((m) => m.title).sort();
      expect(titles).toEqual(['foreign-edit', 'foreign-only', 'local-only']);
      expect(merged.missions).toHaveLength(3);
    });

    it('unions learnings by id', () => {
      const merged = mergeSnapshots(
        { learnings: [{ id: 'l1', content: 'local' }] },
        { learnings: [{ id: 'l2', content: 'foreign' }] },
      );
      expect(merged.learnings.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
    });

    it('prefers the foreign DNA but keeps a local one when foreign has none', () => {
      const foreign = mergeSnapshots(
        { dna: undefined, agentState: { selectedDna: 'A' } },
        { dna: undefined, agentState: { selectedDna: 'B' } },
      );
      expect(foreign.agentState.selectedDna).toBe('B');

      const fallback = mergeSnapshots(
        { dna: undefined, agentState: { selectedDna: 'A' } },
        { dna: undefined, agentState: { selectedDna: null } },
      );
      expect(fallback.agentState.selectedDna).toBe('A');
    });

    it('keeps the maximum protocol step and unions the history', () => {
      const merged = mergeSnapshots(
        {
          agentState: {
            currentStep: 2,
            stepHistory: [
              { step: 1, tool: 'bos_select_dna' },
              { step: 2, tool: 'bos_create_mission' },
            ],
          },
        },
        {
          agentState: {
            currentStep: 4,
            stepHistory: [
              { step: 1, tool: 'bos_select_dna' },
              { step: 3, tool: 'bos_start_mission' },
              { step: 4, tool: 'bos_b' },
            ],
          },
        },
      );
      expect(merged.agentState.currentStep).toBe(4);
      expect(merged.agentState.stepHistory).toHaveLength(4);
    });

    it('prefers the foreign active mission, preserving the local as fallback', () => {
      const withForeign = mergeSnapshots(
        { agentState: { activeMission: 'local-mission' } },
        { agentState: { activeMission: 'foreign-mission' } },
      );
      expect(withForeign.agentState.activeMission).toBe('foreign-mission');

      const fallback = mergeSnapshots(
        { agentState: { activeMission: 'local-mission' } },
        { agentState: { activeMission: null } },
      );
      expect(fallback.agentState.activeMission).toBe('local-mission');
    });

    it('tolerates missing or malformed inputs', () => {
      const merged = mergeSnapshots(null, undefined);
      expect(merged.missions).toEqual([]);
      expect(merged.agentState.selectedDna).toBeNull();
      expect(merged.dna).toBeNull();
    });
  });

  describe('detectOvertake', () => {
    it('reports an overtake when the store holds a higher revision', () => {
      expect(detectOvertake(4, 7)).toEqual({ overtaken: true, storedRevision: 7 });
    });

    it('accepts our own write and an older store', () => {
      expect(detectOvertake(4, 4).overtaken).toBe(false);
      expect(detectOvertake(5, 4).overtaken).toBe(false);
    });
  });
});
