import type { DNA, LearningEvent } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { BehavioralUXEngine } from '../src/engine/behavioral-ux.js';

describe('BehavioralUXEngine', () => {
  const baseDna: DNA = {
    name: 'Open Source',
    version: '2.0.0',
    description: 'Test',
    personas: [{ role: 'architect', name: 'Arch', authority: 'arch', skills: ['test'] }],
    governance: [
      {
        id: 'r1',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'test', value: true }],
        description: 'Block test',
      },
      {
        id: 'r2',
        level: 'high',
        action: 'warn',
        conditions: [{ type: 'test2', value: true }],
        description: 'Warn test',
      },
      { id: 'r3', level: 'medium', action: 'log', conditions: [], description: 'Log test' },
    ],
    quality: [{ id: 'q1', type: 'test_coverage', threshold: 90, operator: 'gte' }],
  };

  const learnings: LearningEvent[] = [
    {
      id: 'l1',
      type: 'insight',
      source: 'test',
      content: 'Learned pattern 1',
      impact: 'high',
      timestamp: new Date().toISOString(),
    },
    {
      id: 'l2',
      type: 'pattern',
      source: 'test',
      content: 'Learned pattern 2',
      impact: 'medium',
      timestamp: new Date().toISOString(),
    },
  ];

  it('generates a behavioral profile', () => {
    const ux = new BehavioralUXEngine();
    const profile = ux.generateProfile(
      'agent-1',
      'architect',
      'open-source',
      baseDna,
      learnings,
      [],
    );
    expect(profile.agentId).toBe('agent-1');
    expect(profile.persona).toBe('architect');
    expect(profile.dnaPattern).toBe('open-source');
    expect(profile.traits).toHaveLength(4);
    expect(profile.governanceScore).toBeGreaterThan(0);
  });

  it('generates markdown report', () => {
    const ux = new BehavioralUXEngine();
    const profile = ux.generateProfile(
      'agent-1',
      'architect',
      'open-source',
      baseDna,
      learnings,
      [],
    );
    const md = ux.generateMarkdownReport('agent-1', profile);
    expect(md).toContain('agent-1');
    expect(md).toContain('architect');
    expect(md).toContain('open-source');
  });

  it('computes behavior summary', () => {
    const ux = new BehavioralUXEngine();
    const profile = ux.generateProfile(
      'agent-1',
      'architect',
      'open-source',
      baseDna,
      learnings,
      [],
    );
    const summary = ux.getBehaviorSummary(profile);
    expect(summary).toContain('architect');
    expect(summary).toContain('open-source');
  });

  it('returns status emoji based on scores', () => {
    const ux = new BehavioralUXEngine();
    const profile = ux.generateProfile(
      'agent-1',
      'architect',
      'open-source',
      baseDna,
      learnings,
      [],
    );
    const emoji = ux.getStatusEmoji(profile);
    expect(['🟢', '🟡', '🔴']).toContain(emoji);
  });

  it('compares two DNA patterns for drift', () => {
    const ux = new BehavioralUXEngine();
    const olderDna: DNA = { ...baseDna, name: 'Old DNA', governance: [baseDna.governance[0]] };
    const newerDna: DNA = {
      ...baseDna,
      name: 'New DNA',
      governance: [
        ...baseDna.governance,
        { id: 'r4', level: 'high', action: 'block', conditions: [], description: 'New rule' },
      ],
    };

    // Drift info manually constructed for test
    const driftInfo = {
      id: 'drift-1',
      newerName: 'New DNA',
      olderName: 'Old DNA',
      rulesAdded: 1,
      rulesRemoved: 0,
      rulesChanged: [],
      gatesAdded: 0,
      gatesRemoved: 0,
      gatesChanged: [],
      totalChanges: 1,
      significant: false,
      summary: '1 rule added',
      timestamp: new Date().toISOString(),
    };

    const diff = ux.compareBehaviors('agent-1', olderDna, newerDna, driftInfo);
    expect(diff.id).toBeDefined();
    expect(diff.drift.rulesAdded).toBe(1);
  });

  it('teaches behavior', () => {
    const ux = new BehavioralUXEngine();
    const edu = ux.teachBehavior(
      'agent-1',
      'bad-pattern',
      'Do the right thing instead',
      'Wrong behavior detected',
      'mentor',
    );
    expect(edu.id).toBeDefined();
    expect(edu.correction).toBe('Do the right thing instead');
  });

  it('confirms education', () => {
    const ux = new BehavioralUXEngine();
    const edu = ux.teachBehavior('agent-1', 'p1', 'c1', 'r1', 't1');
    const result = ux.confirmEducation(edu.id, 'mentor2');
    expect(result).toBe(true);
  });

  it('getTimeline returns entries', () => {
    const ux = new BehavioralUXEngine();
    ux.generateProfile('agent-1', 'arch', 'open-source', baseDna, learnings, []);
    const timeline = ux.getTimeline('agent-1');
    expect(timeline.length).toBeGreaterThan(0);
  });

  it('getEducationRecords returns entries', () => {
    const ux = new BehavioralUXEngine();
    ux.teachBehavior('agent-1', 'p1', 'c1', 'r1', 't1');
    const records = ux.getEducationRecords('agent-1');
    expect(records.length).toBe(1);
  });

  it('handles empty timeline', () => {
    const ux = new BehavioralUXEngine();
    const timeline = ux.getTimeline('nonexistent-agent');
    expect(timeline).toHaveLength(0);
  });
});
