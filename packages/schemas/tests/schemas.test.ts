import { describe, expect, it } from 'vitest';
import {
  AgentSchema,
  AgentStateSchema,
  AuditReportSchema,
  DNASchema,
  GovernanceDecisionSchema,
  LearningEventSchema,
  MissionSchema,
} from '../src/index.js';

describe('DNA Schema', () => {
  it('should validate a complete DNA pattern', () => {
    const validDNA = {
      name: 'Surgical Team',
      version: '1.0.0',
      description: 'Zero-defect governance pattern',
      personas: [
        {
          role: 'architect',
          name: 'Lead Surgeon',
          authority: 'architect',
          boundaries: [{ id: 'max-procedures', type: 'max_modules', value: 1 }],
          skills: ['surgical-procedure', 'team-leadership'],
        },
      ],
      governance: [
        {
          id: 'sterile-field',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'sterile-procedure', value: true }],
          description: 'Block non-sterile procedures',
        },
      ],
      quality: [{ id: 'zero-defect', type: 'test_coverage', threshold: 100 }],
      workflows: [
        {
          id: 'surgery',
          name: 'Surgical Protocol',
          steps: [
            { id: '1', name: 'Pre-op', required: true, approvalRequired: true },
            { id: '2', name: 'Procedure', required: true },
            { id: '3', name: 'Post-op', required: true },
          ],
        },
      ],
    };

    const result = DNASchema.safeParse(validDNA);
    expect(result.success).toBe(true);
  });

  it('should reject invalid DNA', () => {
    const invalidDNA = {
      // Missing required fields
    };

    const result = DNASchema.safeParse(invalidDNA);
    // Missing required fields should fail
    expect(result.success).toBe(false);
  });
});

describe('Mission Schema', () => {
  it('should validate a mission', () => {
    const mission = {
      id: 'mission-001',
      title: 'Implement payment module',
      type: 'feature',
      priority: 'high',
      status: 'pending',
      dnaPattern: 'enterprise-governance',
      createdBy: 'agent-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
      tags: ['payment', 'backend'],
    };

    const result = MissionSchema.safeParse(mission);
    expect(result.success).toBe(true);
  });
});

describe('Agent Schema', () => {
  it('should validate an agent', () => {
    const agent = {
      id: 'agent-001',
      name: 'DevAgent',
      type: 'developer',
      status: 'idle',
      dnaPattern: 'surgical-team',
      capabilities: ['code', 'test', 'review'],
      currentMission: null,
      metrics: {
        tasksCompleted: 42,
        tasksFailed: 2,
        avgResponseTime: 150,
        governanceViolations: 0,
      },
    };

    const result = AgentSchema.safeParse(agent);
    expect(result.success).toBe(true);
  });
});

describe('Governance Decision Schema', () => {
  it('should validate all verdict types', () => {
    const verdicts: Array<'allow' | 'deny' | 'escalate' | 'transform'> = [
      'allow',
      'deny',
      'escalate',
      'transform',
    ];

    for (const verdict of verdicts) {
      const decision = {
        id: `decision-${verdict}`,
        action: 'deploy',
        verdict,
        reason: 'Rule evaluation complete',
        rulesEvaluated: ['rule-1', 'rule-2'],
        timestamp: new Date().toISOString(),
        agentId: 'agent-001',
      };

      const result = GovernanceDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    }
  });
});

describe('Audit Report Schema', () => {
  it('should validate audit report', () => {
    const report = {
      id: 'audit-001',
      missionId: 'mission-001',
      agentId: 'agent-001',
      stages: [
        {
          id: 'stage-1',
          stage: 'lint' as const,
          status: 'passed' as const,
          details: { errors: 0, warnings: 2 },
          timestamp: new Date().toISOString(),
        },
        {
          id: 'stage-2',
          stage: 'typecheck' as const,
          status: 'passed' as const,
          details: { errors: 0 },
          timestamp: new Date().toISOString(),
        },
      ],
      overall: 'pass' as const,
      summary: 'All checks passed',
      timestamp: new Date().toISOString(),
    };

    const result = AuditReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});

describe('Learning Event Schema', () => {
  it('should validate learning events', () => {
    const event = {
      id: 'learning-001',
      type: 'insight' as const,
      source: 'post-mortem',
      content: 'Blue-green deployment reduced rollback time by 40%',
      impact: 'high' as const,
      relatedMission: 'mission-001',
      timestamp: new Date().toISOString(),
      metadata: { category: 'deployment' },
    };

    const result = LearningEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});

describe('Agent State Schema', () => {
  it('should validate agent state', () => {
    const state = {
      currentStep: 3,
      selectedDna: 'surgical-team',
      activeMission: 'mission-001',
      stepHistory: [
        { step: 1, tool: 'bos_select_dna', result: 'selected' },
        { step: 2, tool: 'display', result: 'shown' },
        { step: 3, tool: 'bos_resolve_truth', result: 'resolved' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = AgentStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });
});
