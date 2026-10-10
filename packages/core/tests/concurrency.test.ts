import type { Mission } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../src/engine/mission-engine.js';

describe('MissionEngine Concurrency Simulation', () => {
  it('should handle multiple sequential operations', () => {
    const engine = new MissionEngine();
    const missions: Mission[] = [];

    // Simulate 10 concurrent missions being created
    for (let i = 0; i < 10; i++) {
      missions.push(
        engine.create({
          title: `Mission ${i}`,
          type: 'feature',
          priority:
            i % 4 === 0 ? 'critical' : i % 3 === 0 ? 'high' : i % 2 === 0 ? 'medium' : 'low',
          dnaPattern: 'test',
          createdBy: `agent-${i}`,
        }),
      );
    }

    // Start all missions
    for (const m of missions) {
      engine.start(m.id);
    }

    // Complete half
    for (let i = 0; i < 5; i++) {
      engine.complete(missions[i].id);
    }

    // Verify counts
    const all = engine.list();
    const completed = engine.list({ status: 'completed' });
    const active = engine.list({ status: 'active' });

    expect(all).toHaveLength(10);
    expect(completed).toHaveLength(5);
    expect(active).toHaveLength(5);
  });

  it('should handle rapid progress updates', () => {
    const engine = new MissionEngine();
    const mission = engine.create({
      title: 'Rapid Updates',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);

    // Rapid progress updates
    for (let i = 0; i <= 100; i += 10) {
      engine.updateProgress(mission.id, i);
    }

    const updated = engine.get(mission.id);
    expect(updated?.progress).toBe(100);
  });

  it('should handle mission failure and retry', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Retry Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);
    engine.fail(mission.id, 'First failure');

    const failed = engine.get(mission.id);
    expect(failed?.status).toBe('failed');

    // Create a new mission to replace the failed one
    const replacement = engine.create({
      title: 'Retry Mission (Attempt 2)',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(replacement.id);
    expect(replacement.status).toBe('active');
  });

  it('should maintain consistent state after bulk operations', () => {
    const engine = new MissionEngine();

    // Bulk create
    for (let i = 0; i < 50; i++) {
      engine.create({
        title: `Bulk ${i}`,
        type: 'bugfix',
        priority: 'medium',
        dnaPattern: 'test',
        createdBy: 'bulk-agent',
      });
    }

    const list = engine.list();
    expect(list).toHaveLength(50);

    // Bulk start
    for (const m of list) {
      engine.start(m.id);
    }

    const active = engine.list({ status: 'active' });
    expect(active).toHaveLength(50);
  });
});
