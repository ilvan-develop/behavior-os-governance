import type { PolicyRule, Role, Severity } from '@behavior-os/schemas';

/**
 * RolePolicyEngine — role/policy-based governance enforcement and auditing.
 *
 * The engine answers one question deterministically: **for a given actor and
 * action, what does the registered role/policy set demand?** It is a policy
 * *resolution and attribution* layer on top of (not a replacement for) the DNA
 * governance engine, which decides DNA-authored rules.
 *
 * Matching contract (deliberately minimal and testable):
 * - An actor resolves to a role by explicit `role`, then `persona`, then
 *   `agentId` — first fit wins.
 * - A role's policies are looked up by id in the shared policy registry.
 * - A policy matches an action when its `condition` is `'*'`, or when the
 *   action equals or starts with the condition (prefix match, e.g. `git`).
 * - Effective time window: `effectiveUntil` (when set) must be in the future
 *   at evaluation time; otherwise the policy expires (no longer matches).
 * - The strictest matched decision wins: block > require > auto-fix > warn,
 *   with `allow` as the default when nothing matched.
 * - Fail-safe: an actor that *names* a role the registry does not know gets a
 *   `require` decision (escalate, not act), never an unexplained allow.
 * - Every decision is recorded in a bounded audit trail — an attribution rule
 *   without a trail is not governance.
 */

export type RolePolicyAction = 'allow' | 'require' | 'warn' | 'block' | 'auto-fix';

export interface RoleActorContext {
  persona?: string;
  role?: string;
  agentId?: string;
}

export interface RoleDecision {
  action: RolePolicyAction;
  matchedPolicy: PolicyRule | null;
  role: Role | null;
  reason: string;
  severity: Severity;
  timestamp: string;
}

export interface RolePolicyRegistration {
  success: boolean;
  error?: string;
}

/**
 * Plain-JSON state shape for `snapshot()`/`restore()`. It holds roles, policy
 * rules and the bounded audit trail so a role policy engine can be restarted
 * without losing its registry or its attribution history.
 */
export interface RolePolicyState {
  roles: Role[];
  policies: PolicyRule[];
  trail: RoleDecision[];
}

export interface RolePolicyReport {
  roles: number;
  policies: number;
  decisions: number;
  byAction: Record<RolePolicyAction, number>;
  byRole: Record<string, number>;
  lastDecision: RoleDecision | null;
}

const MAX_TRAIL = 200;

const DECISION_ORDER: Record<RolePolicyAction, number> = {
  allow: 0,
  warn: 1,
  'auto-fix': 2,
  require: 3,
  block: 4,
};

export class RolePolicyEngine {
  private roles = new Map<string, Role>();
  private policies = new Map<string, PolicyRule>();
  private trail: RoleDecision[] = [];

  registerRole(role: Role): RolePolicyRegistration {
    if (!role || typeof role.id !== 'string' || role.id.trim() === '') {
      return { success: false, error: 'Role id is required' };
    }
    this.roles.set(role.id, role);
    return { success: true };
  }

  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  listRoles(): Role[] {
    return [...this.roles.values()];
  }

  definePolicy(policy: PolicyRule): RolePolicyRegistration {
    if (!policy || typeof policy.id !== 'string' || policy.id.trim() === '') {
      return { success: false, error: 'Policy id is required' };
    }
    if (typeof policy.condition !== 'string' || policy.condition.trim() === '') {
      return { success: false, error: 'Policy condition is required' };
    }
    this.policies.set(policy.id, policy);
    return { success: true };
  }

  listPolicies(): PolicyRule[] {
    return [...this.policies.values()];
  }

  /**
   * Resolve the actor to a registered role: explicit role id first, then the
   * persona name, then the agent id. Returns null when the actor names a role
   * that is not registered (the caller decides the fail-safe posture).
   */
  private resolveRole(actor: RoleActorContext): Role | null {
    const candidates = [actor.role, actor.persona, actor.agentId];
    for (const candidate of candidates) {
      if (candidate && this.roles.has(candidate)) {
        return this.roles.get(candidate) ?? null;
      }
    }
    return null;
  }

  /** Whether the policy's condition matches the action string. */
  private conditionMatches(policy: PolicyRule, action: string): boolean {
    if (policy.condition === '*') return true;
    return action === policy.condition || action.startsWith(`${policy.condition}`);
  }

  /** Whether the policy is within its effective window (until-date only). */
  private isEffective(policy: PolicyRule): boolean {
    if (!policy.effectiveUntil) return true;
    return new Date(policy.effectiveUntil).getTime() > Date.now();
  }

  evaluate(actor: RoleActorContext, action: string): RoleDecision {
    if (!action || action.trim() === '') {
      throw new Error('RolePolicyEngine.evaluate: action is required');
    }

    const role = this.resolveRole(actor);
    const namedRole = actor.role ?? actor.persona ?? actor.agentId ?? null;

    const decision: RoleDecision = {
      action: 'allow',
      matchedPolicy: null,
      role,
      reason: '',
      severity: 'info',
      timestamp: new Date().toISOString(),
    };

    if (!role && namedRole) {
      decision.action = 'require';
      decision.reason = `Unknown role '${namedRole}' — fail-safe escalation`;
      decision.severity = 'medium';
    } else if (role) {
      let strictest: RoleDecision | null = null;
      for (const policyId of role.policies ?? []) {
        const policy = this.policies.get(policyId);
        if (!policy) continue;
        if (!this.isEffective(policy)) continue;
        if (!this.conditionMatches(policy, action)) continue;
        if (policy.action === 'block') {
          strictest = this.toDecision(policy, role, action);
          break;
        }
        const candidate = this.toDecision(policy, role, action);
        if (!strictest || DECISION_ORDER[candidate.action] > DECISION_ORDER[strictest.action]) {
          strictest = candidate;
        }
      }
      if (strictest) {
        strictest.role = role;
        strictest.timestamp = decision.timestamp;
        this.record(strictest);
        return strictest;
      }
      decision.reason = `No policy matched action '${action}' for role '${role.id}'`;
    } else {
      decision.reason = `No role context — action '${action}' allowed with audit entry`;
    }

    this.record(decision);
    return decision;
  }

  /**
   * Export the full engine state as plain JSON (roles, policies and trail) so
   * a host can persist it into any storage and hand it back via `restore()`.
   */
  snapshot(): RolePolicyState {
    return {
      roles: [...this.roles.values()],
      policies: [...this.policies.values()],
      trail: [...this.trail],
    };
  }

  /**
   * Import a previously snapshotted state, replacing current contents.
   * Fail-safe: an invalid or incompatible snapshot returns null and leaves the
   * engine untouched instead of half-applying garbage.
   */
  restore(state: unknown): { roles: number; policies: number; decisions: number } | null {
    if (!state || typeof state !== 'object') return null;
    const candidate = state as Partial<RolePolicyState>;
    if (
      !Array.isArray(candidate.roles) ||
      !Array.isArray(candidate.policies) ||
      !Array.isArray(candidate.trail)
    ) {
      return null;
    }
    for (const role of candidate.roles) {
      if (!role || typeof role.id !== 'string' || role.id.trim() === '') return null;
    }
    for (const policy of candidate.policies) {
      if (!policy || typeof policy.id !== 'string' || policy.id.trim() === '') return null;
      if (typeof policy.condition !== 'string' || policy.condition.trim() === '') return null;
    }
    for (const decision of candidate.trail) {
      if (
        !decision ||
        typeof decision.timestamp !== 'string' ||
        typeof decision.reason !== 'string'
      ) {
        return null;
      }
    }
    const roles = new Map<string, Role>();
    for (const role of candidate.roles) roles.set(role.id, role);
    const policies = new Map<string, PolicyRule>();
    for (const policy of candidate.policies) policies.set(policy.id, policy);
    const trail = candidate.trail.map((decision) => ({ ...decision }));
    this.roles = roles;
    this.policies = policies;
    this.trail = trail;
    return {
      roles: roles.size,
      policies: policies.size,
      decisions: trail.length,
    };
  }

  private toDecision(policy: PolicyRule, role: Role, action: string): RoleDecision {
    return {
      action: policy.action,
      matchedPolicy: policy,
      role,
      reason: `Policy '${policy.id}' (${policy.action}, ${policy.severity}) matched action '${action}' — ${policy.description}`,
      severity: policy.severity,
      timestamp: new Date().toISOString(),
    };
  }

  private record(decision: RoleDecision): void {
    this.trail.push(decision);
    if (this.trail.length > MAX_TRAIL) this.trail = this.trail.slice(-MAX_TRAIL);
  }

  getAuditTrail(): RoleDecision[] {
    return [...this.trail];
  }

  getReport(): RolePolicyReport {
    const byAction = { allow: 0, require: 0, warn: 0, block: 0, 'auto-fix': 0 };
    const byRole: Record<string, number> = {};
    for (const decision of this.trail) {
      byAction[decision.action]++;
      const key = decision.role ? decision.role.id : 'unregistered';
      byRole[key] = (byRole[key] ?? 0) + 1;
    }
    return {
      roles: this.roles.size,
      policies: this.policies.size,
      decisions: this.trail.length,
      byAction,
      byRole,
      lastDecision: this.trail[this.trail.length - 1] ?? null,
    };
  }
}
