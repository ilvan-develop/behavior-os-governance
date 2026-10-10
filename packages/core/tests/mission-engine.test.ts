import { describe, expect, it } from 'vitest';
import { MissionEngine } from '../src/engine/mission-engine.js';

describe('MissionEngine', () => {
  let engine: MissionEngine;

  beforeEach(() => {
    engine = new MissionEngine();
  });

  it('should create a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'enterprise-governance',
      createdBy: 'agent-1',
    });

    expect(mission.id).toBeDefined();
    expect(mission.title).toBe('Test Mission');
    expect(mission.status).toBe('pending');
    expect(mission.progress).toBe(0);
    expect(mission.createdAt).toBeDefined();
  });

  it('should start a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const started = engine.start(mission.id);
    expect(started?.status).toBe('active');
  });

  it('should complete a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.start(mission.id);
    const completed = engine.complete(mission.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.progress).toBe(100);
  });

  it('should fail a mission', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const failed = engine.fail(mission.id, 'Something went wrong');
    expect(failed?.status).toBe('failed');
  });

  it('should get mission by id', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const found = engine.get(mission.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe('Test Mission');
  });

  it('should return null for non-existent mission', () => {
    const found = engine.get('non-existent');
    expect(found).toBeNull();
  });

  it('should list all missions', () => {
    const _m1 = engine.create({
      title: 'Mission 1',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m2 = engine.create({
      title: 'Mission 2',
      type: 'bugfix',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const missions = engine.list();
    expect(missions).toHaveLength(2);
  });

  it('should filter missions by status', () => {
    const m1 = engine.create({
      title: 'Pending',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    engine.start(m1.id);

    const pending = engine.list({ status: 'pending' });
    const active = engine.list({ status: 'active' });

    expect(pending).toHaveLength(0);
    expect(active).toHaveLength(1);
  });

  it('should filter missions by priority', () => {
    engine.create({
      title: 'Low',
      type: 'feature',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    engine.create({
      title: 'Critical',
      type: 'feature',
      priority: 'critical',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const critical = engine.list({ priority: 'critical' });
    expect(critical).toHaveLength(1);
    expect(critical[0].title).toBe('Critical');
  });

  it('should update progress', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.updateProgress(mission.id, 50);
    const updated = engine.get(mission.id);
    expect(updated?.progress).toBe(50);
  });

  it('should cap progress at 100', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    engine.updateProgress(mission.id, 150);
    const updated = engine.get(mission.id);
    expect(updated?.progress).toBe(100);
  });

  it('should sort by priority', () => {
    const _m1 = engine.create({
      title: 'Low',
      type: 'feature',
      priority: 'low',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m2 = engine.create({
      title: 'Critical',
      type: 'feature',
      priority: 'critical',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });
    const _m3 = engine.create({
      title: 'Medium',
      type: 'feature',
      priority: 'medium',
      dnaPattern: 'test',
      createdBy: 'agent-1',
    });

    const missions = engine.list();
    expect(missions[0].priority).toBe('critical');
    expect(missions[1].priority).toBe('medium');
    expect(missions[2].priority).toBe('low');
  });

  it('should return null for non-existent mission operations', () => {
    expect(engine.start('non-existent')).toBeNull();
    expect(engine.complete('non-existent')).toBeNull();
    expect(engine.fail('non-existent')).toBeNull();
    expect(engine.get('non-existent')).toBeNull();
    expect(engine.updateProgress('non-existent', 50)).toBeNull();
  });
});
