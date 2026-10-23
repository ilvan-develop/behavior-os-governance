import type { PolicyRule, Role } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { RolePolicyEngine } from '../src/engine/role-policy-engine.js';

const developer: Role = {
  id: 'developer',
  name: 'Developer',
  displayName: 'Developer',
  responsibilities: ['implement features'],
  policies: ['no-direct-deploy', 'review-before-push'],
  canAudit: false,
  canEnforce: false,
  canTeach: true,
};

const noDirectDeploy: PolicyRule = {
  id: 'no-direct-deploy',
  name: 'No direct deploy',
  description: 'Developers cannot deploy to production',
  condition: 'deploy',
  action: 'block',
  severity: 'high',
  appliesTo: ['role'],
  effectiveFrom: '2026-01-01T00:00:00.000Z',
};

const reviewBeforePush: PolicyRule = {
  id: 'review-before-push',
  name: 'Review before push',
  description: 'Pushing requires review',
  condition: 'git push',
  action: 'require',
  severity: 'medium',
  appliesTo: ['role'],
  effectiveFrom: '2026-01-01T00:00:00.000Z',
};

describe('RolePolicyEngine', () => {
  it('registers and lists roles', () => {
    const engine = new RolePolicyEngine();
    expect(engine.registerRole(developer).success).toBe(true);
    expect(engine.registerRole({ ...developer, id: 'reviewer' }).success).toBe(true);
    expect(engine.listRoles()).toHaveLength(2);
    expect(engine.getRole('developer')).toBeDefined();
  });

  it('rejects invalid role and policy registrations', () => {
    const engine = new RolePolicyEngine();
    expect(engine.registerRole({ ...developer, id: '' }).success).toBe(false);
    expect(
      engine.definePolicy({
        ...noDirectDeploy,
        id: '',
      }).success,
    ).toBe(false);
    expect(
      engine.definePolicy({
        ...noDirectDeploy,
        condition: '   ',
      }).success,
    ).toBe(false);
  });

  it('blocks a policy match for the strictest rule (block wins)', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(noDirectDeploy);
    engine.definePolicy(reviewBeforePush);
    engine.registerRole(developer);

    const decision = engine.evaluate({ role: 'developer' }, 'deploy production');
    expect(decision.action).toBe('block');
    expect(decision.matchedPolicy?.id).toBe('no-direct-deploy');
    expect(decision.severity).toBe('high');
    expect(decision.reason).toContain('no-direct-deploy');
  });

  it('resolves the actor via persona fallback', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(reviewBeforePush);
    engine.registerRole(developer);

    const decision = engine.evaluate({ persona: 'developer' }, 'git push origin main');
    expect(decision.action).toBe('require');
    expect(decision.matchedPolicy?.id).toBe('review-before-push');
    expect(decision.role?.id).toBe('developer');
  });

  it('escalates fail-safe for an unknown but named role', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(noDirectDeploy);

    const decision = engine.evaluate({ role: 'intern-nobody' }, 'deploy production');
    expect(decision.action).toBe('require');
    expect(decision.matchedPolicy).toBeNull();
    expect(decision.reason).toContain('fail-safe');
  });

  it('allows when no role context exists, and still records the audit entry', () => {
    const engine = new RolePolicyEngine();
    const decision = engine.evaluate({}, 'write docs');
    expect(decision.action).toBe('allow');
    expect(decision.reason).toContain('No role context');
    expect(engine.getAuditTrail()).toHaveLength(1);
  });

  it('matches the wildcard condition', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy({
      ...noDirectDeploy,
      id: 'wildcard',
      condition: '*',
      action: 'warn',
      severity: 'low',
    });
    engine.registerRole({ ...developer, policies: ['wildcard'] });

    const decision = engine.evaluate({ role: 'developer' }, 'anything goes');
    expect(decision.action).toBe('warn');
    expect(decision.matchedPolicy?.id).toBe('wildcard');
  });

  it('honours the effective-until window (expired policy no longer matches)', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy({
      ...noDirectDeploy,
      effectiveUntil: '2026-01-02T00:00:00.000Z',
    });
    engine.registerRole(developer);

    // Today is well past 2026-01-02; the expired policy must not fire.
    const decision = engine.evaluate({ role: 'developer' }, 'deploy production');
    expect(decision.action).toBe('allow');
    expect(decision.matchedPolicy).toBeNull();
  });

  it('ignores dangling policy references instead of throwing', () => {
    const engine = new RolePolicyEngine();
    engine.registerRole({ ...developer, policies: ['ghost-policy'] });

    const decision = engine.evaluate({ role: 'developer' }, 'deploy');
    expect(decision.action).toBe('allow');
  });

  it('requires an action argument', () => {
    const engine = new RolePolicyEngine();
    expect(() => engine.evaluate({ role: 'developer' }, '   ')).toThrow();
  });

  it('builds a report from the audit trail and bounds it', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(noDirectDeploy);
    engine.registerRole(developer);

    engine.evaluate({ role: 'developer' }, 'deploy production');
    engine.evaluate({}, 'write docs');
    engine.evaluate({ role: 'intern-nobody' }, 'deploy production');

    const report = engine.getReport();
    expect(report.roles).toBe(1);
    expect(report.policies).toBe(1);
    expect(report.decisions).toBe(3);
    expect(report.byAction.block).toBe(1);
    expect(report.byAction.require).toBe(1);
    expect(report.byAction.allow).toBe(1);
    expect(report.byRole.developer).toBe(1);
    expect(report.byRole.unregistered).toBe(2);
    expect(report.lastDecision?.action).toBe('require');
  });

  it('keeps the audit trail bounded to 200 entries', () => {
    const engine = new RolePolicyEngine();
    engine.registerRole(developer);
    for (let i = 0; i < 250; i++) {
      engine.evaluate({}, `action-${i}`);
    }
    const trail = engine.getAuditTrail();
    expect(trail).toHaveLength(200);
    expect(trail[0]?.reason).toContain('action-50');
    expect(trail[199]?.reason).toContain('action-249');
  });

  it('exports a plain-JSON snapshot and restores it losslessly', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(noDirectDeploy);
    engine.definePolicy(reviewBeforePush);
    engine.registerRole(developer);
    engine.evaluate({ role: 'developer' }, 'deploy production');

    const snapshot = engine.snapshot();
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();

    const restored = new RolePolicyEngine();
    const result = restored.restore(JSON.parse(JSON.stringify(snapshot)));
    expect(result).toEqual({ roles: 1, policies: 2, decisions: 1 });

    // Restored registry drives decisions exactly like the original.
    const decision = restored.evaluate({ role: 'developer' }, 'deploy production');
    expect(decision.action).toBe('block');
    expect(decision.matchedPolicy?.id).toBe('no-direct-deploy');
    expect(restored.getAuditTrail()).toHaveLength(2);
  });

  it('rejects invalid snapshots and leaves state untouched', () => {
    const engine = new RolePolicyEngine();
    engine.registerRole(developer);
    engine.definePolicy(noDirectDeploy);

    expect(engine.restore(null)).toBeNull();
    expect(engine.restore('no')).toBeNull();
    expect(engine.restore({ roles: {}, policies: [], trail: [] })).toBeNull();
    expect(
      engine.restore({ roles: [{ ...developer, id: '' }], policies: [], trail: [] }),
    ).toBeNull();
    expect(
      engine.restore({
        roles: [developer],
        policies: [{ ...noDirectDeploy, condition: '' }],
        trail: [],
      }),
    ).toBeNull();
    expect(
      engine.restore({
        roles: [developer],
        policies: [],
        trail: [
          {
            action: 'allow',
            matchedPolicy: null,
            role: null,
            reason: 1 as unknown as string, // non-string reason makes it invalid
            severity: 'info',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBeNull();

    // Nothing was mutated by the rejected attempts.
    expect(engine.snapshot()).toEqual({
      roles: [developer],
      policies: [noDirectDeploy],
      trail: [],
    });
  });

  it('re-evaluates the effective window after a restore', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy({ ...noDirectDeploy, effectiveUntil: '2099-01-01T00:00:00.000Z' });
    engine.registerRole(developer);

    const restored = new RolePolicyEngine();
    restored.restore(JSON.parse(JSON.stringify(engine.snapshot())));
    // Policy is still in its window at snapshot time, so restoring keeps it
    // armed; an expired window would be ignored at evaluate time instead.
    expect(restored.evaluate({ role: 'developer' }, 'deploy').action).toBe('block');
  });

  it('picks the strictest non-block policy when several match', () => {
    const engine = new RolePolicyEngine();
    engine.definePolicy(reviewBeforePush); // require
    engine.definePolicy({
      ...noDirectDeploy,
      id: 'deploy-warn',
      action: 'warn',
      severity: 'low',
    });
    engine.registerRole({ ...developer, policies: ['review-before-push', 'deploy-warn'] });

    const decision = engine.evaluate({ role: 'developer' }, 'deploy');
    // 'deploy' matches deploy-warn only (require rule needs 'git push' prefix).
    expect(decision.action).toBe('warn');

    const push = engine.evaluate({ role: 'developer' }, 'git push origin main');
    // Both rules' prefixes: 'git push' matches review; 'deploy' does not.
    expect(push.action).toBe('require');
  });
});
