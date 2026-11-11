/**
 * Code-fixes + recommendations domain: propose/apply/list persisted code
 * fixes, list voting decisions / pipeline runs / audit reports, and the
 * scored recommendation feed.
 */
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerCodeFixTools(ctx: ToolRegistrarContext): void {
  const { bos, addTool } = ctx;

  // Tool 18: bos_code_fixes — propose code fixes from repeated fix events
  addTool({
    name: 'bos_code_fixes',
    description: 'Propose code fixes derived from repeated fix events, scored by confidence',
    input: {
      type: 'object',
      properties: {
        minConfidence: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { minConfidence?: number };
      const proposals = bos.proposeCodeFixes(params.minConfidence);
      return { content: JSON.stringify(proposals, null, 2) };
    },
  });

  // Tool 19: bos_apply_code_fixes — persist code-fix results with governance
  addTool({
    name: 'bos_apply_code_fixes',
    description:
      'Persist code-fix proposals (requires evolution.enabled + apply:true; optional votes gate)',
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
      const result = bos.applyCodeFixes({
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

  // Tool 20: bos_list_code_fixes — list persisted code-fix results
  addTool({
    name: 'bos_list_code_fixes',
    description: 'List persisted code-fix application results (CodeFixResult records)',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const results = bos.listCodeFixResults(params.limit);
      return { content: JSON.stringify(results, null, 2) };
    },
  });

  // Tool 21: bos_list_decisions — list persisted voting/quorum decisions
  addTool({
    name: 'bos_list_decisions',
    description: 'List persisted voting/quorum decisions (requires persistence)',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const decisions = bos.listDecisions(params.limit);
      return { content: JSON.stringify(decisions, null, 2) };
    },
  });

  // Tool 22: bos_list_pipeline_runs — list persisted gate-pipeline runs
  addTool({
    name: 'bos_list_pipeline_runs',
    description: 'List persisted gate-pipeline runs / blocked pre-flights (requires persistence)',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const runs = bos.listPipelineRuns(params.limit);
      return { content: JSON.stringify(runs, null, 2) };
    },
  });

  // Tool 23: bos_list_audit_reports — list persisted audit reports
  addTool({
    name: 'bos_list_audit_reports',
    description: 'List persisted audit reports (requires persistence)',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const reports = bos.listAuditReports(params.limit);
      return { content: JSON.stringify(reports, null, 2) };
    },
  });

  // Tool 24: bos_recommendations — scored recommendations
  addTool({
    name: 'bos_recommendations',
    description: 'Scored recommendations derived from recent learning events',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        ageLimitHours: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number; ageLimitHours?: number };
      const recs = bos.recommend(params.limit, params.ageLimitHours);
      return { content: JSON.stringify(recs, null, 2) };
    },
  });
}
