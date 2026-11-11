/**
 * Mission-lifecycle and audit tools: create/start/complete/fail/cancel a
 * mission, list missions, and run the audit pipeline for one.
 *
 * Extracted verbatim from `setup()` — the whole capture -> mutate -> persist
 * -> rollback window of each lifecycle tool runs under the lifecycle lock
 * (see `addLifecycle` in index.ts), so a failing transition can never roll
 * back a concurrent transition's committed mutation.
 */
import type { MissionPriority, MissionStatus, MissionType } from '@behavior-os/schemas';
import type { ToolRegistrarContext } from './tool-surface.js';

export function registerMissionTools(ctx: ToolRegistrarContext): void {
  const {
    bos,
    addTool,
    addLifecycleTool,
    recordLog,
    persistState,
    persistLifecycle,
    locationDirectory,
  } = ctx;

  // Tool 4: bos_create_mission
  addLifecycleTool({
    name: 'bos_create_mission',
    description: 'Create a new mission in Behavior-OS',
    input: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: {
          type: 'string',
          enum: ['feature', 'bugfix', 'deployment', 'research', 'refactor', 'audit', 'incident'],
        },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        requiredChecks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Gates that must each have passing evidence before completion',
        },
      },
      required: ['title', 'type', 'priority'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        title: string;
        type: string;
        priority: string;
        requiredChecks?: string[];
      };
      const before = bos.exportState();
      const mission = bos.createMission({
        title: params.title,
        type: params.type as
          | 'feature'
          | 'bugfix'
          | 'deployment'
          | 'research'
          | 'refactor'
          | 'audit'
          | 'incident',
        priority: params.priority as 'critical' | 'high' | 'medium' | 'low',
        requiredChecks: params.requiredChecks,
      });
      // The prompt hook may have auto-opened a mission for this same
      // request. An explicit mission supersedes it; two live missions for
      // one request is the echo this closes.
      const duplicateWindowMs = 5 * 60 * 1000;
      const duplicates = bos
        .listMissions(50)
        .filter(
          (candidate) =>
            candidate.id !== mission.id &&
            candidate.createdBy === 'behavior-os:auto' &&
            (candidate.status === 'pending' || candidate.status === 'active') &&
            Date.now() - Date.parse(candidate.createdAt) <= duplicateWindowMs,
        );
      for (const duplicate of duplicates) {
        const cancelled = bos.cancelMission(duplicate.id, {
          actor: 'persona:architect',
          reason: `Superseded by explicit mission ${mission.id}`,
        });
        if (cancelled.ok && cancelled.changed) {
          recordLog(
            'mission',
            'info',
            'bos_create_mission',
            `Cancelled duplicate auto mission ${duplicate.id} (superseded by ${mission.id})`,
          );
        }
      }
      const persisted = await persistLifecycle(before);
      if (!persisted.ok) {
        return {
          content: `Mission creation failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
        };
      }
      recordLog('mission', 'info', 'bos_create_mission', `Created mission ${mission.id}`);
      return {
        content: `Mission created: ${mission.id}`,
      };
    },
  });

  // Tool 5: bos_start_mission
  addLifecycleTool({
    name: 'bos_start_mission',
    description: 'Start a mission by ID',
    input: {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        expectedVersion: { type: 'number' },
        actor: { type: 'string' },
      },
      required: ['missionId'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        missionId: string;
        expectedVersion?: number;
        actor?: string;
      };
      const before = bos.exportState();
      const result = bos.transitionMission(params.missionId, 'active', {
        expectedVersion: params.expectedVersion,
        actor: params.actor,
      });
      if (!result.ok) {
        return {
          content: `Mission transition refused [${result.code}]: ${result.message}`,
        };
      }
      if (result.changed) {
        bos.advanceProtocolStep('bos_start_mission');
      }
      // A replay to the current state is already durable: do not turn a
      // storage outage into a false failure for a no-op.
      const persisted = result.changed ? await persistLifecycle(before) : { ok: true };
      if (!persisted.ok) {
        return {
          content: `Mission transition failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
        };
      }
      recordLog('mission', 'info', 'bos_start_mission', `Started mission "${params.missionId}"`);
      return {
        content: `Mission "${params.missionId}" started. Status: ${result.mission.status}`,
      };
    },
  });

  // Tool 5a: bos_complete_mission
  addLifecycleTool({
    name: 'bos_complete_mission',
    description:
      'Complete a mission only when every required check has passing, non-simulated evidence. Refuses invalid transitions, stale versions and missing/failed evidence.',
    input: {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              gate: { type: 'string' },
              status: { type: 'string', enum: ['passed', 'failed', 'skipped'] },
              source: { type: 'string' },
              detail: { type: 'string' },
              simulated: { type: 'boolean' },
              provenance: {
                type: 'string',
                enum: ['executed', 'reported', 'simulated'],
                description: 'How the evidence was produced; executed requires executionId',
              },
              executionId: {
                type: 'string',
                description: 'Unique id of the execution that produced executed evidence',
              },
            },
            required: ['gate', 'status', 'source'],
          },
        },
        expectedVersion: { type: 'number' },
        actor: { type: 'string' },
      },
      required: ['missionId'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        missionId: string;
        evidence?: Array<{
          gate: string;
          status: 'passed' | 'failed' | 'skipped';
          source: string;
          detail?: string;
          simulated?: boolean;
          provenance?: 'executed' | 'reported' | 'simulated';
          executionId?: string;
        }>;
        expectedVersion?: number;
        actor?: string;
      };
      const before = bos.exportState();
      const result = bos.transitionMission(params.missionId, 'completed', {
        evidence: params.evidence,
        expectedVersion: params.expectedVersion,
        actor: params.actor,
      });
      if (!result.ok) {
        recordLog(
          'mission',
          'warn',
          'bos_complete_mission',
          `Refused [${result.code}]: ${result.message}`,
        );
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: result.code,
              message: result.message,
              missionId: params.missionId,
              status: result.mission?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      const persisted = result.changed ? await persistLifecycle(before) : { ok: true };
      if (!persisted.ok) {
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: 'PERSISTENCE_FAILED',
              message: `Completion was not persisted: ${persisted.error ?? 'unknown storage error'}`,
              missionId: params.missionId,
              status: bos.getMission(params.missionId)?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      recordLog(
        'mission',
        'info',
        'bos_complete_mission',
        `Completed mission "${params.missionId}" (basis: ${result.mission.completionBasis})`,
      );
      return {
        content: JSON.stringify(
          {
            ok: true,
            changed: result.changed,
            missionId: params.missionId,
            status: result.mission.status,
            version: result.mission.version ?? 0,
            completionBasis: result.mission.completionBasis ?? null,
            evidenceVerified: result.mission.completionBasis === 'evidence',
          },
          null,
          2,
        ),
      };
    },
  });

  // Tool 5b: bos_fail_mission
  addLifecycleTool({
    name: 'bos_fail_mission',
    description: 'Mark a mission as failed with an explicit reason and audit trail.',
    input: {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        reason: { type: 'string' },
        expectedVersion: { type: 'number' },
        actor: { type: 'string' },
      },
      required: ['missionId'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        missionId: string;
        reason?: string;
        expectedVersion?: number;
        actor?: string;
      };
      const before = bos.exportState();
      const result = bos.transitionMission(params.missionId, 'failed', {
        reason: params.reason,
        expectedVersion: params.expectedVersion,
        actor: params.actor,
      });
      if (!result.ok) {
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: result.code,
              message: result.message,
              missionId: params.missionId,
              status: result.mission?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      const persisted = result.changed ? await persistLifecycle(before) : { ok: true };
      if (!persisted.ok) {
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: 'PERSISTENCE_FAILED',
              message: `Failure was not persisted: ${persisted.error ?? 'unknown storage error'}`,
              missionId: params.missionId,
              status: bos.getMission(params.missionId)?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      recordLog(
        'mission',
        'info',
        'bos_fail_mission',
        `Failed mission "${params.missionId}": ${params.reason ?? 'no reason'}`,
      );
      return {
        content: JSON.stringify(
          {
            ok: true,
            changed: result.changed,
            missionId: params.missionId,
            status: result.mission.status,
            version: result.mission.version ?? 0,
            reason: result.mission.lastTransitionReason ?? null,
          },
          null,
          2,
        ),
      };
    },
  });

  // Tool 5c: bos_cancel_mission
  addLifecycleTool({
    name: 'bos_cancel_mission',
    description: 'Cancel a mission that will not be completed, recording the reason.',
    input: {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        reason: { type: 'string' },
        expectedVersion: { type: 'number' },
        actor: { type: 'string' },
      },
      required: ['missionId'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        missionId: string;
        reason?: string;
        expectedVersion?: number;
        actor?: string;
      };
      const before = bos.exportState();
      const result = bos.transitionMission(params.missionId, 'cancelled', {
        reason: params.reason,
        expectedVersion: params.expectedVersion,
        actor: params.actor,
      });
      if (!result.ok) {
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: result.code,
              message: result.message,
              missionId: params.missionId,
              status: result.mission?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      const persisted = result.changed ? await persistLifecycle(before) : { ok: true };
      if (!persisted.ok) {
        return {
          content: JSON.stringify(
            {
              ok: false,
              code: 'PERSISTENCE_FAILED',
              message: `Cancellation was not persisted: ${persisted.error ?? 'unknown storage error'}`,
              missionId: params.missionId,
              status: bos.getMission(params.missionId)?.status ?? null,
            },
            null,
            2,
          ),
        };
      }
      recordLog(
        'mission',
        'info',
        'bos_cancel_mission',
        `Cancelled mission "${params.missionId}": ${params.reason ?? 'no reason'}`,
      );
      return {
        content: JSON.stringify(
          {
            ok: true,
            changed: result.changed,
            missionId: params.missionId,
            status: result.mission.status,
            version: result.mission.version ?? 0,
            reason: result.mission.lastTransitionReason ?? null,
          },
          null,
          2,
        ),
      };
    },
  });

  // Tool 6: bos_list_missions
  addTool({
    name: 'bos_list_missions',
    description: 'List all missions with optional filters',
    input: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        type: { type: 'string' },
        priority: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        status?: string;
        type?: string;
        priority?: string;
        limit?: number;
      };
      // The facade owns the filter semantics (applied BEFORE the limit) so
      // this tool and its MCP twin cannot drift apart.
      const missions = bos.listMissions(params.limit ?? 50, {
        status: params.status as MissionStatus | undefined,
        type: params.type as MissionType | undefined,
        priority: params.priority as MissionPriority | undefined,
      });
      return {
        content: JSON.stringify(missions, null, 2),
      };
    },
  });

  // Tool 7: bos_run_audit
  addTool({
    name: 'bos_run_audit',
    description:
      'Run audit pipeline for a mission. `agentId` is optional and defaults to the session identity resolved from the active DNA (persona or registered agent) — never the model name.',
    input: {
      type: 'object',
      properties: {
        missionId: { type: 'string' },
        agentId: { type: 'string' },
        stages: { type: 'array', items: { type: 'string' } },
        simulate: {
          type: 'boolean',
          description:
            'true (default) runs a simulated audit and never reports a pass; false executes the real checks',
        },
        performanceBudgetMs: {
          type: 'number',
          description:
            'Wall-clock budget for the performance stage (a real build). Exceeding it reports a warning, never a failure.',
        },
      },
      required: ['missionId'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        missionId: string;
        agentId?: string;
        stages?: string[];
        simulate?: boolean;
        performanceBudgetMs?: number;
      };
      const report = await bos.runAudit({
        missionId: params.missionId,
        agentId: params.agentId,
        stages: params.stages,
        simulate: params.simulate,
        performanceBudgetMs: params.performanceBudgetMs,
        // The host process cwd is not guaranteed to be the project; the
        // plugin knows the workspace, so the real audit stages must run
        // there (otherwise typecheck/security fail with "no script").
        root: locationDirectory,
      });
      await persistState();
      const label = report.simulated
        ? 'SIMULATED audit — no verification executed'
        : 'Audit complete';
      recordLog(
        'tool',
        'info',
        'bos_run_audit',
        `${label}: ${report.overall} by ${report.agentId}`,
      );
      return {
        content: `${label}: ${report.overall} (agent: ${report.agentId}, dna: ${report.dnaPattern ?? 'none'})`,
      };
    },
  });
}
