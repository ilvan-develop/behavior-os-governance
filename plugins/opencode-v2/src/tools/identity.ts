/**
 * Session-identity tools: pick the governed agent for this session
 * (`bos_set_agent`) and report who the engine currently resolves
 * (`bos_whoami`).
 */
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerIdentityTools(ctx: ToolRegistrarContext): void {
  const { bos, addTool, recordLog, persistState } = ctx;

  // Tool 26: bos_set_agent — pick the governed agent identity for the session
  addTool({
    name: 'bos_set_agent',
    description:
      'Set the governed agent identity for this session: a registered agent id (optionally registering it via `name`/`type`) or a persona role from the active DNA',
    input: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
        persona: { type: 'string' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        id?: string;
        name?: string;
        type?: string;
        capabilities?: string[];
        persona?: string;
      };
      const identity = bos.setActiveAgent(params);
      if (!identity) {
        const personas = bos.getDNA()?.personas.map((p) => p.role) ?? [];
        return {
          content: `No agent or persona matched. Available personas: ${
            personas.length
              ? personas.join(', ')
              : '(none — select a DNA first with bos_select_dna)'
          }`,
        };
      }
      await persistState();
      recordLog(
        'tool',
        'info',
        'bos_set_agent',
        `Active agent: ${identity.agentId} (${identity.source})`,
      );
      return { content: JSON.stringify(identity, null, 2) };
    },
  });

  // Tool 27: bos_whoami — report the resolved governed identity
  addTool({
    name: 'bos_whoami',
    description:
      'Resolve the governed agent identity acting in this session (agent id, DNA pattern, persona, source)',
    input: { type: 'object', properties: {} },
    execute: async (): Promise<{ content: string }> => {
      const identity = bos.resolveAgentIdentity();
      const payload = {
        ...identity,
        personas: bos.getDNA()?.personas.map((p) => p.role) ?? [],
        registeredAgents: bos.listAgents().map((a) => ({ id: a.id, name: a.name, type: a.type })),
      };
      return { content: JSON.stringify(payload, null, 2) };
    },
  });
}
