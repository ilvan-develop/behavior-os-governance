#!/usr/bin/env node
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FairnessInput, PolicyActor, PolicyEnforcement } from '@behavior-os/core';
import { BehaviorOS, PROTOCOL_STEPS, resolveAuditRoot } from '@behavior-os/core';

import type {
  ConsensusVote,
  DecisionPolicy,
  DNA,
  GovernanceDecision,
  LearningImpact,
  LearningType,
  MissionPriority,
  MissionStatus,
  MissionType,
  Vote,
} from '@behavior-os/schemas';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { rateLimitConfigFromEnv, ToolRateLimiter, withRateLimit } from './rate-limit.js';
import { SERVER_VERSION } from './version.js';

/** Module directory: a stable anchor for relative config paths (R19). */
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

// Global behaviorOS instance
let behaviorOS: BehaviorOS | null = null;

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS({
      dnaPath: process.env.BEHAVIOROS_DNA_PATH,
      // Optional SQLite persistence: set BEHAVIOROS_DB_PATH to a file to keep
      // missions/learnings/agents/audit_log and role/policy state across restarts.
      persistence: process.env.BEHAVIOROS_DB_PATH
        ? { path: process.env.BEHAVIOROS_DB_PATH }
        : undefined,
      // Governed code editing is opt-in and dry-run by default; set
      // BEHAVIOROS_CODE_EDIT=true (plus an explicit apply=true per call) to let
      // bos_code_edit rewrite files inside BEHAVIOROS_CODE_EDIT_ROOT.
      codeEdit: {
        enabled: process.env.BEHAVIOROS_CODE_EDIT === 'true',
        root: process.env.BEHAVIOROS_CODE_EDIT_ROOT,
      },
      // DNA evolution is opt-in; with BEHAVIOROS_EVOLUTION=true, bos_evolution
      // / bos_apply_code_fixes with apply:true can write tool-scoped warn
      // rules derived from recorded failure events.
      evolution: process.env.BEHAVIOROS_EVOLUTION === 'true' ? { enabled: true } : undefined,
    });
  }
  return behaviorOS;
}

// Create MCP server
export const server = new McpServer({
  name: 'behavioros',
  version: SERVER_VERSION,
});

/**
 * Throttle every tool at the registration boundary. Wrapping here (instead of
 * in each handler) means every registered tool and any future tool get the same
 * limit; the override is local to this server instance and delegates to the
 * original method with a bound receiver.
 */
const parsedRateLimit = rateLimitConfigFromEnv();
for (const warning of parsedRateLimit.warnings) {
  console.error(`[Behavior-OS] ${warning}`);
}
export const toolRateLimiter = new ToolRateLimiter(parsedRateLimit.config);
const registerTool = server.registerTool.bind(server);
server.registerTool = ((name, config, callback) =>
  registerTool(
    name,
    config,
    withRateLimit(name, callback, toolRateLimiter),
  )) as typeof server.registerTool;

/**
 * Exported for tests that need a fresh server instance (e.g. InMemoryTransport
 * contracts). Each call creates a new McpServer so the singleton does not get
 * re-connected across tests.
 */
export function createServer(): McpServer {
  return new McpServer({ name: 'behavioros', version: SERVER_VERSION });
}

/**
 * Canonical structural shape of a vote, shared by every tool that accepts one
 * (`bos_decide`, `bos_evolution`, `bos_apply_code_fixes`, `bos_code_edit`).
 * Kept in one place so a malformed vote is rejected at the tool boundary
 * instead of reaching the decision engine.
 */
export const voteSchema = z.object({
  voterId: z.string(),
  choice: z.enum(['approve', 'reject', 'abstain']),
  weight: z.number().optional().describe('Voting weight (default 1)'),
  reason: z.string().optional(),
});

// ============================================================
// GOVERNANCE TOOLS
// ============================================================

server.registerTool(
  'bos_evaluate_governance',
  {
    description: 'Evaluate governance rules for an action',
    inputSchema: z.object({
      action: z.string().describe('The action to evaluate'),
      agent: z.string().describe('Agent ID performing the action'),
      scope: z.string().optional().describe('Scope of the action'),
      context: z.record(z.string(), z.any()).optional().describe('Additional context'),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      title: 'Evaluate Governance',
    },
  },
  async ({ action, agent, scope, context }) => {
    try {
      const bos = getBehaviorOS();
      // `context` is the condition bag the engine matches rule conditions
      // against, so it must be nested under `context.context` (and always carry
      // the action). Spreading it at the top level silently matched no rules.
      const decision = bos.evaluateGovernance(action, {
        agent,
        scope,
        context: { action, ...(context ?? {}) },
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_select_dna',
  {
    description: 'Select a DNA pattern for the current session',
    inputSchema: z.object({
      pattern: z.string().describe('DNA pattern name (e.g., surgical-team, enterprise-governance)'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'Select DNA Pattern',
    },
  },
  async ({ pattern }) => {
    try {
      const bos = getBehaviorOS();
      // Load predefined DNA patterns
      const dnas = await loadDNAPatterns();
      const dna = dnas[pattern.toLowerCase()];

      if (!dna) {
        return {
          content: [
            {
              type: 'text',
              text: `DNA pattern "${pattern}" not found. Available: ${Object.keys(dnas).join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      await bos.loadDNA(dna);
      return {
        content: [{ type: 'text', text: `DNA pattern "${pattern}" selected successfully.` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_dna',
  {
    description: 'List all available DNA patterns',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      title: 'List DNA Patterns',
    },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const patterns = Object.entries(dnas).map(([key, dna]) => ({
        key,
        name: dna.name,
        version: dna.version,
        description: dna.description,
        governanceRules: dna.governance?.length ?? 0,
      }));
      // Mirror the plugin host: listing patterns is step 2 of the 7-step protocol.
      // Without this, MCP callers stall at step 1 after select_dna.
      bos.advanceProtocolStep('bos_list_dna');
      return {
        content: [
          { type: 'text', text: JSON.stringify({ total: patterns.length, patterns }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// MISSION TOOLS
// ============================================================

server.registerTool(
  'bos_create_mission',
  {
    description: 'Create a new mission',
    inputSchema: z.object({
      title: z.string().describe('Mission title'),
      type: z
        .enum(['feature', 'bugfix', 'deployment', 'research', 'refactor', 'audit', 'incident'])
        .describe('Mission type'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).describe('Priority level'),
      requiredChecks: z
        .array(z.string().trim().min(1))
        .optional()
        .describe('Gates that must each have passing evidence before completion'),
    }),
    annotations: {
      title: 'Create Mission',
    },
  },
  async ({ title, type, priority, requiredChecks }) => {
    try {
      const bos = getBehaviorOS();
      const mission = bos.createMission({
        title,
        type: type as MissionType,
        priority: priority as MissionPriority,
        requiredChecks,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(mission, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_start_mission',
  {
    description: 'Start a mission by ID',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      expectedVersion: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Reject the transition if the mission version differs'),
      actor: z.string().optional().describe('Actor recorded in the transition history'),
    }),
    annotations: {
      title: 'Start Mission',
    },
  },
  async ({ missionId, expectedVersion, actor }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.transitionMission(missionId, 'active', { expectedVersion, actor });
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code: result.code,
                  message: result.message,
                  missionId,
                  status: result.mission?.status ?? null,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      if (result.changed) {
        bos.advanceProtocolStep('bos_start_mission');
      }
      return {
        content: [
          {
            type: 'text',
            text: `Mission "${missionId}" started. Status: ${result.mission.status}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_complete_mission',
  {
    description:
      'Complete a mission only when every required check has passing, non-simulated evidence. Refuses invalid transitions, stale versions and missing/failed evidence.',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      evidence: z
        .array(
          z.object({
            gate: z.string().describe('Gate id; must match a requiredChecks entry'),
            status: z.enum(['passed', 'failed', 'skipped']),
            source: z.string().describe('Command, tool or report that produced the evidence'),
            detail: z.string().optional(),
            simulated: z
              .boolean()
              .optional()
              .describe('true marks a simulated check; it never satisfies a required gate'),
            provenance: z
              .enum(['executed', 'reported', 'simulated'])
              .optional()
              .describe('How the evidence was produced; executed requires executionId'),
            executionId: z
              .string()
              .optional()
              .describe('Unique id of the execution that produced executed evidence'),
          }),
        )
        .optional()
        .describe('Evidence to record with the transition'),
      expectedVersion: z.number().int().nonnegative().optional(),
      actor: z.string().optional().describe('Who authorized the transition'),
    }),
    annotations: {
      title: 'Complete Mission',
    },
  },
  async ({ missionId, evidence, expectedVersion, actor }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.transitionMission(missionId, 'completed', {
        evidence,
        expectedVersion,
        actor,
      });
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code: result.code,
                  message: result.message,
                  missionId,
                  status: result.mission?.status ?? null,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                changed: result.changed,
                missionId,
                status: result.mission.status,
                version: result.mission.version ?? 0,
                completionBasis: result.mission.completionBasis ?? null,
                evidenceVerified: result.mission.completionBasis === 'evidence',
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_fail_mission',
  {
    description: 'Mark a mission as failed with an explicit reason and audit trail.',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      reason: z.string().optional().describe('Why the mission failed'),
      expectedVersion: z.number().int().nonnegative().optional(),
      actor: z.string().optional(),
    }),
    annotations: {
      title: 'Fail Mission',
    },
  },
  async ({ missionId, reason, expectedVersion, actor }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.transitionMission(missionId, 'failed', {
        reason,
        expectedVersion,
        actor,
      });
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code: result.code,
                  message: result.message,
                  missionId,
                  status: result.mission?.status ?? null,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                changed: result.changed,
                missionId,
                status: result.mission.status,
                version: result.mission.version ?? 0,
                reason: result.mission.lastTransitionReason ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_cancel_mission',
  {
    description: 'Cancel a mission that will not be completed, recording the reason.',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      reason: z.string().optional().describe('Why the mission was cancelled'),
      expectedVersion: z.number().int().nonnegative().optional(),
      actor: z.string().optional(),
    }),
    annotations: {
      title: 'Cancel Mission',
    },
  },
  async ({ missionId, reason, expectedVersion, actor }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.transitionMission(missionId, 'cancelled', {
        reason,
        expectedVersion,
        actor,
      });
      if (!result.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code: result.code,
                  message: result.message,
                  missionId,
                  status: result.mission?.status ?? null,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                changed: result.changed,
                missionId,
                status: result.mission.status,
                version: result.mission.version ?? 0,
                reason: result.mission.lastTransitionReason ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_missions',
  {
    description: 'List all missions with optional filters',
    inputSchema: z.object({
      status: z
        .enum(['pending', 'active', 'paused', 'completed', 'failed', 'cancelled'])
        .optional()
        .describe('Filter by status'),
      type: z.string().optional().describe('Filter by type'),
      priority: z.string().optional().describe('Filter by priority'),
      limit: z.number().optional().describe('Maximum number of missions to return'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'List Missions',
    },
  },
  async ({
    status,
    type,
    priority,
    limit = 50,
  }: {
    status?: string;
    type?: string;
    priority?: string;
    limit?: number;
  }) => {
    try {
      const bos = getBehaviorOS();
      // The facade owns the filter semantics (applied BEFORE the limit) so the
      // MCP tool and the plugin tool cannot drift apart.
      const missions = bos.listMissions(limit, {
        status: status as MissionStatus | undefined,
        type: type as MissionType | undefined,
        priority: priority as MissionPriority | undefined,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(missions, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_set_agent',
  {
    description:
      'Set the governed agent identity for this session (from a registered agent id, or a persona defined by the active DNA). Used to attribute audits/governance to a role instead of a model name.',
    inputSchema: z.object({
      id: z.string().optional().describe('Registered agent ID'),
      name: z.string().optional().describe('Agent name (registers the agent when the id is new)'),
      type: z
        .enum(['orchestrator', 'developer', 'architect', 'reviewer', 'operator', 'analyst'])
        .optional()
        .describe('Agent type (defaults to operator)'),
      capabilities: z.array(z.string()).optional().describe('Agent capabilities'),
      persona: z
        .string()
        .optional()
        .describe('Persona role/name from the active DNA (e.g. "architect")'),
    }),
    annotations: {
      title: 'Set Agent',
    },
  },
  async (input: {
    id?: string;
    name?: string;
    type?: string;
    capabilities?: string[];
    persona?: string;
  }) => {
    try {
      const bos = getBehaviorOS();
      const identity = bos.setActiveAgent(input);
      if (!identity) {
        const personas = bos.getDNA()?.personas.map((p) => p.role) ?? [];
        return {
          content: [
            {
              type: 'text',
              text: `Error: no agent or persona matched. Available personas: ${personas.length ? personas.join(', ') : '(none — select a DNA first)'}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(identity, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_whoami',
  {
    description:
      'Resolve the governed agent identity acting in this session (agent id, DNA pattern, persona, source) plus the personas/agents that can be selected',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      title: 'Who Am I',
    },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const identity = bos.resolveAgentIdentity();
      const payload = {
        ...identity,
        personas: bos.getDNA()?.personas.map((p) => p.role) ?? [],
        registeredAgents: bos.listAgents().map((a) => ({ id: a.id, name: a.name, type: a.type })),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// QUALITY TOOLS
// ============================================================

server.registerTool(
  'bos_run_audit',
  {
    description:
      'Run a full audit pipeline for a mission. agentId is optional and defaults to the session identity resolved from the active DNA (persona or registered agent) — never the model name.',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      agentId: z
        .string()
        .optional()
        .describe('Explicit agent ID (defaults to the DNA-derived identity)'),
      stages: z.array(z.string()).optional().describe('Stages to audit'),
      simulate: z
        .boolean()
        .optional()
        .describe(
          'true (default) runs a simulated audit and never reports a pass; false executes the real checks',
        ),
    }),
    annotations: {
      title: 'Run Audit',
    },
  },
  async ({
    missionId,
    agentId,
    stages,
    simulate,
  }: {
    missionId: string;
    agentId?: string;
    stages?: string[];
    simulate?: boolean;
  }) => {
    try {
      const bos = getBehaviorOS();
      const report = await bos.runAudit({
        missionId,
        agentId,
        stages,
        simulate,
        // A stdio MCP client can launch this server from any cwd; resolve the
        // workspace from the environment the way the plugin does, so real
        // stages never run outside the project (false red audits).
        root: resolveAuditRoot(process.env, SERVER_DIR),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_check_quality',
  {
    description: 'Check quality metrics against governance gates',
    inputSchema: z.object({
      metrics: z
        .record(z.string(), z.number())
        .describe('Quality metrics (coverage, lint_errors, etc.)'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'Check Quality',
    },
  },
  async ({ metrics }: { metrics: Record<string, number> }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.checkQuality(metrics);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_evaluate_fairness',
  {
    description:
      'Evaluate group outcomes for fairness (demographic parity, disparate impact, equal opportunity), plus data provenance and human oversight',
    inputSchema: z.object({
      groups: z
        .array(
          z.object({
            group: z.string().describe('Protected group label'),
            total: z.number().int().nonnegative().describe('Number of decisions'),
            positive: z.number().int().nonnegative().describe('Favourable decisions'),
            actualPositive: z
              .number()
              .int()
              .nonnegative()
              .optional()
              .describe('Ground-truth positives (equal opportunity)'),
            truePositive: z
              .number()
              .int()
              .nonnegative()
              .optional()
              .describe('Correctly favourable decisions (equal opportunity)'),
          }),
        )
        .describe('Per-group outcome counts; at least two groups with total > 0'),
      provenance: z
        .object({
          datasetId: z.string(),
          source: z.string(),
          collectedAt: z.string().describe('ISO-8601 timestamp'),
          consentBasis: z.string(),
          transformations: z.array(z.string()).optional(),
          lineage: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Data origin and lineage (distinct from evidence provenance)'),
      oversight: z
        .object({
          required: z.boolean(),
          approved: z.boolean(),
          reviewerId: z.string().optional(),
          reviewedAt: z.string().optional(),
          rationale: z.string().optional(),
        })
        .optional()
        .describe('Human review state for a high-impact decision'),
      thresholds: z
        .object({
          maxParityDifference: z.number().min(0).max(1).optional(),
          minDisparateImpactRatio: z.number().min(0).max(1).optional(),
          maxEqualOpportunityDifference: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe('Override the default fairness thresholds'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'Evaluate Fairness',
    },
  },
  async (input: {
    groups: Array<{
      group: string;
      total: number;
      positive: number;
      actualPositive?: number;
      truePositive?: number;
    }>;
    provenance?: {
      datasetId: string;
      source: string;
      collectedAt: string;
      consentBasis: string;
      transformations?: string[];
      lineage?: string[];
    };
    oversight?: {
      required: boolean;
      approved: boolean;
      reviewerId?: string;
      reviewedAt?: string;
      rationale?: string;
    };
    thresholds?: {
      maxParityDifference?: number;
      minDisparateImpactRatio?: number;
      maxEqualOpportunityDifference?: number;
    };
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.evaluateFairness(input as FairnessInput);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// PRAGMATIC VALUE ASSESSMENT TOOLS (Feature 10: Validação Pragmática)
// ============================================================

server.registerTool(
  'bos_assess_pragmatic_value',
  {
    description:
      'Assess the pragmatic value of code changes: net lines removed, complexity change, test coverage change',
    inputSchema: z.object({
      changes: z
        .array(
          z.object({
            addedLines: z.number().min(0).describe('Lines added'),
            removedLines: z.number().min(0).describe('Lines removed'),
          }),
        )
        .describe('Code changes to assess'),
      metrics: z
        .object({
          before: z
            .object({
              complexity: z.number().describe('Cyclomatic complexity before changes'),
              testCoverage: z.number().describe('Test coverage percentage before'),
              rulesCount: z.number().describe('Business rules count before'),
            })
            .passthrough(),
          after: z
            .object({
              complexity: z.number().describe('Cyclomatic complexity after changes'),
              testCoverage: z.number().describe('Test coverage percentage after'),
              rulesCount: z.number().describe('Business rules count after'),
            })
            .passthrough(),
        })
        .describe('Metrics before and after the changes'),
    }),
    annotations: { readOnlyHint: true, title: 'Assess Pragmatic Value' },
  },
  async ({ changes, metrics }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.assessPragmaticValue(changes, metrics);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// PIPELINE TOOLS
// ============================================================

server.registerTool(
  'bos_preflight',
  {
    description:
      'Synchronously pre-flight an action against the gate pipeline; blocks before execution',
    inputSchema: z.object({
      action: z.string().describe('Action to pre-flight, e.g. "deploy"'),
      agentId: z.string().describe('Agent ID'),
      context: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Extra condition flags (e.g. { production: true })'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'Pre-flight Action',
    },
  },
  async ({
    action,
    agentId,
    context,
  }: {
    action: string;
    agentId: string;
    context?: Record<string, unknown>;
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.preflightAction(action, { agent: agentId, context });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// DECISION TOOLS
// ============================================================

server.registerTool(
  'bos_decide',
  {
    description: 'Resolve a subject by weighted vote (majority/supermajority/unanimous + quorum)',
    inputSchema: z.object({
      subject: z.string().describe('What is being decided'),
      votes: z.array(voteSchema).describe('The votes to tally'),
      policy: z
        .enum(['majority', 'supermajority', 'unanimous'])
        .optional()
        .describe('Decision policy (default majority)'),
      quorum: z.number().optional().describe('Minimum participating weight (default 1)'),
      missionId: z.string().optional().describe('Related mission ID'),
    }),
    annotations: {
      title: 'Decide',
    },
  },
  async ({
    subject,
    votes,
    policy,
    quorum,
    missionId,
  }: {
    subject: string;
    votes: Vote[];
    policy?: DecisionPolicy;
    quorum?: number;
    missionId?: string;
  }) => {
    try {
      const bos = getBehaviorOS();
      const decision = bos.decide({ subject, votes, policy, quorum, missionId });
      return {
        content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// EVOLUTION TOOLS
// ============================================================

server.registerTool(
  'bos_evolution',
  {
    description: 'Propose (and optionally apply) learning-driven DNA changes, scored by confidence',
    inputSchema: z.object({
      minConfidence: z
        .number()
        .optional()
        .describe('Minimum confidence in [0,1] for a proposal (default 0.8)'),
      apply: z
        .boolean()
        .optional()
        .describe('Write proposals into the active DNA (requires evolution.enabled)'),
      votes: z
        .array(voteSchema)
        .optional()
        .describe('If supplied, the change must be approved by this vote'),
      policy: z.enum(['majority', 'supermajority', 'unanimous']).optional(),
    }),
    annotations: {
      title: 'DNA evolution',
    },
  },
  async ({
    minConfidence,
    apply,
    votes,
    policy,
  }: {
    minConfidence?: number;
    apply?: boolean;
    votes?: Vote[];
    policy?: DecisionPolicy;
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.applyEvolution({ minConfidence, apply, votes, policy });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// CODE FIX TOOLS
// ============================================================

server.registerTool(
  'bos_code_fixes',
  {
    description: 'Propose code fixes derived from repeated fix events, scored by confidence',
    inputSchema: z.object({
      minConfidence: z
        .number()
        .optional()
        .describe('Minimum confidence in [0,1] for a proposal (default 0.8)'),
    }),
    annotations: {
      title: 'Code fix proposals',
    },
  },
  async ({ minConfidence }: { minConfidence?: number }) => {
    try {
      const bos = getBehaviorOS();
      const proposals = bos.proposeCodeFixes(minConfidence);
      return {
        content: [{ type: 'text', text: JSON.stringify(proposals, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_apply_code_fixes',
  {
    description:
      'Persist code-fix proposals (requires evolution.enabled + apply:true; optional votes gate via decision engine)',
    inputSchema: z.object({
      minConfidence: z.number().optional().describe('Minimum confidence in [0,1] (default 0.8)'),
      apply: z
        .boolean()
        .optional()
        .describe('Write proposals to the store (requires evolution.enabled)'),
      votes: z
        .array(voteSchema)
        .optional()
        .describe('If supplied, the change must be approved by this vote'),
      policy: z.enum(['majority', 'supermajority', 'unanimous']).optional(),
    }),
    annotations: {
      title: 'Apply code fixes',
    },
  },
  async ({
    minConfidence,
    apply,
    votes,
    policy,
  }: {
    minConfidence?: number;
    apply?: boolean;
    votes?: Vote[];
    policy?: DecisionPolicy;
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.applyCodeFixes({ minConfidence, apply, votes, policy });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// LIST CODE FIX RESULTS
// ============================================================

server.registerTool(
  'bos_list_code_fixes',
  {
    description: 'List persisted code-fix application results (CodeFixResult records)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum results to return (default 50)'),
    }),
    annotations: {
      title: 'List code fix results',
    },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const results = bos.listCodeFixResults(limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// GOVERNED CODE EDITING
// ============================================================

server.registerTool(
  'bos_code_edit',
  {
    description:
      'Preview (dry-run) or apply a single-text replacement inside a workspace file. Writes only when code editing is enabled (BEHAVIOROS_CODE_EDIT=true) *and* apply=true; optional votes gate the change. Every evaluation is persisted with before/after SHA-256 hashes.',
    inputSchema: z.object({
      file: z.string().describe('File path, absolute or relative to the workspace root'),
      find: z.string().describe('Exact text to replace; must occur exactly once'),
      replace: z.string().describe('Replacement text'),
      apply: z
        .boolean()
        .optional()
        .describe(
          'Write the change (requires code editing to be enabled). Default false = dry run',
        ),
      expectedBeforeHash: z
        .string()
        .optional()
        .describe('Hash from a previous preview; refuses a file that changed since'),
      missionId: z.string().optional().describe('Mission this edit belongs to'),
      votes: z.array(voteSchema).optional().describe('Votes gating the change'),
      applyVotes: z
        .array(voteSchema)
        .optional()
        .describe('Deprecated alias of `votes`; prefer `votes`'),
      policy: z
        .enum(['majority', 'supermajority', 'unanimous'])
        .optional()
        .describe('Vote policy when votes are supplied'),
    }),
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
      title: 'Governed code edit',
    },
  },
  async ({
    file,
    find,
    replace,
    apply,
    expectedBeforeHash,
    missionId,
    votes,
    applyVotes,
    policy,
  }: {
    file: string;
    find: string;
    replace: string;
    apply?: boolean;
    expectedBeforeHash?: string;
    missionId?: string;
    votes?: Vote[];
    applyVotes?: Vote[];
    policy?: DecisionPolicy;
  }) => {
    try {
      if (votes && applyVotes) {
        throw new Error(
          'bos_code_edit received both `votes` and the deprecated `applyVotes`; send only one.',
        );
      }
      const bos = getBehaviorOS();
      const result = bos.applyCodeEdit({
        file,
        find,
        replace,
        apply,
        expectedBeforeHash,
        missionId,
        votes: votes ?? applyVotes,
        policy,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        ...(result.error ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_code_edits',
  {
    description:
      'List persisted code-edit records — dry runs, refusals and applied edits alike (CodeEditResult records)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum results to return (default 50)'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'List code edits',
    },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const records = bos.listCodeEdits(limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(records, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// LEARNING TOOLS
// ============================================================

server.registerTool(
  'bos_record_learning',
  {
    description:
      'Record a learning event, or promote an existing learning record one lifecycle stage (observation → lesson → candidate → validated → policy → monitored). Promotion to validated requires evidence.',
    inputSchema: z.object({
      type: z
        .enum(['insight', 'pattern', 'fix', 'failure', 'optimization'])
        .describe('Learning type'),
      source: z.string().describe('Source of the learning'),
      content: z.string().describe('Learning content'),
      impact: z.enum(['low', 'medium', 'high', 'critical']).describe('Impact level'),
      relatedMission: z.string().optional().describe('Related mission ID'),
      learningId: z
        .string()
        .optional()
        .describe('Existing learning record to promote (instead of recording a new event)'),
      stage: z
        .enum(['observation', 'lesson', 'candidate', 'validated', 'policy', 'monitored'])
        .optional()
        .describe('Target stage; must be exactly one step after the current stage'),
      evidence: z
        .array(z.string())
        .optional()
        .describe('Evidence for the promotion; required to reach validated'),
      reason: z.string().optional(),
    }),
    annotations: {
      title: 'Record Learning',
    },
  },
  async ({
    type,
    source,
    content,
    impact,
    relatedMission,
    learningId,
    stage,
    evidence,
    reason,
  }: {
    type: string;
    source: string;
    content: string;
    impact: string;
    relatedMission?: string;
    learningId?: string;
    stage?: 'observation' | 'lesson' | 'candidate' | 'validated' | 'policy' | 'monitored';
    evidence?: string[];
    reason?: string;
  }) => {
    try {
      const bos = getBehaviorOS();
      // Promotion path: move an existing record exactly one stage forward.
      // Same contract as the plugin's tool handler — hosts must agree on the
      // lifecycle or cross-host records would drift.
      if (learningId) {
        if (!stage) {
          return {
            content: [
              {
                type: 'text',
                text: 'Learning promotion refused [INVALID_INPUT]: provide the target `stage` for `learningId`.',
              },
            ],
            isError: true,
          };
        }
        const result = bos.advanceLearningRecord(learningId, stage, {
          actor: 'mcp',
          ...(evidence ? { evidence } : {}),
          ...(reason ? { reason } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }
      const event = bos.recordLearning({
        type: type as LearningType,
        source,
        content,
        impact: impact as LearningImpact,
        relatedMission,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(event, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_get_insights',
  {
    description: 'Get high-impact insights from learning engine',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum insights to return'),
    }),
    annotations: {
      readOnlyHint: true,
      title: 'Get Insights',
    },
  },
  async ({ limit = 10 }) => {
    try {
      const bos = getBehaviorOS();
      const insights = bos.getInsights(limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(insights, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

/** Machine-readable enforcement attached to a policy version. */
export const policyEnforcementSchema = z.object({
  action: z.enum(['block', 'escalate', 'require', 'warn']),
  match: z.string().describe('Case-insensitive substring of the action, or "*" for every action'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  description: z.string().optional(),
});

server.registerTool(
  'bos_policy',
  {
    description:
      'Governed policy lifecycle console: list, status, events, create, validate, approve, activate, deactivate, rollback and monitor. Only a human actor can approve or activate.',
    inputSchema: z.object({
      operation: z.enum([
        'list',
        'status',
        'events',
        'create',
        'validate',
        'approve',
        'activate',
        'deactivate',
        'rollback',
        'monitor',
      ]),
      policyId: z
        .string()
        .optional()
        .describe('Stable policy identity, e.g. policy:no-friday-deploy'),
      versionId: z.string().optional().describe('Version id, e.g. policy:no-friday-deploy@1'),
      toVersionId: z.string().optional().describe('Rollback target version id'),
      content: z.string().optional().describe('Policy statement (create)'),
      rationale: z.string().optional().describe('Human approval rationale (approve, >= 10 chars)'),
      reason: z.string().optional().describe('Audit reason (create/activate/deactivate/rollback)'),
      actorId: z.string().optional().describe('Actor id (default mcp-client)'),
      actorKind: z
        .enum(['human', 'agent', 'llm', 'system'])
        .optional()
        .describe('Actor kind; approve/activate/deactivate/rollback require human'),
      approvalToken: z
        .string()
        .optional()
        .describe('HMAC token required when BEHAVIOR_OS_APPROVAL_KEY is set'),
      issues: z.array(z.string()).optional().describe('Validation issues to record'),
      enforcement: policyEnforcementSchema.optional(),
      success: z.boolean().optional().describe('Monitoring outcome (default true)'),
      detail: z.string().optional().describe('Monitoring detail'),
    }),
    annotations: {
      title: 'Governed Policy',
    },
  },
  async (params) => {
    try {
      const bos = getBehaviorOS();
      const actor: PolicyActor = {
        id: params.actorId ?? 'mcp-client',
        kind: params.actorKind ?? 'agent',
      };
      const requireField = (value: string | undefined, name: string): string => {
        if (!value) throw new Error(`${name} is required for operation "${params.operation}"`);
        return value;
      };

      let result: unknown;
      switch (params.operation) {
        case 'list':
          result = bos.listPolicies();
          break;
        case 'status': {
          const policyId = requireField(params.policyId, 'policyId');
          const versions = bos.getPolicyVersions(policyId);
          result = {
            policyId,
            active: bos.getActivePolicyVersion(policyId) ?? null,
            latest: versions[versions.length - 1] ?? null,
            versions: versions.map((version) => ({
              versionId: version.versionId,
              status: bos.getPolicyStatus(policyId, version.versionId),
              enforcement: version.enforcement ?? null,
            })),
            monitoring: bos.getPolicyMonitoring(policyId) ?? null,
          };
          break;
        }
        case 'events':
          result = bos.getPolicyLedgerEvents(params.policyId);
          break;
        case 'create':
          result = bos.createPolicyCandidate({
            ...(params.policyId ? { policyId: params.policyId } : {}),
            content: requireField(params.content, 'content'),
            actor,
            source: 'mcp',
            ...(params.reason ? { reason: params.reason } : {}),
            ...(params.enforcement ? { enforcement: params.enforcement as PolicyEnforcement } : {}),
          });
          break;
        case 'validate':
          result = bos.validatePolicyVersion(
            requireField(params.policyId, 'policyId'),
            requireField(params.versionId, 'versionId'),
            { actor, ...(params.issues ? { issues: params.issues } : {}) },
          );
          break;
        case 'approve':
          result = bos.approvePolicyVersion(
            requireField(params.policyId, 'policyId'),
            requireField(params.versionId, 'versionId'),
            {
              actor,
              rationale: requireField(params.rationale, 'rationale'),
              ...(params.approvalToken ? { approvalToken: params.approvalToken } : {}),
            },
          );
          break;
        case 'activate':
          result = bos.activatePolicyVersion(
            requireField(params.policyId, 'policyId'),
            requireField(params.versionId, 'versionId'),
            { actor, ...(params.reason ? { reason: params.reason } : {}) },
          );
          break;
        case 'deactivate':
          result = bos.deactivatePolicy(requireField(params.policyId, 'policyId'), {
            actor,
            reason: requireField(params.reason, 'reason'),
          });
          break;
        case 'rollback':
          result = bos.rollbackPolicy(
            requireField(params.policyId, 'policyId'),
            requireField(params.toVersionId, 'toVersionId'),
            { actor, reason: requireField(params.reason, 'reason') },
          );
          break;
        case 'monitor':
          result = bos.monitorPolicy(requireField(params.policyId, 'policyId'), {
            actor,
            success: params.success ?? true,
            ...(params.detail ? { detail: params.detail } : {}),
          });
          break;
      }

      const failed =
        typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        ...(failed ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// STATUS TOOLS
// ============================================================

server.registerTool(
  'bos_get_status',
  {
    description: 'Get current system status and health',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      title: 'Get Status',
    },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const status = bos.getStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_get_state',
  {
    description: 'Get current agent protocol state',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      title: 'Get State',
    },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const state = bos.getState();
      // Resolve State is step 3 of the 7-step protocol; the plugin host already
      // advances it here so MCP callers must mirror that to stay aligned.
      bos.advanceProtocolStep('bos_get_state');
      return {
        content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// LIST TOOLS
// ============================================================

server.registerTool(
  'bos_list_decisions',
  {
    description: 'List persisted voting/quorum decisions (requires persistence)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum results (default 50)'),
    }),
    annotations: { readOnlyHint: true, title: 'List Decisions' },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const decisions = bos.listDecisions(limit);
      return { content: [{ type: 'text', text: JSON.stringify(decisions, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_pipeline_runs',
  {
    description: 'List persisted gate-pipeline runs / blocked pre-flights (requires persistence)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum results (default 50)'),
    }),
    annotations: { readOnlyHint: true, title: 'List Pipeline Runs' },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const runs = bos.listPipelineRuns(limit);
      return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_audit_reports',
  {
    description: 'List persisted audit reports (requires persistence)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum results (default 50)'),
    }),
    annotations: { readOnlyHint: true, title: 'List Audit Reports' },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const reports = bos.listAuditReports(limit);
      return { content: [{ type: 'text', text: JSON.stringify(reports, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_get_log',
  {
    description:
      'Read the recent Behavior-OS governance log (how DNA rules were applied to actions in this session)',
    inputSchema: z.object({
      limit: z.number().optional().describe('Maximum entries to return (default 50)'),
    }),
    annotations: { readOnlyHint: true, title: 'Governance Log' },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const entries = bos.getGovernanceLog(limit ?? 50);
      return {
        content: [
          { type: 'text', text: JSON.stringify({ total: entries.length, entries }, null, 2) },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_verify_audit_trail',
  {
    description:
      'Verify the SHA-256 hash chain of the governance log. Reports whether the in-memory log is intact (tamper-evident audit).',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, title: 'Verify Audit Trail' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const verification = bos.verifyAuditTrail();
      const chain = bos.getGovernanceChainHead();
      const sink = bos.getGovernanceLogSink();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...verification,
                ...chain,
                sink: {
                  enabled: sink.path !== null,
                  path: sink.path,
                  writeErrors: sink.writeErrors,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// ANALYTICS TOOLS
// ============================================================

server.registerTool(
  'bos_recommendations',
  {
    description: 'Scored recommendations derived from recent learning events',
    inputSchema: z.object({
      limit: z.number().optional().describe('Max recommendations (default 5)'),
      ageLimitHours: z.number().optional().describe('Ignore older events (default 168h)'),
    }),
    annotations: { readOnlyHint: true, title: 'Recommendations' },
  },
  async ({ limit, ageLimitHours }: { limit?: number; ageLimitHours?: number }) => {
    try {
      const bos = getBehaviorOS();
      const recs = bos.recommend(limit, ageLimitHours);
      return { content: [{ type: 'text', text: JSON.stringify(recs, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_drift',
  {
    description: 'Compare two DNA patterns (by name) and report behavioral drift',
    inputSchema: z.object({
      dnaA: z.string().describe('Older DNA pattern name, e.g. "lean-factory"'),
      dnaB: z.string().describe('Newer DNA pattern name, e.g. "devops-pipeline"'),
    }),
    annotations: { readOnlyHint: true, title: 'DNA Drift' },
  },
  async ({ dnaA, dnaB }: { dnaA: string; dnaB: string }) => {
    try {
      const dnas = await loadDNAPatterns();
      const a = dnas[dnaA.toLowerCase()];
      const b = dnas[dnaB.toLowerCase()];
      if (!a || !b) {
        const missing = [!a ? dnaA : null, !b ? dnaB : null].filter(Boolean).join('", "');
        return {
          content: [
            {
              type: 'text',
              text: `DNA pattern(s) not found: "${missing}". Available: ${Object.keys(dnas)
                .sort()
                .join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      const drift = getBehaviorOS().compareDNADrift(a, b);
      return { content: [{ type: 'text', text: JSON.stringify(drift, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// PREDICTION TOOLS
// ============================================================

server.registerTool(
  'bos_predict_governance',
  {
    description:
      'Predict likely future governance events from learning history. Returns confidence-scored predictions about governance-block, mission-failure, quality-fall, drift-significant, or pattern-repeated events.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Max predictions to return (default 5)'),
    }),
    annotations: { readOnlyHint: true, title: 'Predict Governance Events' },
  },
  async ({ limit }: { limit?: number }) => {
    try {
      const bos = getBehaviorOS();
      const predictions = bos.predict(limit);
      return { content: [{ type: 'text', text: JSON.stringify(predictions, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// CONSENSUS & CROSS-DNA LEARNING TOOLS (Feature #8)
// ============================================================

server.registerTool(
  'bos_resolve_consensus',
  {
    description:
      'Resolve a multi-agent consensus round. Votes are weighted; ties and all-abstain resolve to rejected (fail-safe).',
    inputSchema: z.object({
      subject: z.string().describe('What is being decided'),
      votes: z.array(
        z.object({
          agentId: z.string().describe('Stable agent identifier'),
          choice: z.enum(['approve', 'reject', 'abstain']),
          weight: z.number().optional().describe('Weight in the tally (default 1)'),
          reason: z.string().optional().describe('Human-readable justification'),
        }),
      ),
      policy: z.enum(['majority', 'supermajority', 'unanimous']).optional(),
      quorum: z.number().optional().describe('Minimum participating weight'),
    }),
    annotations: {
      title: 'Resolve Consensus',
    },
  },
  async ({
    subject,
    votes,
    policy,
    quorum,
  }: {
    subject: string;
    votes: ConsensusVote[];
    policy?: 'majority' | 'supermajority' | 'unanimous';
    quorum?: number;
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.resolveConsensus({ subject, votes, policy, quorum });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_suggest_cross_dna_transfer',
  {
    description:
      'Suggest learning transfers (patterns, rules, fixes) from one DNA to another based on shared behavioral patterns.',
    inputSchema: z.object({
      sourceDna: z.string().describe('Source DNA pattern name'),
      targetDna: z.string().describe('Target DNA pattern name'),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum confidence threshold (default 0.5)'),
    }),
    annotations: { readOnlyHint: true, title: 'Suggest Cross-DNA Transfer' },
  },
  async ({
    sourceDna,
    targetDna,
    minConfidence,
  }: {
    sourceDna: string;
    targetDna: string;
    minConfidence?: number;
  }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const source = dnas[sourceDna.toLowerCase()];
      const target = dnas[targetDna.toLowerCase()];
      if (!source || !target) {
        const missing = [!source ? sourceDna : null, !target ? targetDna : null]
          .filter(Boolean)
          .join('", "');
        return {
          content: [
            {
              type: 'text',
              text: `DNA pattern(s) not found: "${missing}". Available: ${Object.keys(dnas).join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      const result = bos.suggestCrossDnaTransfer(source, target, minConfidence ?? 0.5);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// RESOURCES
// ============================================================

server.registerResource(
  'behavioros://protocol/steps',
  'behavioros://protocol/steps',
  { mimeType: 'text/plain', description: 'Protocol Steps' },
  async () => ({
    contents: [
      {
        uri: 'behavioros://protocol/steps',
        // Rendered from PROTOCOL_STEPS in @behavior-os/core, so it cannot drift.
        text: [
          '# Behavior-OS 7-Step Protocol',
          '',
          ...PROTOCOL_STEPS.map((step) => `${step.number}. ${step.name} (${step.tool})`),
        ].join('\n'),
      },
    ],
  }),
);

server.registerResource(
  'behavioros://dna/catalog',
  'behavioros://dna/catalog',
  { mimeType: 'application/json', description: 'DNA Catalog' },
  async () => {
    const dnas = await loadDNAPatterns();
    const available = Object.keys(dnas).sort();
    return {
      contents: [
        {
          uri: 'behavioros://dna/catalog',
          text: JSON.stringify(
            {
              available,
              default: available.includes('enterprise-governance')
                ? 'enterprise-governance'
                : available[0],
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ============================================================
// DNA PATTERNS - Carregados do sistema de arquivos
// ============================================================

async function loadDNAPatterns(): Promise<Record<string, DNA>> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const yaml = await import('js-yaml');

  // Default to the repository's dnas/ directory resolved relative to this module
  // (packages/mcp-server/{src,dist}/server.ts -> <repo>/dnas) so the server works on
  // any machine instead of depending on a hardcoded checkout path.
  const defaultDnasPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../dnas',
  );
  const dnaPath = process.env.BEHAVIOROS_DNA_PATH || defaultDnasPath;

  const dnas: Record<string, DNA> = {};

  try {
    const resolved = path.resolve(dnaPath);
    const files = fs.statSync(resolved).isDirectory()
      ? fs
          .readdirSync(resolved)
          .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
          .map((file) => path.join(resolved, file))
      : [resolved];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const dna = yaml.load(content) as DNA;
      const name = path.basename(filePath).replace(/\.(yaml|yml)$/, '');
      dnas[name] = dna;
    }
  } catch {
    // Fallback to hardcoded patterns if filesystem loading fails
    console.error('Warning: Could not load DNA patterns from filesystem, using defaults');
  }

  // Ensure we have at least the basic patterns
  if (Object.keys(dnas).length === 0) {
    dnas['surgical-team'] = {
      name: 'Surgical Team',
      version: '2.0.0',
      description: 'Zero-defect governance with sterile field protocols',
      personas: [],
      governance: [],
      quality: [],
    };
  }

  return dnas;
}

// ============================================================
// METRICS & OBSERVABILITY TOOLS
// ============================================================

server.registerTool(
  'bos_get_metrics',
  {
    description: 'Get current system-wide governance metrics and observability data',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { readOnlyHint: true, title: 'Get Metrics' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const metrics = bos.getMetrics();
      return { content: [{ type: 'text', text: JSON.stringify(metrics, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_reset_metrics',
  {
    description: 'Reset all governance metrics (useful for fresh measurements)',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { destructiveHint: true, title: 'Reset Metrics' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      bos.resetMetrics();
      return { content: [{ type: 'text', text: 'Metrics reset successfully' }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// BRAINSTORMING & DYNAMIC DNA TOOLS
// ============================================================

server.registerTool(
  'bos_create_brainstorm',
  {
    description: 'Create a new brainstorming session for multi-agent collaboration',
    inputSchema: z.object({
      title: z.string().describe('Title of the brainstorming topic'),
      participants: z.array(z.string()).describe('Agent IDs participating'),
      dnaPattern: z.string().describe('DNA pattern governing the session'),
    }),
    annotations: { readOnlyHint: true, title: 'Create Brainstorm' },
  },
  async ({ title, participants, dnaPattern }) => {
    try {
      const bos = getBehaviorOS();
      const session = bos.createBrainstormSession(title, participants, dnaPattern);
      return { content: [{ type: 'text', text: JSON.stringify(session, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_brainstorms',
  {
    description: 'List all brainstorming sessions',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { readOnlyHint: true, title: 'List Brainstorms' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const sessions = bos.listBrainstormSessions();
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_propose_idea',
  {
    description: 'Propose an idea in a brainstorming session',
    inputSchema: z.object({
      sessionId: z.string().describe('Brainstorm session ID'),
      authorId: z.string().describe('Agent proposing the idea'),
      title: z.string().describe('Idea title'),
      description: z.string().describe('Idea description'),
    }),
    annotations: { readOnlyHint: false, title: 'Propose Idea' },
  },
  async ({ sessionId, authorId, title, description }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getBrainstorm();
      const result = engine.proposeIdea(sessionId, authorId, title, description);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_vote_idea',
  {
    description: 'Vote on an idea in a brainstorming session',
    inputSchema: z.object({
      sessionId: z.string().describe('Brainstorm session ID'),
      ideaId: z.string().describe('Idea ID to vote on'),
      voterId: z.string().describe('Agent voting'),
      vote: z.enum(['support', 'oppose', 'neutral']).describe('Vote choice'),
      reason: z.string().optional(),
    }),
    annotations: { readOnlyHint: false, title: 'Vote Idea' },
  },
  async ({ sessionId, ideaId, voterId, vote, reason }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getBrainstorm();
      const result = engine.voteOnIdea(sessionId, ideaId, voterId, vote, reason);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_create_dynamic_dna',
  {
    description: 'Create a dynamic DNA that can be modified at runtime',
    inputSchema: z.object({
      dnaName: z.string().describe('Name for the dynamic DNA'),
      baseDnaName: z.string().describe('Base DNA pattern name'),
    }),
    annotations: { readOnlyHint: false, title: 'Create Dynamic DNA' },
  },
  async ({ dnaName, baseDnaName }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const baseDna = dnas[baseDnaName.toLowerCase()];
      if (!baseDna) {
        return {
          content: [{ type: 'text', text: `Base DNA "${baseDnaName}" not found` }],
          isError: true,
        };
      }
      const manager = bos.getDynamicDNAManager();
      const dynamic = manager.createDynamicDNA(dnaName, baseDna);
      return { content: [{ type: 'text', text: JSON.stringify(dynamic, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_override_rule',
  {
    description: 'Override a governance rule in a dynamic DNA',
    inputSchema: z.object({
      dnaName: z.string().describe('Dynamic DNA name'),
      ruleId: z.string().describe('Rule ID to override'),
      action: z.enum(['block', 'escalate', 'warn', 'log', 'transform']).describe('New action'),
      reason: z.string().describe('Reason for override'),
      authorizedBy: z.string().describe('Who authorized'),
    }),
    annotations: { destructiveHint: true, title: 'Override Rule' },
  },
  async ({ dnaName, ruleId, action, reason, authorizedBy }) => {
    try {
      const bos = getBehaviorOS();
      const manager = bos.getDynamicDNAManager();
      const result = manager.addOverride(dnaName, ruleId, action, undefined, reason, authorizedBy);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// BEHAVIORAL UX TOOLS
// ============================================================

server.registerTool(
  'bos_behavior_profile',
  {
    description: 'Generate a human-readable behavioral profile for an agent',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      persona: z.string().describe('Agent persona/role'),
      dnaPattern: z.string().describe('Active DNA pattern name'),
    }),
    annotations: { readOnlyHint: true, title: 'Behavior Profile' },
  },
  async ({ agentId, persona, dnaPattern }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const dna = dnas[dnaPattern.toLowerCase()];
      if (!dna) {
        return {
          content: [{ type: 'text', text: `DNA pattern "${dnaPattern}" not found` }],
          isError: true,
        };
      }
      const ux = bos.getBehavioralUX();
      const learnings = bos.getInsights(100);
      const missions = bos.listMissions(50);
      const profile = ux.generateProfile(agentId, persona, dnaPattern, dna, learnings, missions);
      const md = ux.generateMarkdownReport(agentId, profile);
      return { content: [{ type: 'text', text: md }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_behavior_diff',
  {
    description: 'Compare two DNA patterns and show behavioral drift with interpretation',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      olderDna: z.string().describe('Older DNA pattern name'),
      newerDna: z.string().describe('Newer DNA pattern name'),
    }),
    annotations: { readOnlyHint: true, title: 'Behavior Diff' },
  },
  async ({ agentId, olderDna, newerDna }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const older = dnas[olderDna.toLowerCase()];
      const newer = dnas[newerDna.toLowerCase()];
      if (!older || !newer) {
        return {
          content: [
            {
              type: 'text',
              text: `DNA patterns not found. Available: ${Object.keys(dnas).join(', ')}`,
            },
          ],
          isError: true,
        };
      }
      const driftEngine = bos.getDriftEngine();
      const driftInfo = driftEngine.compare(older, newer);
      const ux = bos.getBehavioralUX();
      const diff = ux.compareBehaviors(agentId, older, newer, driftInfo);
      const _profile =
        ux.getAllDiffs().length > 0 ? ux.getAllDiffs()[ux.getAllDiffs().length - 1] : diff;
      const md = ux.generateMarkdownReport(
        agentId,
        {
          agentId,
          persona: 'comparator',
          dnaPattern: `${olderDna}→${newerDna}`,
          dnaVersion: `${older.version}→${newer.version}`,
          traits: [],
          confidence: 0.5,
          governanceScore: 50,
          learnedBehaviors: [],
          predictedFailures: [],
          timestamp: new Date().toISOString(),
        },
        diff,
      );
      return { content: [{ type: 'text', text: md }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_teach_behavior',
  {
    description: 'Teach/correct agent behavior — record a behavioral education',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      pattern: z.string().describe('Behavior pattern to correct'),
      correction: z.string().describe('Correct behavior description'),
      reason: z.string().describe('Reason for correction'),
    }),
    annotations: { readOnlyHint: false, title: 'Teach Behavior' },
  },
  async ({ agentId, pattern, correction, reason }) => {
    try {
      const bos = getBehaviorOS();
      const ux = bos.getBehavioralUX();
      const education = ux.teachBehavior(agentId, pattern, correction, reason, 'user');
      // Also record as a learning event
      bos.recordLearning({
        type: 'fix',
        source: 'behavior-education',
        content: `Educated ${agentId}: ${correction}`,
        impact: 'high',
        relatedMission: education.id,
      });
      return {
        content: [
          {
            type: 'text',
            text: `✅ Behavior educated!\n\n**Pattern:** ${pattern}\n**Correction:** ${correction}\n**Reason:** ${reason}\n**ID:** ${education.id}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_behavior_timeline',
  {
    description: 'Get evolution timeline showing how agent behavior changed over time',
    inputSchema: z
      .object({
        agentId: z.string().optional().describe('Filter by agent ID'),
        limit: z.number().optional().describe('Max entries (default 20)'),
      })
      .passthrough()
      .optional(),
    annotations: { readOnlyHint: true, title: 'Behavior Timeline' },
  },
  async (params: { agentId?: string; limit?: number } | undefined) => {
    const agentId = params?.agentId;
    const limit = params?.limit ?? 20;
    try {
      const bos = getBehaviorOS();
      const ux = bos.getBehavioralUX();
      const timeline = ux.getTimeline(agentId).slice(0, limit);
      if (timeline.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: agentId
                ? `No behavior events found for agent "${agentId}"`
                : 'No behavior events recorded yet.',
            },
          ],
        };
      }
      let md = '# 📈 Evolution Timeline\n\n';
      for (const entry of timeline) {
        md += `${entry.emoji} **${entry.timestamp}** — ${entry.event}\n\n`;
        md += `${entry.description}\n\n`;
        md += `_Impact: ${entry.impact} | Type: ${entry.type}_\n\n---\n\n`;
      }
      return { content: [{ type: 'text', text: md }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_behavior_summary',
  {
    description: 'Get a quick one-line behavior summary for an agent',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
    }),
    annotations: { readOnlyHint: true, title: 'Behavior Summary' },
  },
  async ({ agentId }) => {
    try {
      const bos = getBehaviorOS();
      const ux = bos.getBehavioralUX();
      const profile = ux.getProfile(agentId);
      if (!profile) {
        return {
          content: [
            {
              type: 'text',
              text: `No profile found for agent "${agentId}". Generate one with bos_behavior_profile first.`,
            },
          ],
        };
      }
      const summary = ux.getBehaviorSummary(profile);
      const statusEmoji = ux.getStatusEmoji(profile);
      return {
        content: [
          { type: 'text', text: summary },
          {
            type: 'text',
            text: `\n\n${statusEmoji} Governança: ${profile.governanceScore.toFixed(0)}% | Confiança: ${(profile.confidence * 100).toFixed(0)}%`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_behavior_report',
  {
    description: 'Generate a full markdown behavioral report for an agent',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      persona: z.string().describe('Agent persona'),
      dnaPattern: z.string().describe('DNA pattern name'),
      includeDiff: z.boolean().optional().describe('Include latest diff (default false)'),
    }),
    annotations: { readOnlyHint: true, title: 'Behavior Report' },
  },
  async ({ agentId, persona, dnaPattern, includeDiff = false }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const dna = dnas[dnaPattern.toLowerCase()];
      if (!dna) {
        return {
          content: [{ type: 'text', text: `DNA "${dnaPattern}" not found` }],
          isError: true,
        };
      }
      const ux = bos.getBehavioralUX();
      const learnings = bos.getLearningEvents();
      const missions = bos.listMissions(50);
      const profile = ux.generateProfile(agentId, persona, dnaPattern, dna, learnings, missions);
      const latestDiff = includeDiff
        ? ux.getAllDiffs().find((d: { newerDna: string }) => d.newerDna === dnaPattern)
        : undefined;
      const md = ux.generateMarkdownReport(agentId, profile, latestDiff);
      return { content: [{ type: 'text', text: md }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// ANTI-PATTERN & PRAGMATIC CONVERSATION TOOLS
// ============================================================

server.registerTool(
  'bos_scan_antipatterns',
  {
    description: 'Scan code/text for anti-patterns (TS errors, lint violations, security issues)',
    inputSchema: z.object({
      text: z.string().describe('Code or text to scan'),
      source: z.string().optional().describe('Source location/file'),
    }),
    annotations: { readOnlyHint: true, title: 'Scan Anti-Patterns' },
  },
  async ({ text, source }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getAntipatternEngine();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Antipattern engine not initialized' }],
          isError: true,
        };
      const result = engine.scan(text, source);
      let md = `# 🛡️ Anti-Pattern Scan Results\n\n## Summary\n- Critical: ${result.summary.critical}\n- High: ${result.summary.high}\n- Medium: ${result.summary.medium}\n- Low: ${result.summary.low}\n- Info: ${result.summary.info}\n- **Total: ${result.summary.total}**\n\n`;
      if (result.patterns.length === 0) {
        md += `✅ **No anti-patterns detected!** Clean code.\n`;
      } else {
        for (const p of result.patterns) {
          const emoji =
            p.severity === 'critical'
              ? '🔴'
              : p.severity === 'high'
                ? '🟠'
                : p.severity === 'medium'
                  ? '🟡'
                  : '🟢';
          md += `${emoji} **${p.severity.toUpperCase()}** — ${p.type}\n\n`;
          md += `- Pattern: \`${p.pattern}\`\n`;
          md += `- Description: ${p.description}\n`;
          md += `- Recommendation: ${p.recommendation}\n\n---\n\n`;
        }
      }
      return { content: [{ type: 'text', text: md }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_fix_antipatterns',
  {
    description: 'Auto-fix critical and high severity anti-patterns',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { readOnlyHint: false, title: 'Fix Anti-Patterns' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getAntipatternEngine();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Antipattern engine not initialized' }],
          isError: true,
        };
      const fixed = engine.autoFixCritical();
      return {
        content: [
          {
            type: 'text',
            text: `✅ Fixed ${fixed.length} critical/high anti-patterns automatically.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_antipattern_report',
  {
    description: 'Generate full anti-pattern remediation report',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { readOnlyHint: true, title: 'Anti-Pattern Report' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getAntipatternEngine();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Antipattern engine not initialized' }],
          isError: true,
        };
      const report = engine.generateReport();
      return { content: [{ type: 'text', text: report }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_start_conversation',
  {
    description: 'Start a pragmatic conversation between agents to solve a problem',
    inputSchema: z.object({
      title: z.string().describe('Conversation title'),
      problem: z.string().describe('Problem description'),
      participants: z.array(z.string()).describe('Agent IDs participating'),
    }),
    annotations: { readOnlyHint: false, title: 'Start Conversation' },
  },
  async ({ title, problem, participants }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getPragmaticConversation();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Pragmatic conversation engine not initialized' }],
          isError: true,
        };
      const result = engine.startSession({ title, problem, participants });
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return {
        content: [
          {
            type: 'text',
            text: `✅ Pragmatic conversation started!\n\n**Session ID:** ${result.session?.id}\n**Title:** ${title}\n**Problem:** ${problem}\n**Participants:** ${participants.join(', ')}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_add_conversation_turn',
  {
    description: 'Add a turn to a pragmatic conversation',
    inputSchema: z.object({
      sessionId: z.string().describe('Conversation session ID'),
      agentId: z.string().describe('Agent contributing'),
      content: z.string().describe('Message content'),
      role: z
        .enum(['system', 'user', 'agent', 'expert'])
        .optional()
        .describe('Role of the contributor'),
    }),
    annotations: { readOnlyHint: false, title: 'Add Turn' },
  },
  async ({ sessionId, agentId, content, role = 'agent' }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getPragmaticConversation();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Pragmatic conversation engine not initialized' }],
          isError: true,
        };
      const result = engine.addTurn(sessionId, agentId, content, role);
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      return {
        content: [
          {
            type: 'text',
            text: `✅ Turn added by ${agentId}\n\n**Content:** ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_resolve_conversation',
  {
    description: 'Resolve a conversation with solution and lessons learned',
    inputSchema: z.object({
      sessionId: z.string().describe('Conversation session ID'),
      solution: z.string().describe('Solution found'),
      lessonsLearned: z.array(z.string()).describe('Lessons to persist'),
      resolvedBy: z.string().describe('Agent who resolved'),
    }),
    annotations: { readOnlyHint: false, title: 'Resolve Conversation' },
  },
  async ({ sessionId, solution, lessonsLearned, resolvedBy }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getPragmaticConversation();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Pragmatic conversation engine not initialized' }],
          isError: true,
        };
      const result = engine.resolveConversation(sessionId, solution, lessonsLearned, resolvedBy);
      if (!result.success) {
        return { content: [{ type: 'text', text: `Error: ${result.error}` }], isError: true };
      }
      // Record as learning (DRY: reuse the facade's governed recordLearning).
      bos.recordLearning({
        type: 'fix',
        source: 'pragmatic-conversation',
        content: `Solved: ${solution}`,
        impact: 'high',
        relatedMission: sessionId,
      });
      return {
        content: [
          {
            type: 'text',
            text: `✅ Conversation resolved!\n\n**Solution:** ${solution}\n**Lessons:** ${lessonsLearned.length} recorded`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_conversation_report',
  {
    description: 'Generate full report for a pragmatic conversation',
    inputSchema: z.object({
      sessionId: z.string().describe('Conversation session ID'),
    }),
    annotations: { readOnlyHint: true, title: 'Conversation Report' },
  },
  async ({ sessionId }) => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getPragmaticConversation();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Pragmatic conversation engine not initialized' }],
          isError: true,
        };
      const report = engine.generateReport(sessionId);
      if (!report) {
        return {
          content: [{ type: 'text', text: `Session "${sessionId}" not found` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: report }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_conversations',
  {
    description: 'List all pragmatic conversations',
    inputSchema: z.object({}).passthrough().optional(),
    annotations: { readOnlyHint: true, title: 'List Conversations' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getPragmaticConversation();
      if (!engine)
        return {
          content: [{ type: 'text', text: 'Pragmatic conversation engine not initialized' }],
          isError: true,
        };
      const sessions = engine.listSessions();
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// ROLE & POLICY GOVERNANCE TOOLS
// ============================================================

server.registerTool(
  'bos_register_role',
  {
    description: 'Register a role with attached policy-rule ids for role-based governance',
    inputSchema: z.object({
      id: z.string().describe('Role id (how actors resolve to this role)'),
      name: z.string().describe('Role name'),
      displayName: z.string().describe('Human-readable display name'),
      responsibilities: z.array(z.string()).describe('Responsibility list'),
      policies: z.array(z.string()).optional().describe('Policy-rule ids attached to this role'),
      canAudit: z.boolean().optional().describe('Whether the role may audit'),
      canEnforce: z.boolean().optional().describe('Whether the role may enforce'),
      canTeach: z.boolean().optional().describe('Whether the role may teach behaviors'),
    }),
    annotations: { readOnlyHint: false, title: 'Register Role' },
  },
  async ({ id, name, displayName, responsibilities, policies, canAudit, canEnforce, canTeach }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.registerRole({
        id,
        name,
        displayName,
        responsibilities,
        policies,
        canAudit: canAudit ?? false,
        canEnforce: canEnforce ?? false,
        canTeach: canTeach ?? false,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_define_policy',
  {
    description:
      'Define a policy rule (condition/action/severity/applies-to) used by registered roles',
    inputSchema: z.object({
      id: z.string().describe('Policy-rule id'),
      name: z.string().describe('Policy name'),
      description: z.string().describe('What the policy demands and why'),
      condition: z
        .string()
        .describe(
          "Action matcher: '*' for any action, or an action prefix (e.g. 'deploy', 'git push')",
        ),
      action: z
        .enum(['require', 'warn', 'block', 'auto-fix'])
        .describe('Deterministic enforcement action'),
      severity: z
        .enum(['critical', 'high', 'medium', 'low', 'info'])
        .describe('Severity of a violation'),
      appliesTo: z
        .array(z.enum(['persona', 'role', 'agent', 'project']))
        .describe('Which actor facets the rule governs'),
      effectiveFrom: z.string().describe('ISO date from which the rule is effective'),
      effectiveUntil: z.string().optional().describe('Optional ISO expiry date'),
    }),
    annotations: { readOnlyHint: false, title: 'Define Policy' },
  },
  async ({
    id,
    name,
    description,
    condition,
    action,
    severity,
    appliesTo,
    effectiveFrom,
    effectiveUntil,
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.defineRolePolicy({
        id,
        name,
        description,
        condition,
        action,
        severity,
        appliesTo,
        effectiveFrom,
        effectiveUntil,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_evaluate_role_action',
  {
    description:
      'Evaluate an action against the role/policy registry — returns the deterministic decision',
    inputSchema: z.object({
      role: z.string().optional().describe('Actor role id or persona'),
      agentId: z.string().optional().describe('Actor agent id'),
      action: z.string().describe('The action about to be performed (e.g. deploy, git push)'),
    }),
    annotations: { readOnlyHint: true, title: 'Evaluate Role Action' },
  },
  async ({ role, agentId, action }) => {
    try {
      const bos = getBehaviorOS();
      const decision = bos.evaluateRoleAction({ role, agentId }, action);
      return { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_role_policy_report',
  {
    description:
      'Per-role audit report: decision counts by action and by role, plus the last decision',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, title: 'Role Policy Report' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const report = bos.getRolePolicyEngine().getReport();
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_list_roles',
  {
    description: 'List registered roles and policy rules of the role/policy engine',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, title: 'List Roles' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const engine = bos.getRolePolicyEngine();
      const result = { roles: engine.listRoles(), policies: engine.listPolicies() };
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// COGNITIVE LOAD BALANCER TOOLS (Feature 5: Balanceamento Cognitivo)
// ============================================================

server.registerTool(
  'bos_register_agent_capacity',
  {
    description: 'Register an agent with cognitive capacity and skills for load balancing',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      maxCapacity: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe('Maximum capacity before overload (0-1)'),
      skills: z.array(z.string()).default([]).describe('Agent skills'),
      completionRate: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe('Historical task completion rate'),
      fatigue: z.number().min(0).max(1).default(0).describe('Current fatigue factor (0-1)'),
    }),
    annotations: { readOnlyHint: false, title: 'Register Agent Capacity' },
  },
  async ({ agentId, maxCapacity, skills, completionRate, fatigue }) => {
    try {
      const bos = getBehaviorOS();
      bos.getCognitiveLoadBalancer().registerAgent(agentId, {
        maxCapacity,
        skills,
        completionRate,
        fatigue,
      });
      return {
        content: [{ type: 'text', text: `✅ Agent "${agentId}" registered for load balancing` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_assign_task',
  {
    description: 'Assign a task to an agent, tracking cognitive load',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      taskId: z.string().describe('Task ID'),
    }),
    annotations: { readOnlyHint: false, title: 'Assign Task' },
  },
  async ({ agentId, taskId }) => {
    try {
      const bos = getBehaviorOS();
      bos.getCognitiveLoadBalancer().assignTask(agentId, taskId);
      return {
        content: [{ type: 'text', text: `✅ Task "${taskId}" assigned to agent "${agentId}"` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_complete_task',
  {
    description: 'Mark a task as completed, reducing the agent cognitive load',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID'),
      taskId: z.string().describe('Task ID'),
    }),
    annotations: { readOnlyHint: false, title: 'Complete Task' },
  },
  async ({ agentId, taskId }) => {
    try {
      const bos = getBehaviorOS();
      bos.getCognitiveLoadBalancer().completeTask(agentId, taskId);
      return {
        content: [{ type: 'text', text: `✅ Task "${taskId}" completed for agent "${agentId}"` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_analyze_workload',
  {
    description: 'Analyze workload distribution and get balancing recommendations',
    inputSchema: z
      .object({
        maxLoadThreshold: z.number().optional().describe('Max load threshold (default 0.75)'),
        minLoadThreshold: z.number().optional().describe('Min load threshold (default 0.25)'),
        considerSkills: z.boolean().optional().describe('Consider skills in analysis'),
        considerFatigue: z.boolean().optional().describe('Consider fatigue in analysis'),
      })
      .passthrough()
      .optional(),
    annotations: { readOnlyHint: true, title: 'Analyze Workload' },
  },
  async (params?: {
    maxLoadThreshold?: number;
    minLoadThreshold?: number;
    considerSkills?: boolean;
    considerFatigue?: boolean;
  }) => {
    try {
      const bos = getBehaviorOS();
      const summary = bos.getCognitiveLoadBalancer().analyzeWorkload({
        maxLoadThreshold: params?.maxLoadThreshold ?? 0.75,
        minLoadThreshold: params?.minLoadThreshold ?? 0.25,
        considerSkills: params?.considerSkills ?? true,
        considerFatigue: params?.considerFatigue ?? true,
      });
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_recommend_assignment',
  {
    description: 'Recommend the best agent for a task based on load and skills',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      requiredSkills: z.array(z.string()).describe('Required skills for the task'),
    }),
    annotations: { readOnlyHint: true, title: 'Recommend Task Assignment' },
  },
  async ({ taskId, requiredSkills }) => {
    try {
      const bos = getBehaviorOS();
      const recommendation = bos
        .getCognitiveLoadBalancer()
        .recommendAssignment(taskId, requiredSkills);
      return { content: [{ type: 'text', text: JSON.stringify(recommendation, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// NATURAL LANGUAGE RULES TOOLS (Feature 6: Regras em Língua Natural)
// ============================================================

server.registerTool(
  'bos_parse_rule',
  {
    description: 'Parse a natural language governance rule into structured form',
    inputSchema: z.object({
      rule: z
        .string()
        .describe('Natural language rule, e.g. "Block production deploys when tests are failing"'),
      ruleId: z.string().optional().describe('Optional custom rule ID'),
    }),
    annotations: { readOnlyHint: true, title: 'Parse Natural Language Rule' },
  },
  async ({ rule, ruleId }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.getNaturalLanguageEngine().parseRule(rule, ruleId ? { ruleId } : {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_parse_rules_batch',
  {
    description: 'Parse multiple natural language rules in a single call',
    inputSchema: z.object({
      rules: z.array(z.string()).describe('Array of natural language rules to parse'),
    }),
    annotations: { readOnlyHint: true, title: 'Parse Rules Batch' },
  },
  async ({ rules }) => {
    try {
      const bos = getBehaviorOS();
      const results = bos.getNaturalLanguageEngine().parseRulesBatch(rules);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_apply_natural_language_rules',
  {
    description: 'Parse and apply natural language rules to a DNA pattern',
    inputSchema: z.object({
      dnaName: z.string().describe('DNA pattern name to modify'),
      rules: z.array(z.string()).describe('Natural language rules to apply'),
    }),
    annotations: { readOnlyHint: false, title: 'Apply NL Rules to DNA' },
  },
  async ({ dnaName, rules }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const dna = dnas[dnaName.toLowerCase()];
      if (!dna) {
        return {
          content: [{ type: 'text', text: `DNA pattern "${dnaName}" not found` }],
          isError: true,
        };
      }
      const result = bos.getNaturalLanguageEngine().applyRules(dna, rules);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ applied: result.applied, errors: result.errors }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// TEMPORAL GOVERNANCE TOOLS (Feature 7: Governança Temporal)
// ============================================================

server.registerTool(
  'bos_add_temporal_rule',
  {
    description:
      'Add a time-based governance rule that is only active during specific time windows (absolute, recurring/cron). Temporal rules wrap existing DNA governance rules with temporal constraints.',
    inputSchema: z.object({
      baseRuleId: z.string().describe('ID of the existing DNA governance rule to wrap'),
      rule: z.object({
        id: z.string().describe('ID of the temporal rule'),
        level: z.enum(['critical', 'high', 'medium', 'low']).describe('Severity level'),
        action: z
          .enum(['block', 'escalate', 'warn', 'log', 'transform'])
          .describe('Action to take when active'),
        conditions: z
          .array(z.object({ type: z.string(), value: z.unknown() }))
          .describe('Rule conditions'),
        description: z.string().optional().describe('Human-readable description'),
      }),
      scheduleType: z.enum(['absolute', 'recurring', 'cron']).describe('Schedule type'),
      startTime: z.string().optional().describe('ISO timestamp (for absolute)'),
      endTime: z.string().optional().describe('ISO timestamp (for absolute)'),
      schedule: z.string().optional().describe('Cron expression (e.g. "0 9-17 * * 1-5")'),
      reason: z.string().describe('Why this temporal rule exists'),
      authorizedBy: z.string().describe('Who authorized it'),
    }),
    annotations: { readOnlyHint: false, title: 'Add Temporal Rule' },
  },
  async ({
    baseRuleId,
    rule,
    scheduleType,
    startTime,
    endTime,
    schedule,
    reason,
    authorizedBy,
  }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.addTemporalRule({
        baseRuleId,
        rule,
        scheduleType,
        startTime,
        endTime,
        schedule,
        reason,
        authorizedBy,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_check_temporal',
  {
    description:
      'Evaluate temporal rules against a context to see which are active and which recommendations apply.',
    inputSchema: z.object({
      action: z.string().describe('The action being evaluated'),
      agentId: z.string().describe('Agent ID'),
      context: z.record(z.string(), z.unknown()).optional().describe('Context bag'),
      missionId: z.string().optional().describe('Related mission ID'),
    }),
    annotations: { readOnlyHint: true, title: 'Check Temporal Rules' },
  },
  async ({ action, agentId, context, missionId }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.evaluateTemporal({
        action,
        agentId,
        context: context ?? {},
        ...(missionId ? { missionId } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_evaluate_dna_temporal',
  {
    description:
      'Evaluate a DNA pattern with temporal overrides applied, returning the effective ruleset.',
    inputSchema: z.object({
      dnaName: z.string().describe('DNA pattern name (e.g. "lean-factory")'),
      action: z.string().describe('The action being evaluated'),
      agentId: z.string().describe('Agent ID'),
      context: z.record(z.string(), z.unknown()).optional().describe('Context bag'),
    }),
    annotations: { readOnlyHint: true, title: 'Evaluate DNA with Temporal Rules' },
  },
  async ({ dnaName, action, agentId, context }) => {
    try {
      const bos = getBehaviorOS();
      const dnas = await loadDNAPatterns();
      const dna = dnas[dnaName.toLowerCase()];
      if (!dna) {
        return {
          content: [{ type: 'text', text: `DNA pattern "${dnaName}" not found` }],
          isError: true,
        };
      }
      const result = bos.evaluateDNAWithTemporal(dna, {
        action,
        agentId,
        context: context ?? {},
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// KNOWLEDGE GRAPH TOOLS (G-001)
// ============================================================

server.registerTool(
  'bos_add_knowledge_node',
  {
    description:
      'Add a node to the knowledge graph (agent, mission, rule, learning, decision, etc.)',
    inputSchema: z.object({
      id: z.string().describe('Unique node ID'),
      type: z
        .enum([
          'agent',
          'mission',
          'rule',
          'learning',
          'decision',
          'pattern',
          'dna',
          'audit',
          'task',
        ])
        .describe('Node type'),
      label: z.string().describe('Human-readable label'),
      properties: z.record(z.string(), z.unknown()).optional().describe('Structured properties'),
    }),
    annotations: { readOnlyHint: false, title: 'Add Knowledge Node' },
  },
  async ({ id, type, label, properties }) => {
    try {
      const bos = getBehaviorOS();
      bos.addKnowledgeNode({
        id,
        type,
        label,
        properties: properties ?? {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { content: [{ type: 'text', text: `Node "${id}" added to knowledge graph` }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_add_knowledge_edge',
  {
    description: 'Add an edge to the knowledge graph representing a relationship between nodes',
    inputSchema: z.object({
      id: z.string().describe('Unique edge ID'),
      from: z.string().describe('Source node ID'),
      to: z.string().describe('Target node ID'),
      type: z
        .enum([
          'GOVERNED_BY',
          'PART_OF',
          'CAUSES',
          'RELATED_TO',
          'TRIGGERED',
          'EVIDENCE_FOR',
          'TRANSFORMS',
          'SIMILAR_TO',
          'OBSERVED_IN',
          'IMPLEMENTS',
        ])
        .describe('Relationship type'),
      weight: z.number().min(0).max(1).default(1).optional().describe('Edge weight (0-1)'),
      properties: z.record(z.string(), z.unknown()).optional().describe('Edge properties'),
    }),
    annotations: { readOnlyHint: false, title: 'Add Knowledge Edge' },
  },
  async ({ id, from, to, type, weight, properties }) => {
    try {
      const bos = getBehaviorOS();
      bos.addKnowledgeEdge({
        id,
        from,
        to,
        type,
        weight: weight ?? 1,
        properties: properties ?? undefined,
        createdAt: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: `Edge "${id}" added: ${from} --[${type}]--> ${to}` }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_query_knowledge_graph',
  {
    description: 'Query the knowledge graph with traversal and filtering',
    inputSchema: z.object({
      startNode: z.string().optional().describe('Starting node ID or "*" for all'),
      nodeType: z
        .enum([
          'agent',
          'mission',
          'rule',
          'learning',
          'decision',
          'pattern',
          'dna',
          'audit',
          'task',
          'any',
        ])
        .optional()
        .describe('Filter by node type'),
      edgeType: z
        .enum([
          'GOVERNED_BY',
          'PART_OF',
          'CAUSES',
          'RELATED_TO',
          'TRIGGERED',
          'EVIDENCE_FOR',
          'TRANSFORMS',
          'SIMILAR_TO',
          'OBSERVED_IN',
          'IMPLEMENTS',
          'any',
        ])
        .optional()
        .describe('Filter by edge type'),
      depth: z.number().min(1).max(10).default(3).optional().describe('Maximum traversal depth'),
      properties: z.record(z.string(), z.unknown()).optional().describe('Property filters'),
      sortBy: z.enum(['createdAt', 'weight', 'label']).optional().describe('Sort results'),
    }),
    annotations: { readOnlyHint: true, title: 'Query Knowledge Graph' },
  },
  async ({ startNode, nodeType, edgeType, depth, properties, sortBy }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.queryKnowledgeGraph({
        startNode: startNode === '*' ? undefined : startNode,
        nodeType: nodeType ?? 'any',
        edgeType: edgeType ?? 'any',
        depth: depth ?? 3,
        properties: properties ?? undefined,
        sortBy: sortBy ?? 'createdAt',
        sortOrder: 'desc',
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_get_knowledge_graph_stats',
  {
    description:
      'Get statistics about the knowledge graph (node/edge counts, types, average degree)',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, title: 'Knowledge Graph Stats' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const stats = bos.getKnowledgeGraphStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// META-COGNITION TOOLS (G-002)
// ============================================================

server.registerTool(
  'bos_create_meta_decision',
  {
    description:
      'Create a meta-decision from a governance evaluation with reasoning path, confidence, and bias detection',
    inputSchema: z.object({
      decision: z.record(z.string(), z.unknown()).describe('Governance decision'),
      context: z.record(z.string(), z.unknown()).optional().describe('Context bag'),
      agentId: z.string().optional().describe('Agent ID'),
      dnaPattern: z.string().optional().describe('DNA pattern name'),
    }),
    annotations: { readOnlyHint: false, title: 'Create Meta Decision' },
  },
  async ({ decision, context, agentId, dnaPattern }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.createMetaDecision(decision as GovernanceDecision, {
        context: context ?? {},
        agentId: agentId ?? bos.resolveAgentIdentity().agentId ?? 'unknown',
        dnaPattern,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_get_meta_cognition_stats',
  {
    description: 'Get statistics about the meta-cognition engine',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, title: 'Meta Cognition Stats' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const stats = bos.getMetaCognitionStats();
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// PERSISTENT MEMORY TOOLS (G-003)
// ============================================================

server.registerTool(
  'bos_save_memory',
  {
    description: 'Save a memory (knowledge graph node) to persistent storage',
    inputSchema: z.object({
      id: z.string().describe('Unique node ID'),
      type: z
        .enum([
          'agent',
          'mission',
          'rule',
          'learning',
          'decision',
          'pattern',
          'dna',
          'audit',
          'task',
        ])
        .describe('Node type'),
      label: z.string().describe('Human-readable label'),
      properties: z.record(z.string(), z.unknown()).optional().describe('Structured properties'),
      relevanceScore: z.number().min(0).max(1).optional().describe('Relevance score (0-1)'),
      expiresAt: z.string().optional().describe('Optional expiration timestamp (ISO)'),
    }),
    annotations: { readOnlyHint: false, title: 'Save Memory' },
  },
  async ({ id, type, label, properties, relevanceScore, expiresAt }) => {
    try {
      const bos = getBehaviorOS();
      bos.saveMemory(
        {
          id,
          type,
          label,
          properties: properties ?? {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { relevanceScore, expiresAt },
      );
      return { content: [{ type: 'text', text: `Memory "${id}" saved to persistent storage` }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_recall_memory',
  {
    description: 'Recall a memory by node ID from persistent storage',
    inputSchema: z.object({
      nodeId: z.string().describe('Node ID to recall'),
    }),
    annotations: { readOnlyHint: true, title: 'Recall Memory' },
  },
  async ({ nodeId }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.recallMemory(nodeId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_recall_relevant',
  {
    description: 'Recall memories relevant to a context via graph traversal',
    inputSchema: z.object({
      startNodeId: z.string().describe('Starting node ID for traversal'),
      maxDepth: z.number().min(1).max(10).default(3).optional().describe('Maximum traversal depth'),
      minScore: z
        .number()
        .min(0)
        .max(1)
        .default(0.3)
        .optional()
        .describe('Minimum relevance score'),
      nodeTypes: z.array(z.string()).optional().describe('Filter by node types'),
    }),
    annotations: { readOnlyHint: true, title: 'Recall Relevant Memories' },
  },
  async ({ startNodeId, maxDepth, minScore, nodeTypes }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.recallRelevant(startNodeId, { maxDepth, minScore, nodeTypes });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_reconstruct_context',
  {
    description: 'Reconstruct agent context from past missions, decisions, and learnings',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID to reconstruct context for'),
    }),
    annotations: { readOnlyHint: true, title: 'Reconstruct Agent Context' },
  },
  async ({ agentId }) => {
    try {
      const bos = getBehaviorOS();
      const result = bos.reconstructContext(agentId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'bos_consolidate_memory',
  {
    description: 'Consolidate in-memory knowledge graph state to persistent storage',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, title: 'Consolidate Memory' },
  },
  async () => {
    try {
      const bos = getBehaviorOS();
      const result = bos.consolidateMemory();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ============================================================
// START SERVER
// ============================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Behavior-OS MCP Server running on stdio');
}

// Only bootstrap the stdio server when this module is executed directly, not
// when it is imported by tests (which use InMemoryTransport instead).
// pathToFileURL keeps this check synchronous: the previous `createRequire`
// implementation required this ESM module from itself, which throws
// ERR_REQUIRE_ASYNC_MODULE on Node 24 and left the server unstarted.
const isEntry =
  typeof process !== 'undefined' &&
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
