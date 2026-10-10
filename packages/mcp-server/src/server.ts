import { BehaviorOS } from '@behavior-os/core';
import type {
  DNA,
  LearningImpact,
  LearningType,
  MissionPriority,
  MissionType,
} from '@behavior-os/schemas';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Global behaviorOS instance
let behaviorOS: BehaviorOS | null = null;

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS({
      dnaPath: process.env.BEHAVIOROS_DNA_PATH,
    });
  }
  return behaviorOS;
}

// Create MCP server
const server = new McpServer({
  name: 'behavioros',
  version: '2.0.0',
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
      const decision = bos.evaluateGovernance(action, {
        agent,
        scope,
        ...context,
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
      description: z.string().optional().describe('Mission description'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    }),
    annotations: {
      title: 'Create Mission',
    },
  },
  async ({ title, type, priority, description, tags }) => {
    try {
      const bos = getBehaviorOS();
      const mission = bos.createMission({
        title,
        type: type as MissionType,
        priority: priority as MissionPriority,
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
    }),
    annotations: {
      title: 'Start Mission',
    },
  },
  async ({ missionId }) => {
    try {
      const bos = getBehaviorOS();
      const mission = bos.startMission(missionId);
      if (!mission) {
        return {
          content: [{ type: 'text', text: `Mission "${missionId}" not found` }],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text', text: `Mission "${missionId}" started. Status: ${mission.status}` },
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
      const missions = bos.listMissions?.(limit) ?? [];
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

// ============================================================
// QUALITY TOOLS
// ============================================================

server.registerTool(
  'bos_run_audit',
  {
    description: 'Run a full audit pipeline for a mission',
    inputSchema: z.object({
      missionId: z.string().describe('Mission ID'),
      agentId: z.string().describe('Agent ID'),
      stages: z.array(z.string()).optional().describe('Stages to audit'),
    }),
    annotations: {
      title: 'Run Audit',
    },
  },
  async ({
    missionId,
    agentId,
    stages,
  }: {
    missionId: string;
    agentId: string;
    stages?: string[];
  }) => {
    try {
      const bos = getBehaviorOS();
      const report = bos.runAudit({ missionId, agentId, stages });
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

// ============================================================
// LEARNING TOOLS
// ============================================================

server.registerTool(
  'bos_record_learning',
  {
    description: 'Record a learning event for pattern detection',
    inputSchema: z.object({
      type: z
        .enum(['insight', 'pattern', 'fix', 'failure', 'optimization'])
        .describe('Learning type'),
      source: z.string().describe('Source of the learning'),
      content: z.string().describe('Learning content'),
      impact: z.enum(['low', 'medium', 'high', 'critical']).describe('Impact level'),
      relatedMission: z.string().optional().describe('Related mission ID'),
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
  }: {
    type: string;
    source: string;
    content: string;
    impact: string;
    relatedMission?: string;
  }) => {
    try {
      const bos = getBehaviorOS();
      const event = bos.recordLearning({
        type: type as LearningType,
        source,
        content,
        impact: impact as LearningImpact,
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
        text: '# Behavior-OS 7-Step Protocol\n\n1. Select DNA Pattern\n2. Display DNA Block\n3. Resolve Truth\n4. Create Mission\n5. Delegate Task\n6. Run Audit\n7. Record Learning',
      },
    ],
  }),
);

server.registerResource(
  'behavioros://dna/catalog',
  'behavioros://dna/catalog',
  { mimeType: 'application/json', description: 'DNA Catalog' },
  async () => ({
    contents: [
      {
        uri: 'behavioros://dna/catalog',
        text: JSON.stringify(
          {
            available: [
              'surgical-team',
              'enterprise-governance',
              'military-operations',
              'lean-factory',
            ],
            default: 'enterprise-governance',
          },
          null,
          2,
        ),
      },
    ],
  }),
);

// ============================================================
// DNA PATTERNS (Predefined)
// ============================================================

async function loadDNAPatterns(): Promise<Record<string, DNA>> {
  return {
    'surgical-team': {
      name: 'Surgical Team',
      version: '2.0.0',
      description: 'Zero-defect governance with sterile field protocols',
      personas: [
        {
          role: 'architect',
          name: 'Lead Surgeon',
          authority: 'architect',
          boundaries: [{ id: 'max-modules', type: 'max_modules', value: 1 }],
          skills: ['surgical-procedure', 'team-leadership', 'clinical-decision'],
        },
      ],
      governance: [
        {
          id: 'sterile-field',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'production', value: true }],
          description: 'Block any non-approved production changes',
        },
        {
          id: 'timeout-verification',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'deployment', value: true }],
          description: 'Escalate all deployment actions',
        },
      ],
      quality: [
        { id: 'zero-defect', type: 'test_coverage', threshold: 100 },
        { id: 'no-lint', type: 'lint', threshold: 0 },
        { id: 'no-security', type: 'security', threshold: 0 },
      ],
    },
    'enterprise-governance': {
      name: 'Enterprise Governance',
      version: '2.0.0',
      description: 'Compliance-focused governance for regulated industries',
      personas: [
        {
          role: 'operator',
          name: 'Compliance Officer',
          authority: 'operator',
          skills: ['compliance', 'audit', 'reporting'],
        },
      ],
      governance: [
        {
          id: 'change-management',
          level: 'critical',
          action: 'escalate',
          conditions: [{ type: 'change', value: true }],
          description: 'All changes must be reviewed',
        },
        {
          id: 'data-protection',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'pii-access', value: true }],
          description: 'Block unauthorized PII access',
        },
      ],
      quality: [
        { id: 'coverage', type: 'test_coverage', threshold: 80 },
        { id: 'lint', type: 'lint', threshold: 0 },
      ],
    },
    'military-operations': {
      name: 'Military Operations',
      version: '2.0.0',
      description: 'Chain of command and mission-focused operations',
      personas: [
        {
          role: 'operator',
          name: 'Mission Commander',
          authority: 'admin',
          skills: ['strategy', 'command', 'execution'],
        },
      ],
      governance: [
        {
          id: 'chain-of-command',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'critical-action', value: true }],
          description: 'Critical actions require commander approval',
        },
      ],
      quality: [{ id: 'coverage', type: 'test_coverage', threshold: 75 }],
    },
    'lean-factory': {
      name: 'Lean Factory',
      version: '2.0.0',
      description: 'Continuous improvement and waste elimination',
      personas: [
        {
          role: 'operator',
          name: 'Process Engineer',
          authority: 'operator',
          skills: ['optimization', 'kaizen', 'value-stream'],
        },
      ],
      governance: [
        {
          id: 'waste-elimination',
          level: 'medium',
          action: 'warn',
          conditions: [{ type: 'redundant-action', value: true }],
          description: 'Warn on redundant operations',
        },
      ],
      quality: [{ id: 'coverage', type: 'test_coverage', threshold: 70 }],
    },
  };
}

// ============================================================
// START SERVER
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Behavior-OS MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
