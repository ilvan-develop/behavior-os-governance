/**
 * DNA + governance verdicts domain: select/list DNA, evaluate governance,
 * preflight a veto, and the voting/evolution/drift decision tools.
 *
 * Extracted from `setup()`. `bos_evaluate_governance` builds its condition
 * bag exactly the way the permission hook does (see `buildGovernanceContext`),
 * so a self-check answers with the verdict the enforcer would apply.
 */
import { buildGovernanceContext } from '../governance.js';
import { describeProtocolProgress } from '../index.js';
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerDnaGovernanceTools(ctx: ToolRegistrarContext): void {
  const { bos, dnas, addTool, recordLog, persistState } = ctx;

  // Tool 1: bos_evaluate_governance
  addTool({
    name: 'bos_evaluate_governance',
    description: 'Evaluate governance rules for an action',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        agent: { type: 'string' },
        scope: { type: 'string', description: 'Scope of the action' },
        tool: { type: 'string' },
        resources: { type: 'array', items: { type: 'string' } },
        text: { type: 'string' },
        context: { type: 'object' },
      },
      required: ['action', 'agent'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        action: string;
        agent: string;
        scope?: string;
        tool?: string;
        resources?: string[];
        text?: string;
        context?: Record<string, unknown>;
      };
      // Build the condition bag the same way the permission hook does, so an
      // agent that self-checks with this tool gets the *same* verdict the
      // enforcer would apply. Explicit keys can still be supplied via
      // `context`, but they no longer bypass the heuristic signals.
      const context = buildGovernanceContext({
        tool: params.tool ?? params.action,
        action: params.action,
        resources: params.resources,
        text: params.text,
        metadata: params.context,
      });
      const result = bos.evaluateGovernance(params.action, {
        agent: params.agent,
        scope: params.scope,
        context,
      });
      return {
        content: JSON.stringify(result, null, 2),
      };
    },
  });

  // Tool 2: bos_select_dna
  addTool({
    name: 'bos_select_dna',
    description: 'Select a DNA pattern for governance',
    input: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          enum: Array.from(dnas.keys()),
        },
      },
      required: ['pattern'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { pattern: string };
      const dna = dnas.get(params.pattern);
      if (!dna) {
        return {
          content: `Pattern "${params.pattern}" not found. Available: ${Array.from(dnas.keys()).join(', ')}`,
        };
      }
      await bos.loadDNA(dna);
      await persistState();
      recordLog(
        'dna_selected',
        'info',
        'bos_select_dna',
        `Selected DNA pattern "${params.pattern}"`,
      );
      return {
        content: `DNA pattern "${params.pattern}" selected. Governance rules activated.`,
      };
    },
  });

  // Tool 3: bos_list_dna
  addTool({
    name: 'bos_list_dna',
    description: 'List all available DNA patterns',
    input: { type: 'object', properties: {} },
    execute: async (): Promise<{ content: string }> => {
      const patterns = Array.from(dnas.entries()).map(([key, dna]) => ({
        id: key,
        name: dna.name,
        version: dna.version,
        description: dna.description,
        governanceRules: dna.governance.length,
        personas: dna.personas.length,
        qualityGates: dna.quality.length,
      }));
      bos.advanceProtocolStep('bos_list_dna');
      await persistState();
      const progress = describeProtocolProgress(bos.getState().currentStep).toLowerCase();
      recordLog(
        'protocol',
        'info',
        'bos_list_dna',
        `Listed ${patterns.length} patterns (${progress})`,
      );
      return {
        content: JSON.stringify({ patterns, total: patterns.length }, null, 2),
      };
    },
  });

  // Tool 15: bos_preflight — synchronous pre-execution veto
  addTool({
    name: 'bos_preflight',
    description: 'Synchronously check whether an action may proceed (runs pre gates only)',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        agent: { type: 'string', description: 'Agent ID (plugin canonical name)' },
        agentId: { type: 'string', description: 'Alias of `agent`, used by the MCP host' },
        context: { type: 'object' },
      },
      required: ['action'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        action: string;
        agent?: string;
        agentId?: string;
        context?: Record<string, unknown>;
      };
      const agent = params.agent ?? params.agentId ?? bos.resolveAgentIdentity().agentId;
      const result = bos.preflightAction(params.action, {
        agent,
        context: params.context,
      });
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  // Tool 16: bos_decide — weighted voting/quorum resolution
  addTool({
    name: 'bos_decide',
    description: 'Resolve a subject by weighted vote (majority/supermajority/unanimous + quorum)',
    input: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        votes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voterId: { type: 'string' },
              choice: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
              weight: { type: 'number' },
              reason: { type: 'string' },
            },
            required: ['voterId', 'choice'],
          },
        },
        policy: { type: 'string', enum: ['majority', 'supermajority', 'unanimous'] },
        quorum: { type: 'number' },
        missionId: { type: 'string' },
      },
      required: ['subject', 'votes'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        subject: string;
        votes: Array<{ voterId: string; choice: string; weight?: number; reason?: string }>;
        policy?: string;
        quorum?: number;
        missionId?: string;
      };
      const decision = bos.decide({
        subject: params.subject,
        votes: params.votes.map((v) => ({
          voterId: v.voterId,
          choice: v.choice as 'approve' | 'reject' | 'abstain',
          weight: v.weight,
          reason: v.reason,
        })),
        policy: params.policy as 'majority' | 'supermajority' | 'unanimous',
        quorum: params.quorum,
        missionId: params.missionId,
      });
      return { content: JSON.stringify(decision, null, 2) };
    },
  });

  // Tool 17: bos_evolution — propose (and optionally apply) DNA evolution
  addTool({
    name: 'bos_evolution',
    description: 'Propose (and optionally apply) learning-driven DNA changes, scored by confidence',
    input: {
      type: 'object',
      properties: {
        minConfidence: { type: 'number' },
        apply: { type: 'boolean' },
        votes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voterId: { type: 'string' },
              choice: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
              weight: { type: 'number' },
              reason: { type: 'string' },
            },
            required: ['voterId', 'choice'],
          },
        },
        policy: { type: 'string', enum: ['majority', 'supermajority', 'unanimous'] },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        minConfidence?: number;
        apply?: boolean;
        votes?: Array<{ voterId: string; choice: string; weight?: number; reason?: string }>;
        policy?: string;
      };
      const result = bos.applyEvolution({
        minConfidence: params.minConfidence,
        apply: params.apply,
        votes: params.votes?.map((v) => ({
          voterId: v.voterId,
          choice: v.choice as 'approve' | 'reject' | 'abstain',
          weight: v.weight,
          reason: v.reason,
        })),
        policy: params.policy as 'majority' | 'supermajority' | 'unanimous',
      });
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  // Tool 25: bos_drift — compare two DNA patterns by name
  addTool({
    name: 'bos_drift',
    description: 'Compare two DNA patterns (by name) and report behavioral drift',
    input: {
      type: 'object',
      properties: {
        dnaA: { type: 'string' },
        dnaB: { type: 'string' },
      },
      required: ['dnaA', 'dnaB'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { dnaA: string; dnaB: string };
      const a = dnas.get(params.dnaA);
      const b = dnas.get(params.dnaB);
      if (!a || !b) {
        const missing = [!a ? params.dnaA : null, !b ? params.dnaB : null]
          .filter(Boolean)
          .join('", "');
        return {
          content: `DNA pattern(s) not found: "${missing}". Available: ${Array.from(dnas.keys())
            .sort()
            .join(', ')}`,
        };
      }
      const drift = bos.compareDNADrift(a, b);
      return { content: JSON.stringify(drift, null, 2) };
    },
  });
}
