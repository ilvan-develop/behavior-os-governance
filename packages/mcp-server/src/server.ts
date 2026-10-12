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
      const dnas = await loadDNAPatterns();
      const patterns = Object.entries(dnas).map(([key, dna]) => ({
        key,
        name: dna.name,
        version: dna.version,
        description: dna.description,
        governanceRules: dna.governance?.length ?? 0,
      }));
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
      description: z.string().optional().describe('Mission description'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    }),
    annotations: {
      title: 'Create Mission',
    },
  },
  async ({ title, type, priority }) => {
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
  async ({ limit = 50 }: { limit?: number }) => {
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
