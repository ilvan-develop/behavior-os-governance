import { describe, expect, it } from 'vitest';
import { planPersist, readStoredManifest } from '../src/storage-sync.js';

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
});
