import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';

// Global state for this plugin instance
let behaviorOS: BehaviorOS | null = null;
let loadedDnaPatterns: Map<string, DNA> = new Map();

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS();
  }
  return behaviorOS;
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

// Simple YAML parser (for basic structures)
function parseYAML(content: string): Record<string, unknown> | null {
  try {
    // Use a simple approach: convert YAML to JSON-like structure
    const lines = content.split('\n');
    const result: Record<string, unknown> = {};
    let currentArray: string | null = null;
    const currentObject: Record<string, unknown> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Simple key-value parsing
      if (trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':');
        const value = valueParts.join(':').trim();

        if (value.startsWith("['")) {
          // Array value
          currentArray = key;
          currentObject[key] = [];
        } else if (value) {
          currentObject[key] = value.replace(/"/g, '');
        }
      }
    }

    return currentObject;
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
  { number: 2, name: 'Display DNA Block', tool: 'visual' },
  { number: 3, name: 'Resolve Truth', tool: 'bos_resolve_truth' },
  { number: 4, name: 'Create Mission', tool: 'create-mission' },
  { number: 5, name: 'Delegate', tool: 'task' },
  { number: 6, name: 'Run Audit', tool: 'bos_run_audit' },
  { number: 7, name: 'Record Learning', tool: 'record-learning' },
];

export default Plugin.define({
  id: 'behavior-os',
  async setup(ctx: Context): Promise<void> {
    const bos = getBehaviorOS();

    // Load DNA patterns from directory
    try {
      const dnasDir = path.join(process.cwd(), 'dnas');
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

    ctx.tool.transform((tools) => {
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
        execute: async (input: unknown): Promise<{ content: string; output: unknown }> => {
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
            output: result,
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
        execute: async (input: unknown): Promise<{ content: string; output: unknown }> => {
          const params = input as { pattern: string };
          const dna = loadedDnaPatterns.get(params.pattern);
          if (!dna) {
            return {
              content: `Pattern "${params.pattern}" not found. Available: ${Array.from(loadedDnaPatterns.keys()).join(', ')}`,
              output: { error: `Pattern "${params.pattern}" not found` },
            };
          }
          await bos.loadDNA(dna);
          return {
            content: `DNA pattern "${params.pattern}" selected. Governance rules activated.`,
            output: { selected: params.pattern, name: dna.name },
          };
        },
      });

      // Tool 3: bos_list_dna
      tools.add({
        name: 'bos_list_dna',
        description: 'List all available DNA patterns',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string; output: unknown }> => {
          const patterns = Array.from(loadedDnaPatterns.entries()).map(([key, dna]) => ({
            id: key,
            name: dna.name,
            version: dna.version,
            description: dna.description,
            governanceRules: dna.governance.length,
            personas: dna.personas.length,
            qualityGates: dna.quality.length,
          }));
          return {
            content: JSON.stringify({ patterns, total: patterns.length }, null, 2),
            output: { patterns, total: patterns.length },
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
        execute: async (input: unknown): Promise<{ content: string; output: { id: string } }> => {
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
            output: { id: mission.id },
          };
        },
      });

      // Tool 5: bos_run_audit
      tools.add({
        name: 'bos_run_audit',
        description: 'Run audit pipeline for a mission',
        input: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            agentId: { type: 'string' },
          },
          required: ['missionId', 'agentId'],
        },
        execute: async (input: unknown): Promise<{ content: string; output: unknown }> => {
          const params = input as { missionId: string; agentId: string };
          const report = bos.runAudit({ missionId: params.missionId, agentId: params.agentId });
          return {
            content: `Audit complete: ${report.overall}`,
            output: report,
          };
        },
      });

      // Tool 6: bos_record_learning
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
          },
          required: ['type', 'source', 'content', 'impact'],
        },
        execute: async (input: unknown): Promise<{ content: string; output: unknown }> => {
          const params = input as { type: string; source: string; content: string; impact: string };
          const event = bos.recordLearning({
            type: params.type as 'insight' | 'pattern' | 'fix' | 'failure' | 'optimization',
            source: params.source,
            content: params.content,
            impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
          });
          return {
            content: `Learning recorded: ${event.id}`,
            output: event,
          };
        },
      });

      // Tool 7: bos_get_status
      tools.add({
        name: 'bos_get_status',
        description: 'Get current Behavior-OS status',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string; output: unknown }> => {
          const status = bos.getStatus();
          return {
            content: JSON.stringify(status, null, 2),
            output: status,
          };
        },
      });

      // Tool 8: bos_get_state
      tools.add({
        name: 'bos_get_state',
        description: 'Get current protocol state',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string; output: unknown }> => {
          const state = bos.getState();
          return {
            content: JSON.stringify(state, null, 2),
            output: state,
          };
        },
      });
    });

    // Governance hook for write/edit/bash tools
    ctx.tool.hook('execute.before', async (event: unknown): Promise<void> => {
      const eventTyped = event as {
        tool?: string;
        agent?: string;
        input?: Record<string, unknown>;
      };
      const currentState = bos.getState();

      if (!currentState.selectedDna) return;

      const toolName = typeof eventTyped.tool === 'string' ? eventTyped.tool.toLowerCase() : '';
      const governanceTools = ['bash', 'write', 'edit', 'mcp__'];
      const isGoverned = governanceTools.some((t) => toolName.includes(t));

      if (!isGoverned) return;

      try {
        const decision = bos.evaluateGovernance(toolName, {
          agent: eventTyped.agent ?? 'opencode-agent',
          context: { action: (eventTyped.input?.command as string | undefined) || toolName },
        });

        if (decision.verdict === 'deny') {
          throw new Error(`Governance blocked: ${decision.reason}`);
        }

        if (decision.verdict === 'escalate') {
          console.warn(`[Behavior-OS] Escalation required: ${decision.reason}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`[Behavior-OS] Governance error: ${errorMessage}`);
      }
    });

    // Session context hook - add BehaviorOS state to session context
    ctx.session.hook('context', async (event: unknown): Promise<void> => {
      const currentState = bos.getState();
      if (!currentState.selectedDna) return;

      const nextStep: ProtocolStep | undefined = PROTOCOL_STEPS[currentState.currentStep];
      void nextStep;

      // Add behavioros context to the event
      const eventObj = event as Record<string, unknown>;
      if (!eventObj.context) {
        eventObj.context = {};
      }

      (eventObj.context as Record<string, unknown>).behavioros = {
        selectedDna: currentState.selectedDna,
        currentStep: currentState.currentStep,
        nextStep: nextStep ? `${nextStep.number}. ${nextStep.name}` : 'Complete',
        protocol: PROTOCOL_STEPS,
        availableDNAs: Array.from(loadedDnaPatterns.keys()),
        totalDNAs: loadedDnaPatterns.size,
      };
    });
  },
});
