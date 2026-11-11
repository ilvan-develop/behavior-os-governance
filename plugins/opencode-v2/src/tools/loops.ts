/**
 * Control-loop tools: autonomous task orchestration with durable state.
 *
 * Extracted from `setup()`. The four tools all guard on the shared
 * `loopManager` (built in setup from the same BehaviorOS instance, so loop
 * missions show up in `bos_list_missions` automatically) and surface each
 * run via `LoopManager.summarise`.
 */
import { LoopManager, type LoopTaskInput } from '../loop-manager.js';
import type { ToolRegistrarContext } from './tool-surface.js';

export interface LoopContext extends ToolRegistrarContext {
  loopManager: LoopManager | null;
}

export function registerLoopTools(ctx: LoopContext): void {
  const { bos, addTool, loopManager } = ctx;

  // Tools 38-41: ControlLoop — autonomous task orchestration with durable state.
  addTool({
    name: 'bos_start_loop',
    description:
      'Start an autonomous control loop: create a mission, dispatch tasks through the shell adapter with retries and circuit breakers, validate acceptance checks, and persist state so a blocked or crashed run can be resumed. Runs to completion (or until blocked) before returning.',
    input: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              objective: { type: 'string' },
              adapter: { type: 'string' },
              agentId: { type: 'string' },
              acceptance: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    gate: { type: 'string' },
                    description: { type: 'string' },
                    type: {
                      type: 'string',
                      enum: [
                        'exit-code',
                        'stdout-contains',
                        'stdout-matches',
                        'stderr-not-contains',
                      ],
                    },
                    expected: { type: 'string' },
                    required: { type: 'boolean' },
                  },
                  required: ['gate', 'description', 'type'],
                },
              },
              type: { type: 'string' },
              phase: { type: 'string' },
              dependsOn: { type: 'array', items: { type: 'string' } },
              input: { type: 'object', additionalProperties: true },
              timeoutMs: { type: 'number' },
              maxAttempts: { type: 'number' },
              requiredSkills: {
                type: 'array',
                items: { type: 'string' },
                description: 'Skills the task requires; empty means no constraint',
              },
              mutating: {
                type: 'boolean',
                description: 'Fail-closed hint. An adapter that mutates state is still gated.',
              },
            },
            required: ['id', 'objective', 'adapter', 'agentId', 'acceptance'],
            additionalProperties: false,
          },
        },
        authorizedPhases: { type: 'array', items: { type: 'string' } },
        missionType: {
          type: 'string',
          enum: ['feature', 'bugfix', 'deployment', 'research', 'refactor', 'audit', 'incident'],
        },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      },
      required: ['title', 'tasks'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      if (!loopManager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const params = input as {
        title: string;
        tasks: LoopTaskInput[];
        authorizedPhases?: string[];
        missionType?:
          | 'feature'
          | 'bugfix'
          | 'deployment'
          | 'research'
          | 'refactor'
          | 'audit'
          | 'incident';
        priority?: 'critical' | 'high' | 'medium' | 'low';
      };
      const manager = loopManager;
      if (!manager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const result = await manager.start({
        title: params.title,
        tasks: params.tasks,
        ...(params.authorizedPhases ? { authorizedPhases: params.authorizedPhases } : {}),
        ...(params.missionType ? { missionType: params.missionType } : {}),
        ...(params.priority ? { priority: params.priority } : {}),
        dna: bos.getDNA(),
      });
      return {
        content: JSON.stringify(
          {
            ok: true,
            statePath: result.statePath,
            planPath: result.planPath,
            ...LoopManager.summarise(result.runId, result.state),
          },
          null,
          2,
        ),
      };
    },
  });

  addTool({
    name: 'bos_resume_loop',
    description:
      'Resume a control loop from its persisted plan and state: rebuild the orchestrator, register the run agents, and continue dispatch. Idempotent — a loop already in a terminal state is returned unchanged.',
    input: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
    execute: async (input: unknown): Promise<{ content: string }> => {
      if (!loopManager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const params = input as { runId: string };
      const manager = loopManager;
      if (!manager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const result = await manager.resume(params.runId, bos.getDNA());
      if (!result)
        return {
          content: JSON.stringify({
            error: `Loop "${params.runId}" not found`,
            runId: params.runId,
          }),
        };
      return {
        content: JSON.stringify(
          {
            ok: true,
            statePath: result.statePath,
            planPath: result.planPath,
            ...LoopManager.summarise(result.runId, result.state),
          },
          null,
          2,
        ),
      };
    },
  });

  addTool({
    name: 'bos_loop_status',
    description:
      'Return the current state of a control loop (runId). Poll this to watch progress; call bos_resume_loop after a crash to re-hydrate.',
    input: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
    execute: async (input: unknown): Promise<{ content: string }> => {
      if (!loopManager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const params = input as { runId: string };
      const manager = loopManager;
      if (!manager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const result = manager.status(params.runId);
      if (!result.exists || !result.state)
        return {
          content: JSON.stringify({ ok: true, runId: result.runId, exists: false }, null, 2),
        };
      return {
        content: JSON.stringify(
          { ok: true, exists: true, ...LoopManager.summarise(result.runId, result.state) },
          null,
          2,
        ),
      };
    },
  });

  addTool({
    name: 'bos_approve_loop',
    description:
      'Record an approval or denial for a control loop that is blocked pending human approval. A pending mission-level approval is required; the run may still stop again at a subsequent gate. Returns the resulting state after resuming.',
    input: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        decision: { type: 'string', enum: ['approve', 'deny'] },
        reason: { type: 'string' },
      },
      required: ['runId', 'decision'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      if (!loopManager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      const params = input as { runId: string; decision: 'approve' | 'deny'; reason?: string };
      const manager = loopManager;
      if (!manager)
        return { content: JSON.stringify({ error: 'loop manager not initialized' }, null, 2) };
      try {
        const result = await manager.approve(params.runId, params.decision, params.reason);
        return {
          content: JSON.stringify(
            {
              ok: true,
              statePath: result.statePath,
              planPath: result.planPath,
              ...LoopManager.summarise(result.runId, result.state),
            },
            null,
            2,
          ),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
      }
    },
  });
}
