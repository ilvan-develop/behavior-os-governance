import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { Info as PluginToolInfo } from '@opencode/plugin/promise/tool';
import { load as yamlLoad } from 'js-yaml';
import { buildGovernanceContext, classifyDNA } from './governance.js';

// Global state for this plugin instance
let behaviorOS: BehaviorOS | null = null;
let loadedDnaPatterns: Map<string, DNA> = new Map();

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS();
  }
  return behaviorOS;
}

/** Tools that can mutate state or shell out and therefore need governance. */
const GOVERNED_TOOL = /bash|write|edit|patch|apply|shell|mcp__/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

// Load DNA patterns from YAML files
async function loadDNAFromDirectory(dirPath: string): Promise<Map<string, DNA>> {
  const patterns = new Map<string, DNA>();
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        try {
          const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
          const dna = parseYAML(content);
          const name = file.replace(/\.(yaml|yml)$/, '');
          if (dna && typeof dna === 'object') {
            patterns.set(name, dna as DNA);
          }
        } catch (error) {
          console.warn(`Warning: Failed to parse ${file}: ${error}`);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read DNA directory: ${dirPath}`);
  }
  return patterns;
}

// YAML parser using js-yaml (same parser as the MCP server and CLI)
function parseYAML(content: string): Record<string, unknown> | null {
  try {
    const parsed = yamlLoad(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// Predefined DNA patterns (fallback)
const DNA_PATTERNS: Readonly<Record<string, DNA>> = {
  'surgical-team': {
    name: 'Surgical Team',
    version: '2.0.0',
    description: 'Zero-defect governance with sterile field protocols',
    personas: [
      {
        role: 'architect' as const,
        name: 'Lead Surgeon',
        authority: 'architect' as const,
        boundaries: [{ id: 'max-modules', type: 'max_modules', value: 1 }],
        skills: ['surgical-procedure', 'team-leadership', 'clinical-decision'],
      },
    ],
    governance: [
      {
        id: 'sterile-field',
        level: 'critical' as const,
        action: 'block' as const,
        conditions: [{ type: 'production', value: true }],
        description: 'Block any non-approved production changes',
      },
    ],
    quality: [
      { id: 'zero-defect', type: 'test_coverage', threshold: 100 },
      { id: 'no-lint', type: 'lint', threshold: 0 },
      { id: 'no-security', type: 'security', threshold: 0 },
    ],
  },
};

// The 7-step protocol definition
interface ProtocolStep {
  number: number;
  name: string;
  tool: string;
}

const PROTOCOL_STEPS: ProtocolStep[] = [
  { number: 1, name: 'Select DNA Pattern', tool: 'bos_select_dna' },
  { number: 2, name: 'Display DNA Block', tool: 'bos_list_dna' },
  { number: 3, name: 'Resolve Truth', tool: 'bos_get_state' },
  { number: 4, name: 'Create Mission', tool: 'bos_create_mission' },
  { number: 5, name: 'Delegate', tool: 'bos_start_mission' },
  { number: 6, name: 'Run Audit', tool: 'bos_run_audit' },
  { number: 7, name: 'Record Learning', tool: 'bos_record_learning' },
];

export default Plugin.define({
  id: 'behavior-os',
  async setup(ctx: Context): Promise<void> {
    const bos = getBehaviorOS();

    // Load DNA patterns from directory
    try {
      const dnasDir = process.env.BEHAVIOROS_DNA_PATH
        ? path.resolve(process.env.BEHAVIOROS_DNA_PATH)
        : path.join(ctx.location.directory, 'dnas');
      loadedDnaPatterns = await loadDNAFromDirectory(dnasDir);

      // Merge with built-in patterns
      for (const [key, pattern] of Object.entries(DNA_PATTERNS)) {
        if (!loadedDnaPatterns.has(key)) {
          loadedDnaPatterns.set(key, pattern);
        }
      }

      console.log(`Loaded ${loadedDnaPatterns.size} DNA patterns`);
    } catch (error) {
      console.warn('Failed to load DNA patterns from directory, using built-in patterns');
      // Use built-in patterns
      for (const [key, pattern] of Object.entries(DNA_PATTERNS)) {
        loadedDnaPatterns.set(key, pattern);
      }
    }

    await ctx.tool.transform((editor) => {
      // Register every bos_* tool as a direct (non-Code-Mode) tool. In v2,
      // tools default to Code Mode exposure (options.codemode defaults to true)
      // which makes them invokable only through the execute tool. codemode:false
      // exposes them as first-class tools the agent can call by name.
      const tools = {
        add: (tool: PluginToolInfo) => editor.add({ ...tool, options: { codemode: false } }),
      };

      // Tool 1: bos_evaluate_governance
      tools.add({
        name: 'bos_evaluate_governance',
        description: 'Evaluate governance rules for an action',
        input: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            agent: { type: 'string' },
            context: { type: 'object' },
          },
          required: ['action', 'agent'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            action: string;
            agent: string;
            context?: Record<string, unknown>;
          };
          const result = bos.evaluateGovernance(params.action, {
            agent: params.agent,
            context: params.context ?? {},
          });
          return {
            content: JSON.stringify(result, null, 2),
          };
        },
      });

      // Tool 2: bos_select_dna
      tools.add({
        name: 'bos_select_dna',
        description: 'Select a DNA pattern for governance',
        input: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              enum: Array.from(loadedDnaPatterns.keys()),
            },
          },
          required: ['pattern'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { pattern: string };
          const dna = loadedDnaPatterns.get(params.pattern);
          if (!dna) {
            return {
              content: `Pattern "${params.pattern}" not found. Available: ${Array.from(loadedDnaPatterns.keys()).join(', ')}`,
            };
          }
          await bos.loadDNA(dna);
          return {
            content: `DNA pattern "${params.pattern}" selected. Governance rules activated.`,
          };
        },
      });

      // Tool 3: bos_list_dna
      tools.add({
        name: 'bos_list_dna',
        description: 'List all available DNA patterns',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const patterns = Array.from(loadedDnaPatterns.entries()).map(([key, dna]) => ({
            id: key,
            name: dna.name,
            version: dna.version,
            description: dna.description,
            governanceRules: dna.governance.length,
            personas: dna.personas.length,
            qualityGates: dna.quality.length,
          }));
          bos.advanceProtocolStep('bos_list_dna');
          return {
            content: JSON.stringify({ patterns, total: patterns.length }, null, 2),
          };
        },
      });

      // Tool 4: bos_create_mission
      tools.add({
        name: 'bos_create_mission',
        description: 'Create a new mission in Behavior-OS',
        input: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'feature',
                'bugfix',
                'deployment',
                'research',
                'refactor',
                'audit',
                'incident',
              ],
            },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          },
          required: ['title', 'type', 'priority'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { title: string; type: string; priority: string };
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
          });
          return {
            content: `Mission created: ${mission.id}`,
          };
        },
      });

      // Tool 5: bos_start_mission
      tools.add({
        name: 'bos_start_mission',
        description: 'Start a mission by ID',
        input: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
          },
          required: ['missionId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { missionId: string };
          const mission = bos.startMission(params.missionId);
          if (!mission) {
            return {
              content: `Mission "${params.missionId}" not found`,
            };
          }
          return {
            content: `Mission "${params.missionId}" started. Status: ${mission.status}`,
          };
        },
      });

      // Tool 6: bos_list_missions
      tools.add({
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
          const missions = bos.listMissions(params.limit ?? 50);
          return {
            content: JSON.stringify(missions, null, 2),
          };
        },
      });

      // Tool 7: bos_run_audit
      tools.add({
        name: 'bos_run_audit',
        description: 'Run audit pipeline for a mission',
        input: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            agentId: { type: 'string' },
            stages: { type: 'array', items: { type: 'string' } },
          },
          required: ['missionId', 'agentId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { missionId: string; agentId: string; stages?: string[] };
          const report = bos.runAudit({
            missionId: params.missionId,
            agentId: params.agentId,
            stages: params.stages,
          });
          return {
            content: `Audit complete: ${report.overall}`,
          };
        },
      });

      // Tool 8: bos_check_quality
      tools.add({
        name: 'bos_check_quality',
        description: 'Check quality metrics against governance gates',
        input: {
          type: 'object',
          properties: {
            metrics: {
              type: 'object',
              additionalProperties: { type: 'number' },
            },
          },
          required: ['metrics'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { metrics: Record<string, number> };
          const result = bos.checkQuality(params.metrics);
          return {
            content: JSON.stringify(result, null, 2),
          };
        },
      });

      // Tool 9: bos_get_insights
      tools.add({
        name: 'bos_get_insights',
        description: 'Get high-impact insights from learning engine',
        input: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { limit?: number };
          const insights = bos.getInsights(params.limit ?? 10);
          return {
            content: JSON.stringify(insights, null, 2),
          };
        },
      });

      // Tool 10: bos_record_learning
      tools.add({
        name: 'bos_record_learning',
        description: 'Record a learning event',
        input: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['insight', 'pattern', 'fix', 'failure', 'optimization'],
            },
            source: { type: 'string' },
            content: { type: 'string' },
            impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            relatedMission: { type: 'string' },
          },
          required: ['type', 'source', 'content', 'impact'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            type: string;
            source: string;
            content: string;
            impact: string;
            relatedMission?: string;
          };
          const event = bos.recordLearning({
            type: params.type as 'insight' | 'pattern' | 'fix' | 'failure' | 'optimization',
            source: params.source,
            content: params.content,
            impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
            relatedMission: params.relatedMission,
          });
          return {
            content: `Learning recorded: ${event.id}`,
          };
        },
      });

      // Tool 11: bos_get_status
      tools.add({
        name: 'bos_get_status',
        description: 'Get current Behavior-OS status',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const status = bos.getStatus();
          return {
            content: JSON.stringify(status, null, 2),
          };
        },
      });

      // Tool 12: bos_get_state
      tools.add({
        name: 'bos_get_state',
        description: 'Get current protocol state',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          bos.advanceProtocolStep('bos_get_state');
          const state = bos.getState();
          return {
            content: JSON.stringify(state, null, 2),
          };
        },
      });
    });

    // --- Governance enforcement ---------------------------------------------
    // OpenCode v2's only typed denial mechanism is the permission hook. We set
    // `effect` to deny/ask (never force `allow`), so configured denials stay final.
    await ctx.permission.hook('evaluate', async (event): Promise<void> => {
      const currentState = bos.getState();
      if (!currentState.selectedDna) return;

      try {
        const context = buildGovernanceContext({
          tool: event.action,
          action: event.action,
          resources: event.resources,
          metadata: event.metadata,
        });
        const decision = bos.evaluateGovernance(event.action, {
          agent: event.agent ?? 'opencode-agent',
          context,
        });

        if (decision.verdict === 'deny') {
          event.effect = 'deny';
          event.message = `[Behavior-OS:${currentState.selectedDna}] ${decision.reason}`;
        } else if (decision.verdict === 'escalate' && event.effect !== 'deny') {
          event.effect = 'ask';
          event.message = `[Behavior-OS:${currentState.selectedDna}] ${decision.reason}`;
        }
      } catch (error) {
        console.warn(`[Behavior-OS] Permission evaluation error: ${describeError(error)}`);
      }
    });

    // Observability hook: advise on escalations before a governed tool runs.
    // It never throws — enforcement is the permission hook's responsibility.
    await ctx.tool.hook('execute.before', async (event: unknown): Promise<void> => {
      const eventTyped = event as { tool?: string; agent?: string; input?: unknown };
      const currentState = bos.getState();
      if (!currentState.selectedDna) return;

      const toolName = typeof eventTyped.tool === 'string' ? eventTyped.tool.toLowerCase() : '';
      if (!GOVERNED_TOOL.test(toolName)) return;

      try {
        const context = buildGovernanceContext({
          tool: toolName,
          metadata: asRecord(eventTyped.input),
        });
        const decision = bos.evaluateGovernance(toolName, {
          agent: eventTyped.agent ?? 'opencode-agent',
          context,
        });
        if (decision.verdict === 'escalate') {
          console.warn(`[Behavior-OS] Escalation advised: ${decision.reason}`);
        }
      } catch (error) {
        console.warn(`[Behavior-OS] Governance error: ${describeError(error)}`);
      }
    });

    // Capture tool failures as learning events (without advancing the protocol).
    await ctx.tool.hook('execute.after', async (event): Promise<void> => {
      if (event.status !== 'error') return;
      const currentState = bos.getState();
      if (!currentState.selectedDna) return;
      try {
        bos.recordLearning({
          type: 'failure',
          source: `tool:${event.tool}`,
          content: event.error.message,
          impact: 'medium',
          relatedPattern: currentState.selectedDna,
          advanceProtocol: false,
        });
      } catch (error) {
        console.warn(`[Behavior-OS] Learning capture error: ${describeError(error)}`);
      }
    });

    // Intelligent DNA selection: classify the user's prompt and auto-select a
    // matching pattern when none is active yet.
    await ctx.session.hook('prompt', async (event): Promise<void> => {
      const text = event.prompt?.text?.trim() ?? '';
      if (!text) return;
      if (bos.getState().selectedDna) return;

      const match = classifyDNA(text, loadedDnaPatterns.keys());
      if (!match) return;
      const dna = loadedDnaPatterns.get(match);
      if (!dna) return;

      await bos.loadDNA(dna);
      event.metadata = { ...(event.metadata ?? {}), behavioros: { autoSelectedDna: match } };
      console.log(`[Behavior-OS] Auto-selected DNA "${match}" from prompt intent`);
    });

    // Session context hook - surface BehaviorOS state to the model. Always
    // injects guidance so cold-start agents are governed too.
    await ctx.session.hook('context', async (event): Promise<void> => {
      const currentState = bos.getState();
      const patterns = Array.from(loadedDnaPatterns.keys()).join(', ');

      if (currentState.selectedDna) {
        const nextStep: ProtocolStep | undefined = PROTOCOL_STEPS[currentState.currentStep];
        const stepLine = nextStep
          ? `Protocol step ${currentState.currentStep + 1}/${PROTOCOL_STEPS.length}: ${nextStep.name} (use ${nextStep.tool})`
          : `Protocol complete (${PROTOCOL_STEPS.length}/${PROTOCOL_STEPS.length})`;
        event.system.push({
          type: 'text',
          text: [
            `[Behavior-OS] Active DNA: ${currentState.selectedDna}`,
            stepLine,
            `Available DNA patterns (${loadedDnaPatterns.size}): ${patterns}`,
          ].join('\n'),
        });
        return;
      }

      event.system.push({
        type: 'text',
        text: [
          '[Behavior-OS] No DNA pattern selected yet.',
          'Before mutating files or running risky commands, call bos_select_dna with the pattern that best matches the task.',
          `Available DNA patterns (${loadedDnaPatterns.size}): ${patterns}`,
          'Then follow the 7-step protocol: select DNA -> list DNA -> get state -> create mission -> start mission -> run audit -> record learning.',
        ].join('\n'),
      });
    });
  },
});
