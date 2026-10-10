import { describe, expect, it } from 'vitest';
import type { AuditReport, GovernanceDecision, LearningEvent, Mission } from '../src/index.js';
import {
  AuditReportSchema,
  GovernanceDecisionSchema,
  LearningEventSchema,
  MissionSchema,
} from '../src/index.js';

describe('Schema Round-trip Tests', () => {
  it('should serialize and deserialize mission', () => {
    const mission: Mission = {
      id: 'test-mission-1',
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      status: 'active',
      dnaPattern: 'surgical-team',
      createdBy: 'agent-1',
      createdAt: '2026-10-10T00:00:00Z',
      updatedAt: '2026-10-10T00:00:00Z',
      progress: 50,
    };

    const serialized = MissionSchema.parse(mission);
    const deserialized = MissionSchema.parse(serialized);

    expect(deserialized.id).toBe(mission.id);
    expect(deserialized.progress).toBe(50);
  });

  it('should serialize and deserialize governance decision', () => {
    const decision: GovernanceDecision = {
      id: 'dec-1',
      action: 'deploy',
      verdict: 'deny',
      reason: 'Production change without approval',
      rulesEvaluated: ['prod-approval-required'],
      timestamp: '2026-10-10T00:00:00Z',
      agentId: 'agent-1',
    };

    const parsed = GovernanceDecisionSchema.parse(decision);
    expect(parsed.verdict).toBe('deny');
  });

  it('should serialize and deserialize audit report', () => {
    const now = new Date().toISOString();
    const report: AuditReport = {
      id: 'audit-1',
      missionId: 'mission-1',
      agentId: 'agent-1',
      stages: [{ id: 'stage-1', stage: 'lint', status: 'passed', details: {}, timestamp: now }],
      overall: 'pass',
      summary: 'All checks passed',
      timestamp: now,
    };

    const parsed = AuditReportSchema.parse(report);
    expect(parsed.overall).toBe('pass');
    expect(parsed.stages).toHaveLength(1);
  });

  it('should serialize and deserialize learning event', () => {
    const event: LearningEvent = {
      id: 'learn-1',
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'high',
      timestamp: '2026-10-10T00:00:00Z',
    };

    const parsed = LearningEventSchema.parse(event);
    expect(parsed.type).toBe('insight');
  });

  it('should handle ISO date strings', () => {
    const mission: Mission = {
      id: 'date-test',
      title: 'Date Test',
      type: 'feature',
      priority: 'low',
      status: 'completed',
      dnaPattern: 'test',
      createdBy: 'test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      progress: 100,
    };

    const parsed = MissionSchema.parse(mission);
    expect(typeof parsed.createdAt).toBe('string');
  });
});
