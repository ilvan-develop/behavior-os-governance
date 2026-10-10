import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('Zod v4 Schema Validation', () => {
  it('should validate Mission schema', () => {
    const MissionSchema = z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum([
        'feature',
        'bugfix',
        'deployment',
        'research',
        'refactor',
        'audit',
        'incident',
      ]),
      priority: z.enum(['critical', 'high', 'medium', 'low']),
      status: z.enum(['pending', 'active', 'completed', 'failed']),
      dnaPattern: z.string(),
      createdBy: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      progress: z.number().min(0).max(100).default(0),
    });

    const validMission = {
      id: 'm-1',
      title: 'Test',
      type: 'feature',
      priority: 'high',
      status: 'pending',
      dnaPattern: 'surgical-team',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 0,
    };

    const result = MissionSchema.safeParse(validMission);
    expect(result.success).toBe(true);
  });

  it('should reject invalid Mission schema', () => {
    const MissionSchema = z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum(['feature', 'bugfix']),
      priority: z.enum(['critical', 'high']),
    });

    const invalidMission = {
      id: 'm-1',
      title: 'Test',
      type: 'invalid',
      priority: 'high',
    };

    const result = MissionSchema.safeParse(invalidMission);
    expect(result.success).toBe(false);
  });

  it('should validate GovernanceDecision schema', () => {
    const DecisionSchema = z.object({
      id: z.string(),
      action: z.string(),
      verdict: z.enum(['allow', 'deny', 'escalate', 'transform']),
      reason: z.string(),
      rulesEvaluated: z.array(z.string()),
      timestamp: z.string(),
      agentId: z.string(),
      transformed: z.boolean().optional(),
    });

    const validDecision = {
      id: 'd-1',
      action: 'deploy',
      verdict: 'deny',
      reason: 'Blocked by governance',
      rulesEvaluated: ['rule-1'],
      timestamp: new Date().toISOString(),
      agentId: 'agent-1',
    };

    const result = DecisionSchema.safeParse(validDecision);
    expect(result.success).toBe(true);
  });

  it('should validate QualityResult schema', () => {
    const QualitySchema = z.object({
      passed: z.boolean(),
      failedGates: z.array(
        z.object({
          id: z.string(),
          expected: z.number(),
          actual: z.number(),
          type: z.string().optional(),
        }),
      ),
      metrics: z.record(z.string(), z.number()),
    });

    const validQuality = {
      passed: true,
      failedGates: [],
      metrics: { test_coverage: 90, lint_errors: 0 },
    };

    const result = QualitySchema.safeParse(validQuality);
    expect(result.success).toBe(true);
  });

  it('should validate AuditReport schema', () => {
    const AuditSchema = z.object({
      id: z.string(),
      missionId: z.string(),
      agentId: z.string(),
      stages: z.array(
        z.object({
          id: z.string(),
          stage: z.string(),
          status: z.enum(['passed', 'failed', 'warning', 'skipped']),
          details: z.record(z.string(), z.any()),
          timestamp: z.string(),
        }),
      ),
      overall: z.enum(['pass', 'fail', 'warning']),
      summary: z.string(),
      timestamp: z.string(),
    });

    const validAudit = {
      id: 'a-1',
      missionId: 'm-1',
      agentId: 'agent-1',
      stages: [
        {
          id: 's-1',
          stage: 'lint',
          status: 'passed',
          details: {},
          timestamp: new Date().toISOString(),
        },
      ],
      overall: 'pass',
      summary: 'All checks passed',
      timestamp: new Date().toISOString(),
    };

    const result = AuditSchema.safeParse(validAudit);
    expect(result.success).toBe(true);
  });

  it('should validate LearningEvent schema', () => {
    const LearningSchema = z.object({
      id: z.string(),
      type: z.enum(['insight', 'pattern', 'fix', 'failure', 'optimization']),
      source: z.string(),
      content: z.string(),
      impact: z.enum(['low', 'medium', 'high', 'critical']),
      relatedMission: z.string().optional(),
      relatedPattern: z.string().optional(),
      timestamp: z.string(),
      metadata: z.record(z.string(), z.any()).optional(),
    });

    const validLearning = {
      id: 'l-1',
      type: 'insight',
      source: 'test',
      content: 'Learned something',
      impact: 'high',
      timestamp: new Date().toISOString(),
    };

    const result = LearningSchema.safeParse(validLearning);
    expect(result.success).toBe(true);
  });

  it('should validate DNA schema', () => {
    const DNASchema = z.object({
      name: z.string(),
      version: z.string(),
      description: z.string(),
      personas: z.array(
        z.object({
          role: z.string(),
          name: z.string(),
          authority: z.string(),
          skills: z.array(z.string()),
        }),
      ),
      governance: z.array(
        z.object({
          id: z.string(),
          level: z.enum(['critical', 'high', 'medium', 'low']),
          action: z.enum(['block', 'escalate', 'warn', 'log', 'transform']),
          conditions: z.array(
            z.object({
              type: z.string(),
              value: z.unknown(),
            }),
          ),
          description: z.string().optional(),
        }),
      ),
      quality: z.array(
        z.object({
          id: z.string(),
          type: z.enum([
            'test_coverage',
            'lint',
            'typecheck',
            'security',
            'performance',
            'access_control',
          ]),
          threshold: z.number(),
        }),
      ),
    });

    const validDNA = {
      name: 'Test DNA',
      version: '2.0.0',
      description: 'Test',
      personas: [{ role: 'architect', name: 'Test', authority: 'architect', skills: ['test'] }],
      governance: [
        {
          id: 'g1',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'test', value: true }],
          description: 'Test',
        },
      ],
      quality: [{ id: 'q1', type: 'test_coverage', threshold: 80 }],
    };

    const result = DNASchema.safeParse(validDNA);
    expect(result.success).toBe(true);
  });
});
