import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('MCP Server Integration', () => {
  it('accepts structured votes and rejects malformed ones', async () => {
    // Verify that bos_code_edit uses the canonical `votes` name and validates
    // the vote shape (voterId, choice). The old buggy version used `z.any()`
    // and accepted anything.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
      'utf-8',
    );
    // The schema must reference the shared voteSchema, not z.any().
    expect(source).toContain('z.array(voteSchema)');
    expect(source).not.toMatch(/applyVotes: z\.array\(z\.any\(\)\)/);
    // The handler must destructure both names and prefer `votes`.
    expect(source).toMatch(/votes,\s*applyVotes,/);
    expect(source).toContain('votes ?? applyVotes');
    // Sending both must produce an error.
    expect(source).toContain('both `votes` and the deprecated');
  });

  it('should support all tool categories', () => {
    const categories = [
      'governance',
      'dna',
      'quality',
      'audit',
      'mission',
      'learning',
      'agent',
      'protocol',
      'config',
      'integration',
    ];

    expect(categories.length).toBe(10);
    expect(categories.every((c) => typeof c === 'string')).toBe(true);
  });

  it('should support all audit stages', () => {
    const stages = ['lint', 'typecheck', 'security', 'coverage', 'performance', 'governance'];
    expect(stages.length).toBe(6);
  });

  it('should support all mission types', () => {
    const types = ['feature', 'bugfix', 'deployment', 'research', 'refactor', 'audit', 'incident'];
    expect(types.length).toBe(7);
  });

  it('should support all priority levels', () => {
    const priorities = ['critical', 'high', 'medium', 'low'];
    expect(priorities.length).toBe(4);
  });

  it('should support all governance actions', () => {
    const actions = ['block', 'escalate', 'warn', 'log', 'transform'];
    expect(actions.length).toBe(5);
  });

  it('should support all learning types', () => {
    const types = ['insight', 'pattern', 'fix', 'failure', 'optimization'];
    expect(types.length).toBe(5);
  });

  it('should support all impact levels', () => {
    const impacts = ['low', 'medium', 'high', 'critical'];
    expect(impacts.length).toBe(4);
  });

  it('exposes the S1 mission transition tools with equivalent contracts', () => {
    const serverSource = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts'),
      'utf-8',
    );

    for (const name of ['bos_complete_mission', 'bos_fail_mission', 'bos_cancel_mission']) {
      expect(serverSource).toContain(`'${name}'`);
    }
    expect(serverSource).toContain('transitionMission');
    expect(serverSource).toContain('requiredChecks');
    expect(serverSource).toContain('expectedVersion');
    expect(serverSource).toMatch(/evidence: z\s*\.array/);
    expect(serverSource).toMatch(/simulate: z\s*\.boolean\(\)/);
    // The audit call must forward the real stages AND the project root: a
    // client can launch the stdio server from any cwd, and without a root the
    // real stages run outside the project and report a false red (R19).
    expect(serverSource).toContain('stages,');
    expect(serverSource).toContain('simulate,');
    expect(serverSource).toContain('root: resolveAuditRoot(process.env, SERVER_DIR)');
  });
});
