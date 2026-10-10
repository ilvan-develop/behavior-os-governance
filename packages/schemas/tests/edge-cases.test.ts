import { describe, expect, it } from 'vitest';
import type { DNA } from '../src/index.js';
import {
  AuditStageSchema,
  DNASchema,
  GovernanceDecisionSchema,
  LearningImpactSchema,
  LearningTypeSchema,
  MissionSchema,
} from '../src/index.js';

describe('Schema Validation Edge Cases', () => {
  it('should validate minimal DNA', () => {
    const result = DNASchema.safeParse({
      name: 'Minimal',
      version: '1.0.0',
      description: 'Minimal DNA',
      personas: [],
      governance: [],
      quality: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Minimal');
    }
  });

  it('should validate DNA with all fields', () => {
    const result = DNASchema.safeParse({
      name: 'Complete',
      version: '2.0.0',
      description: 'Complete DNA with all fields',
      personas: [
        {
          role: 'developer',
          name: 'Dev Agent',
          authority: 'developer',
          boundaries: [{ id: 'max-lines', type: 'max_lines', value: 1000 }],
          skills: ['coding', 'testing', 'reviewing'],
          description: 'Full-featured developer',
        },
      ],
      governance: [
        {
          id: 'rule-1',
          level: 'critical',
          action: 'block',
          conditions: [
            { type: 'production', value: true },
            { type: 'environment', value: 'prod' },
          ],
          description: 'Block production changes without approval',
        },
      ],
      quality: [
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
        { id: 'lint', type: 'lint', threshold: 0, operator: 'eq' },
      ],
      workflows: [
        {
          id: 'deploy',
          name: 'Deployment Workflow',
          steps: [
            { id: '1', name: 'Pre-deploy', required: true, approvalRequired: true },
            { id: '2', name: 'Deploy', required: true },
            { id: '3', name: 'Verify', required: true, timeoutSeconds: 300 },
          ],
        },
      ],
      metadata: {
        author: 'test',
        tags: ['governance', 'testing'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const result = DNASchema.safeParse({
      name: 'Invalid',
      // Missing version, description, personas, governance, quality
    });

    expect(result.success).toBe(false);
  });

  it('should validate all governance actions', () => {
    const actions: Array<'block' | 'escalate' | 'warn' | 'log'> = [
      'block',
      'escalate',
      'warn',
      'log',
    ];

    for (const action of actions) {
      const result = DNASchema.safeParse({
        name: 'Action Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [{ id: 'rule', level: 'high', action, conditions: [] }],
        quality: [],
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate all quality gate types', () => {
    const types = [
      'test_coverage',
      'lint',
      'typecheck',
      'security',
      'performance',
      'access_control',
    ] as const;

    for (const type of types) {
      const result = DNASchema.safeParse({
        name: 'Type Test',
        version: '1.0.0',
        description: 'Test',
        personas: [],
        governance: [],
        quality: [{ id: 'gate', type, threshold: 80 }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate mission types', () => {
    const types = [
      'feature',
      'bugfix',
      'deployment',
      'research',
      'refactor',
      'audit',
      'incident',
    ] as const;

    for (const type of types) {
      const result = MissionSchema.safeParse({
        id: `m-${type}`,
        title: `${type} mission`,
        type,
        priority: 'medium',
        status: 'pending',
        dnaPattern: 'test',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 0,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate mission priorities', () => {
    const priorities: Array<'critical' | 'high' | 'medium' | 'low'> = [
      'critical',
      'high',
      'medium',
      'low',
    ];

    for (const priority of priorities) {
      const result = MissionSchema.safeParse({
        id: `m-${priority}`,
        title: `${priority} mission`,
        type: 'feature',
        priority,
        status: 'pending',
        dnaPattern: 'test',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 0,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate mission statuses', () => {
    const statuses: Array<'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'> =
      ['pending', 'active', 'paused', 'completed', 'failed', 'cancelled'];

    for (const status of statuses) {
      const result = MissionSchema.safeParse({
        id: `m-${status}`,
        title: `${status} mission`,
        type: 'feature',
        priority: 'medium',
        status,
        dnaPattern: 'test',
        createdBy: 'test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: status === 'completed' ? 100 : 0,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate governance verdicts', () => {
    const verdicts: Array<'allow' | 'deny' | 'escalate' | 'transform'> = [
      'allow',
      'deny',
      'escalate',
      'transform',
    ];

    for (const verdict of verdicts) {
      const result = GovernanceDecisionSchema.safeParse({
        id: `d-${verdict}`,
        action: 'test',
        verdict,
        reason: 'Test reason',
        rulesEvaluated: ['rule-1'],
        timestamp: new Date().toISOString(),
        agentId: 'agent-1',
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate audit stages', () => {
    const stages: Array<
      'lint' | 'typecheck' | 'security' | 'coverage' | 'performance' | 'governance'
    > = ['lint', 'typecheck', 'security', 'coverage', 'performance', 'governance'];

    for (const stage of stages) {
      const result = AuditStageSchema.safeParse(stage);
      expect(result.success).toBe(true);
    }
  });

  it('should validate learning types', () => {
    const types: Array<'insight' | 'pattern' | 'fix' | 'failure' | 'optimization'> = [
      'insight',
      'pattern',
      'fix',
      'failure',
      'optimization',
    ];

    for (const type of types) {
      const result = LearningTypeSchema.safeParse(type);
      expect(result.success).toBe(true);
    }
  });

  it('should validate learning impacts', () => {
    const impacts: Array<'low' | 'medium' | 'high' | 'critical'> = [
      'low',
      'medium',
      'high',
      'critical',
    ];

    for (const impact of impacts) {
      const result = LearningImpactSchema.safeParse(impact);
      expect(result.success).toBe(true);
    }
  });

  it('should reject mission with negative progress', () => {
    const result = DNASchema.safeParse({
      id: 'm-bad',
      title: 'Bad mission',
      type: 'feature',
      priority: 'medium',
      status: 'pending',
      dnaPattern: 'test',
      createdBy: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject mission with progress over 100', () => {
    const result = DNASchema.safeParse({
      id: 'm-bad',
      title: 'Bad mission',
      type: 'feature',
      priority: 'medium',
      status: 'pending',
      dnaPattern: 'test',
      createdBy: 'test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: 150,
    });
    expect(result.success).toBe(false);
  });
});
