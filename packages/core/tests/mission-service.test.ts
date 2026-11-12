import type { Mission } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../src/engine/mission-engine.js';
import type { Store } from '../src/persistence/store.js';
import { MissionService, type MissionServiceHost } from '../src/services/mission-service.js';

interface Harness {
  service: MissionService;
  engine: MissionEngine;
  protocol: string[];
  saved: Mission[];
  sessions: Map<string, boolean>;
  activeMission(): string | null;
  failNextSave: () => void;
}

/**
 * Build a MissionService over a real MissionEngine and a tiny in-memory store.
 * `sessions` models collaboration state: true = closed (decided/resolved),
 * false = open. Missing tags are treated as vanished and therefore closed.
 */
function makeHarness(): Harness {
  const engine = new MissionEngine();
  const protocol: string[] = [];
  const saved: Mission[] = [];
  const sessions = new Map<string, boolean>();
  let active: string | null = null;
  let failNext = false;

  const store = {
    saveMission(mission: Mission): void {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      saved.push(mission);
    },
  } as unknown as Store;

  const host: MissionServiceHost = {
    store: () => store,
    missionEngine: () => engine,
    isCollaborationClosed: (sessionId) => sessions.get(sessionId) !== false,
    activeMission: () => active,
    setActiveMission: (missionId) => {
      active = missionId;
    },
    dnaName: () => 'test-dna',
    advanceProtocolStep: (tool) => protocol.push(tool),
  };

  return {
    service: new MissionService(host),
    engine,
    protocol,
    saved,
    sessions,
    activeMission: () => active,
    failNextSave: () => {
      failNext = true;
    },
  };
}

describe('MissionService', () => {
  it('creates, persists and advances the protocol for explicit actions', () => {
    const h = makeHarness();
    const mission = h.service.create({
      title: 'Extract the mission service',
      type: 'refactor',
      priority: 'high',
    });

    expect(mission.dnaPattern).toBe('test-dna');
    expect(mission.createdBy).toBe('system');
    expect(h.saved.at(-1)?.id).toBe(mission.id);
    expect(h.protocol).toEqual(['bos_create_mission']);

    h.service.start(mission.id);
    expect(h.activeMission()).toBe(mission.id);
    expect(h.protocol).toEqual(['bos_create_mission', 'bos_start_mission']);
  });

  it('does not advance the protocol when the caller opts out', () => {
    const h = makeHarness();
    h.service.create({
      title: 'Auto mission',
      type: 'feature',
      priority: 'low',
      advanceProtocol: false,
    });
    expect(h.protocol).toEqual([]);
  });

  it('refuses completion while a collaboration is open and accepts it once closed', () => {
    const h = makeHarness();
    const mission = h.service.create({
      title: 'Gated mission',
      type: 'feature',
      priority: 'medium',
      tags: ['brainstorm-open'],
    });
    h.service.start(mission.id);
    h.sessions.set('brainstorm-open', false);

    const refused = h.service.transition(mission.id, 'completed');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('EVIDENCE_MISSING');
      expect(refused.message).toContain('brainstorm-open');
    }

    h.sessions.set('brainstorm-open', true);
    const accepted = h.service.transition(mission.id, 'completed');
    expect(accepted.ok).toBe(true);
    expect(h.activeMission()).toBeNull();
  });

  it('drops a collaboration tag whose session vanished instead of deadlocking', () => {
    const h = makeHarness();
    const mission = h.service.create({
      title: 'Restarted mission',
      type: 'feature',
      priority: 'medium',
      tags: ['conv-vanished'],
    });
    h.service.start(mission.id);
    // No entry in `sessions` models a session lost on restart.
    const result = h.service.transition(mission.id, 'completed');
    expect(result.ok).toBe(true);
  });

  it('rolls back creation when the store write fails', () => {
    const h = makeHarness();
    h.failNextSave();
    expect(() => h.service.create({ title: 'Failing', type: 'feature', priority: 'low' })).toThrow(
      'disk full',
    );
    expect(h.engine.list()).toHaveLength(0);
  });

  it('rolls back evidence when the store write fails', () => {
    const h = makeHarness();
    const mission = h.service.create({
      title: 'Evidence rollback',
      type: 'feature',
      priority: 'medium',
    });
    h.service.start(mission.id);

    h.failNextSave();
    const result = h.service.addEvidence(mission.id, [
      { gate: 'test', status: 'passed', source: 'vitest' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PERSISTENCE_FAILED');
    expect(h.engine.get(mission.id)?.evidence).toHaveLength(0);
  });
});
