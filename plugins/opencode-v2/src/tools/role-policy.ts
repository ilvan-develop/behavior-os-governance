/**
 * Role/policy registry domain: register roles, define policies, evaluate a
 * role's action, report per-role decisions and list registered roles.
 *
 * The permission hook ENFORCES these policies on every mutating,
 * non-control-plane action, so defining them from inside the governed
 * session closes the enforcement loop.
 */
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerRolePolicyTools(ctx: ToolRegistrarContext): void {
  const { bos, addTool } = ctx;

  addTool({
    name: 'bos_register_role',
    description: 'Register a role with attached policy-rule ids for role-based governance',
    input: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Role id (how actors resolve to this role)' },
        name: { type: 'string' },
        displayName: { type: 'string' },
        responsibilities: { type: 'array', items: { type: 'string' } },
        policies: { type: 'array', items: { type: 'string' } },
        canAudit: { type: 'boolean' },
        canEnforce: { type: 'boolean' },
        canTeach: { type: 'boolean' },
      },
      required: ['id', 'name', 'displayName', 'responsibilities'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        id: string;
        name: string;
        displayName: string;
        responsibilities: string[];
        policies?: string[];
        canAudit?: boolean;
        canEnforce?: boolean;
        canTeach?: boolean;
      };
      const result = bos.registerRole({
        id: params.id,
        name: params.name,
        displayName: params.displayName,
        responsibilities: params.responsibilities,
        policies: params.policies,
        canAudit: params.canAudit ?? false,
        canEnforce: params.canEnforce ?? false,
        canTeach: params.canTeach ?? false,
      });
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  addTool({
    name: 'bos_define_policy',
    description:
      'Define a policy rule (condition/action/severity/applies-to) used by registered roles',
    input: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        condition: {
          type: 'string',
          description:
            "Action matcher: '*' for any action, or an action prefix (e.g. 'deploy', 'git push')",
        },
        action: { type: 'string', enum: ['require', 'warn', 'block', 'auto-fix'] },
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
        appliesTo: {
          type: 'array',
          items: { type: 'string', enum: ['persona', 'role', 'agent', 'project'] },
        },
        effectiveFrom: {
          type: 'string',
          description: 'ISO date from which the rule is effective',
        },
        effectiveUntil: { type: 'string', description: 'Optional ISO expiry date' },
      },
      required: [
        'id',
        'name',
        'description',
        'condition',
        'action',
        'severity',
        'appliesTo',
        'effectiveFrom',
      ],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        id: string;
        name: string;
        description: string;
        condition: string;
        action: 'require' | 'warn' | 'block' | 'auto-fix';
        severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
        appliesTo: Array<'persona' | 'role' | 'agent' | 'project'>;
        effectiveFrom: string;
        effectiveUntil?: string;
      };
      const result = bos.defineRolePolicy({
        id: params.id,
        name: params.name,
        description: params.description,
        condition: params.condition,
        action: params.action,
        severity: params.severity,
        appliesTo: params.appliesTo,
        effectiveFrom: params.effectiveFrom,
        ...(params.effectiveUntil ? { effectiveUntil: params.effectiveUntil } : {}),
      });
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  addTool({
    name: 'bos_evaluate_role_action',
    description:
      'Evaluate an action against the role/policy registry — returns the deterministic decision',
    input: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Actor role id or persona' },
        agentId: { type: 'string', description: 'Actor agent id' },
        action: { type: 'string', description: 'The action about to be performed' },
      },
      required: ['action'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { role?: string; agentId?: string; action: string };
      const decision = bos.evaluateRoleAction(
        { role: params.role, agentId: params.agentId },
        params.action,
      );
      return { content: JSON.stringify(decision, null, 2) };
    },
  });

  addTool({
    name: 'bos_role_policy_report',
    description:
      'Per-role audit report: decision counts by action and by role, plus the last decision',
    input: { type: 'object', properties: {} },
    execute: async (): Promise<{ content: string }> => {
      const report = bos.getRolePolicyEngine().getReport();
      return { content: JSON.stringify(report, null, 2) };
    },
  });

  addTool({
    name: 'bos_list_roles',
    description: 'List registered roles and policy rules of the role/policy engine',
    input: { type: 'object', properties: {} },
    execute: async (): Promise<{ content: string }> => {
      const engine = bos.getRolePolicyEngine();
      const result = { roles: engine.listRoles(), policies: engine.listPolicies() };
      return { content: JSON.stringify(result, null, 2) };
    },
  });
}
