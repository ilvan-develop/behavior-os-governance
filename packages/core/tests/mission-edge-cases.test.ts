import { describe, expect, it } from 'vitest';
import { type CreateMissionOptions, MissionEngine } from '../src/engine/mission-engine.js';

describe('MissionEngine Edge Cases', () => {
  it('should handle very long mission titles', () => {
    const engine = new MissionEngine();
    const longTitle = 'x'.repeat(10000);

    const mission = engine.create({
      title: longTitle,
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toBe(longTitle);
  });

  it('should handle Unicode in mission titles', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: '测试任务',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: '测试',
    });

    expect(mission.title).toBe('测试任务');
  });

  it('should handle special characters in titles', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Mission \'quotes\' & "double quotes" and symbols: @#$%',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toContain("'quotes'");
  });

  it('should handle empty string title', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: '',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toBe('');
  });

  it('should handle whitespace-only title', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: '   ',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toBe('   ');
  });

  it('should handle null createdBy', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Test',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      // Deliberately malformed input at the runtime boundary.
      createdBy: null as unknown as string,
    });

    expect(mission.createdBy).toBeNull();
  });

  it('should handle undefined metadata', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Test',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
      // Extra input at the runtime boundary: `metadata` is not part of
      // CreateMissionOptions and must be ignored without throwing.
      metadata: undefined,
    } as unknown as CreateMissionOptions);

    expect((mission as unknown as { metadata?: unknown }).metadata).toBeUndefined();
  });

  it('should handle emoji in titles', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: '🚀 Launch feature',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toContain('🚀');
  });

  it('should handle newlines in titles', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Line 1\nLine 2\r\nLine 3',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.title).toContain('\n');
  });

  it('should handle null reason on fail', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Test',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);
    const failed = engine.fail(mission.id, null as unknown as string | undefined);

    expect(failed).not.toBeNull();
    expect(failed?.status).toBe('failed');
  });

  it('should handle extremely high priority numbers', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Test',
      type: 'feature',
      priority: 'critical',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    expect(mission.priority).toBe('critical');
  });

  it('should handle sequential operations with no gaps', () => {
    const engine = new MissionEngine();

    // Create and immediately complete without starting
    const mission = engine.create({
      title: 'Direct Complete',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    // This might fail or succeed depending on implementation
    const completed = engine.complete(mission.id);
    // Should not crash
    expect(completed).toBeDefined();
  });

  it('should handle concurrent updates to same mission', () => {
    const engine = new MissionEngine();

    const mission = engine.create({
      title: 'Concurrent Test',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);

    // Multiple progress updates in rapid succession
    engine.updateProgress(mission.id, 25);
    engine.updateProgress(mission.id, 50);
    engine.updateProgress(mission.id, 75);

    const final = engine.get(mission.id);
    expect(final).toBeDefined();
    expect(final?.progress).toBe(75);
  });
});
