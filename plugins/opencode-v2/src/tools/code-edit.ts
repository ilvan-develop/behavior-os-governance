/**
 * Governed code-editing domain: preview/apply an edit and list the versioned
 * history. Extracted from `setup()`.
 */
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerCodeEditTools(ctx: ToolRegistrarContext): void {
  const { bos, addTool } = ctx;

  // Tool 28: bos_code_edit — governed preview/apply of a code edit
  addTool({
    name: 'bos_code_edit',
    description:
      'Preview (dry-run) or apply a governed edit to a workspace file. Writes only when code editing is enabled and apply:true; optional votes gate the change.',
    input: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        apply: { type: 'boolean' },
        expectedBeforeHash: { type: 'string' },
        missionId: { type: 'string' },
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
        applyVotes: {
          type: 'array',
          description: 'Deprecated alias of `votes`; prefer `votes`',
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
      },
      required: ['file', 'find', 'replace'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        file: string;
        find: string;
        replace: string;
        apply?: boolean;
        expectedBeforeHash?: string;
        missionId?: string;
        votes?: Array<{ voterId: string; choice: string; weight?: number; reason?: string }>;
        applyVotes?: Array<{
          voterId: string;
          choice: string;
          weight?: number;
          reason?: string;
        }>;
        policy?: string;
      };
      if (params.votes && params.applyVotes) {
        return {
          content: JSON.stringify({
            error:
              'bos_code_edit received both `votes` and the deprecated `applyVotes`; send only one.',
          }),
        };
      }
      const votes = params.votes ?? params.applyVotes;
      const result = bos.applyCodeEdit({
        file: params.file,
        find: params.find,
        replace: params.replace,
        apply: params.apply,
        expectedBeforeHash: params.expectedBeforeHash,
        missionId: params.missionId,
        votes: votes?.map((v) => ({
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

  // Tool 29: bos_list_code_edits — the versioned history of code edits
  addTool({
    name: 'bos_list_code_edits',
    description:
      'List persisted code-edit records, dry-runs and refusals included (CodeEditResult records)',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const records = bos.listCodeEdits(params.limit);
      return { content: JSON.stringify(records, null, 2) };
    },
  });
}
