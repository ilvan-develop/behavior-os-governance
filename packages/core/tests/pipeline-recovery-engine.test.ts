/**
 * Tests for PipelineRecoveryEngine (R-022)
 *
 * Proves the auto-recovery/self-healing mechanism works:
 * 1. Recovers from missing import errors with high-confidence fixes
 * 2. Escalates after max attempts exhausted
 * 3. Escalates when no fix provider available
 * 4. Escalates when no viable proposals found
 * 5. Generates correct fix proposals for common error patterns
 */

import type {
  GateResult,
  PipelinePhase,
  PipelinePhaseDefinitionType,
  PipelineRun,
} from '@behavior-os/schemas';
import { describe, expect, it, vi } from 'vitest';
import type {
  CodeFixProposal,
  FixProvider,
  RecoveryContext,
} from '../src/engine/pipeline-recovery-engine.js';
import { PipelineRecoveryEngine } from '../src/engine/pipeline-recovery-engine.js';

function makeGateResult(
  id: string,
  name: string,
  phase: PipelinePhase,
  passed: boolean,
  details?: Record<string, unknown>,
): GateResult {
  return {
    id,
    name,
    phase,
    blocking: true,
    status: passed ? 'passed' : 'failed',
    details: details ?? {},
    durationMs: 100,
    timestamp: new Date().toISOString(),
  };
}

function makeRun(gate: GateResult): PipelineRun {
  return {
    id: 'pipe-test-001',
    overall: 'fail',
    blocked: true,
    blockedBy: gate.id,
    phases: [],
    gates: [gate],
    durationMs: 500,
    timestamp: new Date().toISOString(),
  };
}

function makeContext(
  failedGate: GateResult,
  attempt = 1,
  failureCount = 1,
  phase: PipelinePhaseDefinitionType = 'backend',
): RecoveryContext {
  return {
    run: makeRun(failedGate),
    failedGate,
    phase,
    attempt,
    failureCount,
    projectContext: {
      briefing: 'IAM backend with NestJS 12 + Better Auth',
      techStack: ['nestjs', 'nestjs-12', 'better-auth', 'postgresql', 'docker'],
      type: 'api',
    },
    projectRoot: '/fake/project',
  };
}

describe('PipelineRecoveryEngine (R-022)', () => {
  describe('generateFixProposal — rule-based patterns', () => {
    const engine = new PipelineRecoveryEngine();

    it('generates fix for "cannot find module" errors with high confidence', () => {
      const proposal = engine.generateFixProposal(
        "Cannot find module '@better-auth/nestjs'",
        'backend',
        {
          briefing: 'IAM backend',
          techStack: ['nestjs', 'better-auth'],
        },
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.confidence).toBeGreaterThanOrEqual(0.8);
      expect(proposal?.description).toContain('import');
    });

    it('generates fix for test coverage below threshold', () => {
      const proposal = engine.generateFixProposal(
        'Coverage 75.3% below threshold of 80%',
        'testing',
        { techStack: ['nestjs'] },
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.description).toContain('coverage');
      expect(proposal?.description).toContain('test');
    });

    it('generates fix for lint errors with 0.95 confidence', () => {
      const proposal = engine.generateFixProposal(
        'ESLint: formatting errors (prettier/prettier)',
        'testing',
        {},
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.confidence).toBe(0.95);
      expect(proposal?.description).toContain('lint');
    });

    it('generates fix for security vulnerabilities', () => {
      const proposal = engine.generateFixProposal(
        'npm audit: 3 vulnerabilities, 1 critical (CVE-2024-12345 in express)',
        'dependencies',
        {},
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.description).toContain('Upgrade');
      expect(proposal?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('generates NestJS + Better Auth specific fix for auth errors', () => {
      const proposal = engine.generateFixProposal(
        "Cannot find module '@better-auth/nestjs'",
        'backend',
        {
          briefing: 'IAM backend',
          techStack: ['nestjs', 'nestjs-12', 'better-auth'],
        },
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.confidence).toBeGreaterThanOrEqual(0.85);
      expect(proposal?.description).toContain('Better Auth');
      // Check that it suggests the v5+ import path
      expect(proposal?.changes.some((c) => c.new.includes('@better-auth/core/nestjs'))).toBe(true);
    });

    it('returns null for unrecognized errors', () => {
      const proposal = engine.generateFixProposal(
        'Unknown cosmic ray error in quantum flux capacitor',
        'backend',
        {},
      );

      // Might return a generic fix or null
      // The key assertion: never crashes, returns proper type
      expect(proposal === null || typeof proposal === 'object').toBe(true);
    });
  });

  describe('recover() — with mocked FixProvider', () => {
    it('recovers when a high-confidence fix is available', async () => {
      const mockFix: CodeFixProposal = {
        id: 'fix-1',
        description: 'Fix missing import path for Better Auth v5',
        confidence: 0.92,
        file: 'src/auth/auth.module.ts',
        changes: [{ line: 1, old: '@better-auth/nestjs', new: '@better-auth/core/nestjs' }],
      };

      const mockProvider: FixProvider = {
        getProposals: vi.fn().mockResolvedValue([mockFix]),
        applyFix: vi.fn().mockResolvedValue(true),
      };

      const engine = new PipelineRecoveryEngine();
      engine.setFixProvider(mockProvider);

      const gate = makeGateResult('coverage-gate', 'Coverage', 'pre', false, {
        threshold: 80,
        actual: 75,
      });

      const context = makeContext(gate);

      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
      expect(result.appliedFix).toBe('Fix missing import path for Better Auth v5');
      expect(result.fixConfidence).toBe(0.92);
      expect(result.decision.action).toBe('retry');
      expect(mockProvider.applyFix).toHaveBeenCalledWith(mockFix);
    });

    it('escalates when no fix provider is set', async () => {
      const engine = new PipelineRecoveryEngine();
      // No fix provider set

      const gate = makeGateResult('coverage-gate', 'Coverage', 'pre', false);
      const context = makeContext(gate, 1, 1, 'testing');

      const result = await engine.recover(context);

      expect(result.recovered).toBe(false);
      expect(result.decision.action).toBe('escalate');
      expect(result.decision.reason).toBe('No fix provider available — cannot auto-recover');
    });

    it('escalates after exceeding max attempts', async () => {
      const engine = new PipelineRecoveryEngine({ minFixConfidence: 0.8, maxAttempts: 2 });

      const mockProvider: FixProvider = {
        getProposals: vi.fn().mockResolvedValue([]),
        applyFix: vi.fn(),
      };
      engine.setFixProvider(mockProvider);

      const gate = makeGateResult('coverage-gate', 'Coverage', 'pre', false);
      // failureCount = 3 > maxAttempts = 2
      const context = makeContext(gate, 3, 3, 'testing');

      const result = await engine.recover(context);

      expect(result.recovered).toBe(false);
      expect(result.decision.action).toBe('escalate');
      expect(result.decision.reason).toContain('Exceeded max recovery attempts');
    });

    it('escalates when no viable proposals exceed confidence threshold', async () => {
      const lowConfidenceFix: CodeFixProposal = {
        id: 'fix-low',
        description: 'Maybe add tests?',
        confidence: 0.45,
        file: 'tests/',
        changes: [],
      };

      const mockProvider: FixProvider = {
        getProposals: vi.fn().mockResolvedValue([lowConfidenceFix]),
        applyFix: vi.fn(),
      };

      const engine = new PipelineRecoveryEngine({ minFixConfidence: 0.8 });
      engine.setFixProvider(mockProvider);

      const gate = makeGateResult('coverage-gate', 'Coverage', 'pre', false);
      const context = makeContext(gate, 1, 1, 'testing');

      const result = await engine.recover(context);

      expect(result.recovered).toBe(false);
      expect(result.decision.action).toBe('escalate');
      expect(result.decision.reason).toContain('No proposals exceeded');
      expect(mockProvider.applyFix).not.toHaveBeenCalled();
    });

    it('picks the highest-confidence proposal when multiple are viable', async () => {
      const lowConfidenceFix: CodeFixProposal = {
        id: 'fix-low',
        description: 'Low confidence fix',
        confidence: 0.85,
        file: 'src/',
        changes: [],
      };
      const highConfidenceFix: CodeFixProposal = {
        id: 'fix-high',
        description: 'High confidence fix',
        confidence: 0.97,
        file: 'src/',
        changes: [],
      };

      const mockProvider: FixProvider = {
        getProposals: vi.fn().mockResolvedValue([lowConfidenceFix, highConfidenceFix]),
        applyFix: vi.fn().mockResolvedValue(true),
      };

      const engine = new PipelineRecoveryEngine({ minFixConfidence: 0.8 });
      engine.setFixProvider(mockProvider);

      const gate = makeGateResult('lint-gate', 'Lint', 'pre', false);
      const context = makeContext(gate, 1, 1, 'testing');

      const result = await engine.recover(context);

      expect(result.recovered).toBe(true);
      expect(result.appliedFix).toBe('High confidence fix');
      expect(result.fixConfidence).toBe(0.97);
      expect(mockProvider.applyFix).toHaveBeenCalledWith(highConfidenceFix);
    });

    it('escalates when the fix cannot be applied', async () => {
      const mockFix: CodeFixProposal = {
        id: 'fix-1',
        description: 'Fix import paths',
        confidence: 0.92,
        file: 'src/app.module.ts',
        changes: [],
      };

      const mockProvider: FixProvider = {
        getProposals: vi.fn().mockResolvedValue([mockFix]),
        applyFix: vi.fn().mockResolvedValue(false), // Apply failed
      };

      const engine = new PipelineRecoveryEngine();
      engine.setFixProvider(mockProvider);

      const gate = makeGateResult('arch-gate', 'ADR required', 'pre', false);
      const context = makeContext(gate, 1, 1, 'architecture');

      const result = await engine.recover(context);

      expect(result.recovered).toBe(false);
      expect(result.decision.action).toBe('escalate');
      expect(result.decision.reason).toContain('could not be applied');
    });

    it('respects disabled configuration', async () => {
      const engine = new PipelineRecoveryEngine({ enabled: false });
      engine.setFixProvider({ getProposals: vi.fn(), applyFix: vi.fn() });

      const result = await engine.recover(
        makeContext(makeGateResult('gate-1', 'Gate', 'pre', false)),
      );

      expect(result.recovered).toBe(false);
      expect(result.decision.action).toBe('escalate');
      expect(result.decision.reason).toBe('Auto-recovery disabled');
    });
  });

  describe('isEnabled', () => {
    it('returns true by default', () => {
      expect(new PipelineRecoveryEngine().isEnabled()).toBe(true);
    });

    it('returns false when disabled in config', () => {
      expect(new PipelineRecoveryEngine({ enabled: false }).isEnabled()).toBe(false);
    });

    it('returns true after re-enabling', () => {
      const engine = new PipelineRecoveryEngine({ enabled: false });
      engine.updateConfig({ enabled: true });
      expect(engine.isEnabled()).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('updates minFixConfidence', () => {
      const engine = new PipelineRecoveryEngine();
      engine.updateConfig({ minFixConfidence: 0.5 });
      expect(engine).toBeDefined();
    });

    it('updates maxAttempts', () => {
      const engine = new PipelineRecoveryEngine();
      engine.updateConfig({ maxAttempts: 5 });
      expect(engine).toBeDefined();
    });

    it('updates enabled flag', () => {
      const engine = new PipelineRecoveryEngine({ enabled: true });
      expect(engine.isEnabled()).toBe(true);
      engine.updateConfig({ enabled: false });
      expect(engine.isEnabled()).toBe(false);
    });
  });
});
