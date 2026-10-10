import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { AuditEngine } from '../src/engine/audit-engine.js';
import { DNALoader } from '../src/engine/dna-loader.js';
import { GovernanceEngine } from '../src/engine/governance-engine.js';
import { LearningEngine } from '../src/engine/learning-engine.js';
import { MissionEngine } from '../src/engine/mission-engine.js';
import { QualityEngine } from '../src/engine/quality-engine.js';

describe('GovernanceEngine', () => {
  const mockDNA: DNA = {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [
      {
        id: 'test-rule',
        level: 'critical',
        action: 'block',
        conditions: [{ type: 'test-type', value: true }],
      },
    ],
    quality: [],
  };

  const engine = new GovernanceEngine(mockDNA);

  it('should evaluate and block violations', () => {
    const result = engine.evaluate({
      action: 'deploy-production',
      agentId: 'agent-1',
      context: { 'test-type': true },
    });
    expect(result.verdict).toBe('deny');
    expect(result.reason).toBeTruthy();
  });

  it('should allow safe actions', () => {
    const result = engine.evaluate({
      action: 'read-file',
      agentId: 'agent-1',
      context: { 'test-type': false },
    });
    expect(result.verdict).toBe('allow');
  });
});

describe('QualityEngine', () => {
  const mockDNA: DNA = {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [],
    quality: [
      { id: 'coverage', type: 'test_coverage', threshold: 80 },
      { id: 'lint', type: 'lint_errors', threshold: 0, operator: 'lte' },
    ],
  };

  const engine = new QualityEngine(mockDNA);

  it('should pass when metrics meet thresholds', () => {
    const result = engine.evaluate({
      test_coverage: 90,
      lint_errors: 0,
    });
    expect(result.passed).toBe(true);
  });

  it('should fail when metrics are below threshold', () => {
    const result = engine.evaluate({
      test_coverage: 50,
      lint_errors: 5,
    });
    expect(result.passed).toBe(false);
    expect(result.failedGates).toHaveLength(2);
  });
});

describe('AuditEngine', () => {
  const engine = new AuditEngine();

  it('should record audit stages', () => {
    const report = engine.run({
      missionId: 'm1',
      agentId: 'a1',
      stages: ['lint', 'typecheck', 'security'],
    });
    expect(report.stages).toHaveLength(3);
    expect(report.overall).toBe('pass');
  });
});

describe('LearningEngine', () => {
  const engine = new LearningEngine();

  it('should record learning events', () => {
    const event = engine.record({
      type: 'insight',
      source: 'test',
      content: 'Test insight',
      impact: 'medium',
    });
    expect(event.id).toBeTruthy();
    expect(event.content).toBe('Test insight');
  });

  it('should detect patterns', () => {
    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed',
      impact: 'high',
    });
    engine.record({
      type: 'failure',
      source: 'test',
      content: 'Deploy failed again',
      impact: 'high',
    });
    const patterns = engine.detectPatterns();
    expect(patterns.length).toBeGreaterThan(0);
  });
});

describe('MissionEngine', () => {
  const engine = new MissionEngine();

  it('should create and manage missions', () => {
    const mission = engine.create({
      title: 'Test Mission',
      type: 'feature',
      priority: 'high',
      dnaPattern: 'enterprise-governance',
      createdBy: 'agent-1',
    });
    expect(mission.id).toBeTruthy();
    expect(mission.status).toBe('pending');

    const started = engine.start(mission.id);
    expect(started.status).toBe('active');
  });
});

describe('DNALoader', () => {
  const loader = new DNALoader();

  it('should load and validate DNA patterns', () => {
    const dna = loader.load({
      name: 'Surgical Team',
      version: '1.0.0',
      description: 'Zero-defect pattern',
      personas: [],
      governance: [],
      quality: [],
    });
    expect(dna.name).toBe('Surgical Team');
  });

  it('should reject invalid DNA', () => {
    expect(() =>
      loader.load({
        name: 'Invalid',
        // Missing required fields
      }),
    ).toThrow();
  });
});
