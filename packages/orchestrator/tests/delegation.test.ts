/**
 * Delegation engine tests: bounded-concurrency role policy (F9) wired to the
 * core cognitive-load balancer (F4).
 */

import { CognitiveLoadBalancerEngine, RolePolicyEngine } from '@behavior-os/core';
import { describe, expect, it } from 'vitest';
import {
  type AgentProfile,
  DEFAULT_DELEGATION_POLICY,
  DelegationEngine,
  type DelegationRole,
} from '../src/delegation.js';

function makeProfiles(): AgentProfile[] {
  return [
    {
      id: 'explorer-1',
      role: 'explorer',
      capabilities: ['investigate', 'analyze'],
      authority: 'readonly',
    },
    {
      id: 'fixer-1',
      role: 'fixer',
      capabilities: ['implement', 'execute'],
      authority: 'write',
    },
    {
      id: 'fixer-2',
      role: 'fixer',
      capabilities: ['implement', 'execute'],
      authority: 'write',
    },
    {
      id: 'auditor-1',
      role: 'auditor',
      capabilities: ['verify'],
      authority: 'readonly',
    },
  ];
}

function engineWith(
  profiles: AgentProfile[],
  policyOverrides: Partial<import('../src/delegation.js').DelegationPolicy> = {},
) {
  const load = new CognitiveLoadBalancerEngine();
  return new DelegationEngine(load, {
    profiles,
    policy: policyOverrides,
  });
}

describe('DelegationEngine (bounded concurrency + role policy)', () => {
  it('assigns a mutating task only to a write-authority role', () => {
    const engine = engineWith(makeProfiles());
    const assignment = engine.assign({
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
      inFlightCount: 0,
    });
    expect(assignment.agentId).toBe('fixer-1'); // lowest-load write agent
    expect(assignment.role).toBe('fixer');
    expect(assignment.recommendedBy).toBe('load-balancer');
  });

  it('never assigns a mutating task to a read-only role', () => {
    const readOnlyProfiles: AgentProfile[] = [
      {
        id: 'explorer-1',
        role: 'explorer',
        capabilities: ['implement', 'analyze'],
        authority: 'readonly',
      },
    ];
    const engine = engineWith(readOnlyProfiles);
    const assignment = engine.assign({
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
      inFlightCount: 0,
    });
    expect(assignment.agentId).toBeNull();
    expect(assignment.reason).toContain('write-authority');
  });

  it('respects the concurrency budget and blocks over-assignment', () => {
    const engine = engineWith(makeProfiles());
    expect(DEFAULT_DELEGATION_POLICY.maxConcurrent).toBe(2);
    const atBudget = engine.assign({
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
      inFlightCount: 2,
    });
    expect(atBudget.agentId).toBeNull();
    expect(atBudget.reason).toContain('Concurrency budget exhausted');
  });

  it('assigns read-only work to read-only roles when no write task is pending', () => {
    const engine = engineWith(makeProfiles());
    const assignment = engine.assign({
      taskId: 'investigate',
      requiredSkills: ['investigate'],
      mutating: false,
      inFlightCount: 0,
    });
    expect(assignment.agentId).toBe('explorer-1');
    expect(assignment.role).toBe('explorer');
  });

  it('picks the least-loaded eligible agent', () => {
    const engine = engineWith(makeProfiles());
    // Simulate fixer-1 already carrying load (e.g. via a prior assignment).
    engine.onTaskStarted('fixer-1', 'prior-task');
    const assignment = engine.assign({
      taskId: 'next',
      requiredSkills: ['implement'],
      mutating: true,
      inFlightCount: 0,
    });
    // fixer-2 is now the least-loaded eligible write agent.
    expect(assignment.agentId).toBe('fixer-2');
  });

  it('releases load when a task settles as failed', () => {
    const engine = engineWith(makeProfiles());
    // Start and fail many tasks; without a release path the fixer would leak
    // load until it is permanently "overloaded".
    for (let i = 0; i < 10; i += 1) {
      engine.onTaskStarted('fixer-1', `failed-${i}`);
      engine.onTaskFailed('fixer-1', `failed-${i}`);
    }
    const assignment = engine.assign({
      taskId: 'after-failures',
      requiredSkills: ['implement'],
      mutating: true,
      inFlightCount: 0,
    });
    expect(assignment.agentId).not.toBeNull();
    expect(assignment.role).toBe('fixer');
  });

  it('exposes the registered delegation policy', () => {
    const engine = engineWith(makeProfiles());
    const policy = engine.getPolicy();
    expect(policy.maxConcurrent).toBe(2);
    expect(policy.writeRoles).toEqual(['fixer', 'operator']);
    expect(policy.readonlyRoles).toEqual(['explorer', 'auditor']);
  });
});

/**
 * The explorer/fixer/auditor roles as RolePolicyEngine registrations: a
 * read-only `explorer` cannot perform a write action; a `fixer` can; an
 * `auditor` can only verify. This proves the bounded-concurrency role policy
 * is enforceable *outside* the orchestrator by the existing role/policy layer.
 *
 * Note: `PolicyRule.action` is `['require','warn','block','auto-fix']` —
 * there is no `allow` policy action. A role with *no* matching policy gets
 * the default `allow` decision; a `block` policy explicitly blocks. This is
 * exactly the "fail-safe" posture: read-only roles get a `block` policy for
 * writes, and roles without a policy default to `allow` (with an audit entry).
 */
describe('Explorer/Fixer/Auditor role policy (RolePolicyEngine)', () => {
  function makeRolePolicyEngine(): RolePolicyEngine {
    const engine = new RolePolicyEngine();

    // A read-only role (explorer) gets a `block` policy on write actions.
    const blockWriteForReadonly = {
      id: 'block-write-readonly',
      name: 'block-write-readonly',
      description: 'Block write actions for read-only roles',
      condition: 'edit',
      action: 'block' as const,
      severity: 'high' as const,
      appliesTo: ['role'] as Array<'agent' | 'role' | 'persona' | 'project'>,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
    };
    engine.definePolicy(blockWriteForReadonly);

    engine.registerRole({
      id: 'explorer',
      name: 'Explorer',
      displayName: 'Explorer',
      responsibilities: ['investigate', 'analyze'],
      policies: ['block-write-readonly'],
      canAudit: false,
      canEnforce: false,
      canTeach: false,
    });
    engine.registerRole({
      id: 'fixer',
      name: 'Fixer',
      displayName: 'Fixer',
      responsibilities: ['implement', 'execute'],
      // No write-blocking policy: default allow applies.
      canAudit: false,
      canEnforce: false,
      canTeach: false,
    });
    engine.registerRole({
      id: 'auditor',
      name: 'Auditor',
      displayName: 'Auditor',
      responsibilities: ['verify'],
      // No write-blocking policy: default allow applies.
      canAudit: true,
      canEnforce: false,
      canTeach: false,
    });
    return engine;
  }

  it('blocks a write action for the read-only explorer role', () => {
    const engine = makeRolePolicyEngine();
    const decision = engine.evaluate({ role: 'explorer' }, 'edit');
    expect(decision.action).toBe('block');
    expect(decision.matchedPolicy?.id).toBe('block-write-readonly');
  });

  it('allows a write action for the fixer role (no blocking policy)', () => {
    const engine = makeRolePolicyEngine();
    const decision = engine.evaluate({ role: 'fixer' }, 'edit');
    expect(decision.action).toBe('allow');
    expect(decision.matchedPolicy).toBeNull();
  });

  it('allows a verify action for the auditor role', () => {
    const engine = makeRolePolicyEngine();
    const decision = engine.evaluate({ role: 'auditor' }, 'verify');
    // No policy matches "verify" for the auditor (its responsibility, not a
    // policy) → default allow with an audit trail entry.
    expect(decision.action).toBe('allow');
    expect(decision.matchedPolicy).toBeNull();
  });

  it('the auditor may audit; the explorer and fixer may not', () => {
    const engine = makeRolePolicyEngine();
    expect(engine.getRole('auditor')?.canAudit).toBe(true);
    expect(engine.getRole('explorer')?.canAudit).toBe(false);
    expect(engine.getRole('fixer')?.canAudit).toBe(false);
    const roles = new Set(engine.listRoles().map((role) => role.id) as DelegationRole[]);
    expect(roles).toEqual(new Set(['explorer', 'fixer', 'auditor']));
  });
});

describe('DelegationEngine shared reservation ledger', () => {
  it('reserves a budget slot for a distinct agent and refuses a third distinct agent', () => {
    const engine = engineWith(makeProfiles(), { maxConcurrent: 1 });
    const first = engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(first.agentId).toBe('fixer-1');
    expect(engine.activeAgentCount()).toBe(1);

    const second = engine.reserve({
      reservationKey: 'm1:t2',
      taskId: 't2',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(second.agentId).toBeNull();
    expect(second.reason).toContain('Concurrency budget exhausted');
    expect(engine.activeTaskCount()).toBe(1);
  });

  it('refuses duplicate reservation keys instead of overwriting', () => {
    const engine = engineWith(makeProfiles());
    engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    const duplicate = engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(duplicate.agentId).toBeNull();
    expect(duplicate.reason).toContain('Reservation already held');
    expect(engine.activeTaskCount()).toBe(1);
  });

  it('keeps mission-qualified keys independent across missions', () => {
    const engine = engineWith(makeProfiles());
    const first = engine.reserve({
      reservationKey: 'm1:impl',
      taskId: 'impl',
      requiredSkills: ['implement'],
      mutating: true,
    });
    const second = engine.reserve({
      reservationKey: 'm2:impl',
      taskId: 'impl',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(first.agentId).not.toBeNull();
    expect(second.agentId).not.toBeNull();
    expect(engine.activeTaskCount()).toBe(2);
  });

  it('releases a slot idempotently and frees the budget', () => {
    const engine = engineWith(makeProfiles(), { maxConcurrent: 1 });
    engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(engine.activeAgentCount()).toBe(1);

    expect(engine.release('m1:t1', true)).toBe(true);
    expect(engine.release('m1:t1', true)).toBe(false);
    expect(engine.activeAgentCount()).toBe(0);
    const retry = engine.reserve({
      reservationKey: 'm1:t2',
      taskId: 't2',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(retry.agentId).not.toBeNull();
  });

  it('cancels a pre-start reservation without touching load', () => {
    const engine = engineWith(makeProfiles());
    const assignment = engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    const agentId = assignment.agentId ?? 'unknown';
    expect(assignment.agentId).not.toBeNull();
    expect(engine.getAgentLoad(agentId)).toBe(0);

    expect(engine.cancel('m1:t1')).toBe(true);
    expect(engine.getAgentLoad(agentId)).toBe(0);
    expect(engine.activeAgentCount()).toBe(0);
  });

  it('updates load only for reservations that actually started', () => {
    const engine = engineWith(makeProfiles());
    const assignment = engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    const agentId = assignment.agentId ?? 'unknown';
    expect(assignment.agentId).not.toBeNull();
    expect(engine.markStarted('m1:t1')).toBe(true);
    expect(engine.getAgentLoad(agentId)).toBe(0.1);

    expect(engine.release('m1:t1', true)).toBe(true);
    expect(engine.getAgentLoad(agentId)).toBe(0);
    expect(engine.activeAgentCount()).toBe(0);
  });

  it('counts two reservations to the same agent as one distinct agent', () => {
    const profiles: AgentProfile[] = [
      {
        id: 'solo',
        role: 'fixer',
        capabilities: ['implement'],
        authority: 'write',
      },
    ];
    // With `maxConcurrent: 1` a second task can only go to an *already
    // reserved* agent; a new distinct agent would exceed the budget.
    const engine = engineWith(profiles, { maxConcurrent: 1 });
    engine.registerAgent(profiles[0]);
    const first = engine.reserve({
      reservationKey: 'm1:t1',
      taskId: 't1',
      requiredSkills: ['implement'],
      mutating: true,
    });
    // `markStarted` is not required for the distinct-agent count; the
    // reservation itself is enough.
    const second = engine.reserve({
      reservationKey: 'm1:t2',
      taskId: 't2',
      requiredSkills: ['implement'],
      mutating: true,
    });
    expect(first.agentId).toBe('solo');
    expect(second.agentId).toBeNull();
    expect(second.reason).toContain('Concurrency budget exhausted');
    expect(engine.activeAgentCount()).toBe(1);
    expect(engine.activeTaskCount()).toBe(1);
  });
});
