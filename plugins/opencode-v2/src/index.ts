import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BehaviorOS, type BehaviorOSSnapshot, PROTOCOL_STEPS } from '@behavior-os/core';
import type { DNA, ProtocolStep } from '@behavior-os/schemas';
import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { Info as PluginToolInfo } from '@opencode/plugin/promise/tool';
import { load as yamlLoad } from 'js-yaml';
import {
  buildGovernanceContext,
  buildGovernedPreamble,
  classifyDNA,
  classifyMissionIntent,
  GOVERNED_PREAMBLE_MARKER,
  isMutating,
} from './governance.js';
import {
  appendGovernanceLog,
  exportGovernanceLog,
  GOVERNANCE_INSTANCE_ID,
  GOVERNANCE_LOG_FILE_ENV,
  type GovernanceLogKind,
  type GovernanceLogOutcome,
  getGovernanceChainHead,
  getGovernanceLog,
  getGovernanceLogSinkStatus,
  initGovernanceLogSink,
  seedGovernanceLog,
  verifyGovernanceLog,
  verifyGovernanceLogFile,
} from './governance-log.js';
import {
  detectOvertake,
  mergeSnapshots,
  planPersist,
  readStoredManifest,
  type SnapshotLike,
} from './storage-sync.js';

// Global state for this plugin instance
let behaviorOS: BehaviorOS | null = null;
let loadedDnaPatterns: Map<string, DNA> = new Map();
/** Highest snapshot revision this instance has written or adopted. */
let storageRevision = 0;

/** Storage key under which the engine snapshot is persisted. */
const STORAGE_KEY = 'behavioros:state';

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS({
      // Opt-in governed code editing: off unless explicitly enabled, and even
      // then a write requires `apply: true` on the individual call.
      codeEdit: {
        enabled: process.env.BEHAVIOR_OS_CODE_EDIT === 'true',
        root: process.env.BEHAVIOR_OS_CODE_EDIT_ROOT,
      },
    });
  }
  return behaviorOS;
}

/** Value type accepted by `ctx.storage.set`. */
type StorageJson = Parameters<Context['storage']['set']>[1];

/** JSON-round-trip a snapshot so only persistable values reach storage. */
function toStorageJson(value: unknown): StorageJson {
  return JSON.parse(JSON.stringify(value)) as StorageJson;
}

/**
 * Persist the current engine snapshot so state survives a restart. Best-effort:
 * a missing or failing storage domain must never break a tool call.
 *
 * Writes are serialized per instance (single-flight): the storage API is a
 * plain get/set, so two tool calls persisting at once must not interleave a
 * read with a write. After each write the store is re-read; if another
 * instance landed a higher revision inside our window, we detect the overtake
 * and retry once with adopt+merge instead of failing silently. A backend with
 * compare-and-swap would remove the residual equal-revision race, which is
 * irreducible over a get/set storage API.
 */
let persistQueue: Promise<void> = Promise.resolve();

async function persistState(ctx: Context): Promise<void> {
  const run = persistQueue.then(() => persistStateOnce(ctx));
  persistQueue = run.catch(() => {});
  return run;
}

/** One serialized persist round: plan -> adopt/merge -> write -> verify. */
async function persistStateOnce(ctx: Context): Promise<void> {
  const storage: Context['storage'] | undefined = ctx.storage;
  if (!storage || typeof storage.set !== 'function' || !behaviorOS) return;
  try {
    await writeSnapshot(storage);
    // Post-write verification: a plain get/set backend has no CAS, so a
    // concurrent instance can still overtake us between our read and write.
    const after = await storage.get(STORAGE_KEY);
    const storedAfter = readStoredManifest(after);
    const verify = detectOvertake(
      storageRevision,
      storedAfter.revision,
      storedAfter.writer,
      GOVERNANCE_INSTANCE_ID,
    );
    if (verify.overtaken) {
      logRestoreWarn(
        `Overtaken after write: wrote rev=${storageRevision}, store has rev=${verify.storedRevision}; retrying adopt+merge`,
      );
      // Force the merge: on an equal-revision collision the store holds a
      // foreign snapshot that this pure decision would not adopt (it is not
      // strictly newer), yet it must be merged rather than overwritten.
      await writeSnapshot(storage, true);
      const afterRetry = await storage.get(STORAGE_KEY);
      const storedRetry = readStoredManifest(afterRetry);
      const retry = detectOvertake(
        storageRevision,
        storedRetry.revision,
        storedRetry.writer,
        GOVERNANCE_INSTANCE_ID,
      );
      if (retry.overtaken) {
        logRestoreWarn(
          `Still overtaken after retry (store rev=${retry.storedRevision}); giving up this round — backend CAS required for atomicity`,
        );
      }
    }
  } catch (error) {
    console.warn(`[Behavior-OS] State persist failed: ${describeError(error)}`);
  }
}

/** Read -> adopt/merge if a newer foreign snapshot exists -> write the stamp. */
async function writeSnapshot(
  storage: NonNullable<Context['storage']>,
  forceAdopt = false,
): Promise<void> {
  if (!behaviorOS) return;
  const existing = await storage.get(STORAGE_KEY);
  const manifest = readStoredManifest(existing);
  const plan = planPersist({
    localRevision: storageRevision,
    instanceId: GOVERNANCE_INSTANCE_ID,
    storedRevision: manifest.revision,
    storedWriter: manifest.writer,
  });
  if (plan.adopt || forceAdopt) {
    // Adopt the newer foreign snapshot *by merge*: item collections are
    // unioned by id so local-only work is preserved, and the newer snapshot
    // wins identical items. Never discard the local session blindly.
    const merged = mergeSnapshots(
      behaviorOS.exportState() as unknown as SnapshotLike,
      existing as unknown as SnapshotLike,
    );
    behaviorOS.importState(merged as unknown as BehaviorOSSnapshot);
    logRestoreWarn(
      `Adopted rev=${manifest.revision} written by instance ${manifest.writer} before persisting (merged ${behaviorOS.listMissions().length} missions)`,
    );
  }
  storageRevision = plan.nextRevision;
  const envelope = {
    ...behaviorOS.exportState(),
    revision: storageRevision,
    writer: GOVERNANCE_INSTANCE_ID,
    // Carry a bounded tail of the governance log so observability survives a
    // restart instead of starting blank.
    log: exportGovernanceLog(),
  };
  await storage.set(STORAGE_KEY, toStorageJson(envelope));
}

/** Emit a storage-related governance log line with the current engine state. */
function logRestoreWarn(detail: string): void {
  if (!behaviorOS) return;
  const state = behaviorOS.getState();
  appendGovernanceLog({
    kind: 'restore',
    outcome: 'warn',
    dna: state.selectedDna,
    step: state.currentStep,
    mission: state.activeMission,
    action: 'storage',
    detail,
  });
}

/** Restore a persisted snapshot, if any. Returns whether state was restored. */
async function restorePersistedState(ctx: Context): Promise<boolean> {
  const storage: Context['storage'] | undefined = ctx.storage;
  if (!storage || typeof storage.get !== 'function') return false;
  try {
    const raw = await storage.get(STORAGE_KEY);
    if (!raw) return false;
    const { revision } = readStoredManifest(raw);
    const restored = getBehaviorOS().importState(raw as unknown as BehaviorOSSnapshot);
    if (restored) {
      storageRevision = revision;
      // Bring the persisted governance-log tail back into this process so the
      // log continues across restarts. When a durable sink is enabled it already
      // restored the log on init, so this is a no-op then (the sink wins).
      seedGovernanceLog((raw as { log?: unknown }).log);
      console.log('[Behavior-OS] Restored persisted state from ctx.storage');
    }
    return restored;
  } catch (error) {
    console.warn(`[Behavior-OS] State restore failed: ${describeError(error)}`);
    return false;
  }
}

/** Tools that can mutate state or shell out and therefore need governance. */
const GOVERNED_TOOL = /bash|write|edit|patch|apply|shell|mcp__/i;

/**
 * User-facing guidance appended to a firm block. A deny is final (the auto
 * flag does not override it), so the message must say what the operator can
 * actually do.
 */
const BLOCK_HINT =
  'Firm block: reshape the action so the rule no longer matches, or select another DNA pattern (this deny is final and cannot be auto-approved).';

/** User-facing guidance appended to a soft gate (escalation). */
const ASK_HINT =
  'Soft gate: approve it in the host, or select a warn-only DNA pattern (e.g. lean-factory) to stop these prompts.';

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

export type { ProtocolStep };
// The 7-step protocol is defined exactly once, in the core engine
// (`PROTOCOL_STEPS`), and re-exported here so tests and hosts read the same
// list the MCP `behavioros://protocol/steps` resource serves.
export { PROTOCOL_STEPS };

export default Plugin.define({
  id: 'behavior-os',
  async setup(ctx: Context): Promise<void> {
    // Opt-in durable, append-only audit sink (JSONL). When set, the file keeps
    // the whole history and is the source of truth for the chain across
    // restarts; without it the trail is in-memory + a bounded snapshot tail.
    initGovernanceLogSink(process.env[GOVERNANCE_LOG_FILE_ENV] ?? null);

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

    // Restore any state persisted by a previous process so protocol progress,
    // the selected DNA, missions and learnings survive a restart.
    const restored = await restorePersistedState(ctx);

    // --- Governance observability -------------------------------------------
    // `recordLog` stamps every governance event with the live DNA/step/mission
    // so the `bos_get_log` tool (and the `[Behavior-OS:LOG:*]` console lines)
    // tell the full story of how rules were applied. Best-effort by design.
    const recordLog = (
      kind: GovernanceLogKind,
      outcome: GovernanceLogOutcome,
      action: string,
      detail: string,
    ): void => {
      const snapshot = bos.getState();
      appendGovernanceLog({
        kind,
        outcome,
        dna: snapshot.selectedDna,
        step: snapshot.currentStep,
        mission: snapshot.activeMission,
        action,
        detail,
      });
    };

    if (restored) {
      const snapshot = bos.getState();
      appendGovernanceLog({
        kind: 'restore',
        outcome: 'info',
        dna: snapshot.selectedDna,
        step: snapshot.currentStep,
        mission: snapshot.activeMission,
        action: 'setup',
        detail: 'Restored persisted state from ctx.storage',
      });
    }

    // Post a short user-visible message into the session TUI for significant
    // governance events (DNA selection, mission creation, deny/escalate).
    // Never throws: notifications are observability, not enforcement.
    const notify = async (sessionID: string | undefined, text: string): Promise<void> => {
      if (!sessionID) return;
      const send = ctx.session?.synthetic;
      if (typeof send !== 'function') return;
      try {
        await send({ sessionID, text, delivery: 'queue' });
      } catch {
        // ignore: best-effort on-screen notification
      }
    };

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
            tool: { type: 'string' },
            resources: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' },
            context: { type: 'object' },
          },
          required: ['action', 'agent'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            action: string;
            agent: string;
            tool?: string;
            resources?: string[];
            text?: string;
            context?: Record<string, unknown>;
          };
          // Build the condition bag the same way the permission hook does, so an
          // agent that self-checks with this tool gets the *same* verdict the
          // enforcer would apply. Explicit keys can still be supplied via
          // `context`, but they no longer bypass the heuristic signals.
          const context = buildGovernanceContext({
            tool: params.tool ?? params.action,
            action: params.action,
            resources: params.resources,
            text: params.text,
            metadata: params.context,
          });
          const result = bos.evaluateGovernance(params.action, {
            agent: params.agent,
            context,
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
          await persistState(ctx);
          recordLog(
            'dna_selected',
            'info',
            'bos_select_dna',
            `Selected DNA pattern "${params.pattern}"`,
          );
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
          await persistState(ctx);
          recordLog(
            'protocol',
            'info',
            'bos_list_dna',
            `Listed ${patterns.length} patterns (protocol step ${bos.getState().currentStep + 1})`,
          );
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
          await persistState(ctx);
          recordLog('mission', 'info', 'bos_create_mission', `Created mission ${mission.id}`);
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
          await persistState(ctx);
          recordLog(
            'mission',
            'info',
            'bos_start_mission',
            `Started mission "${params.missionId}"`,
          );
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
        description:
          'Run audit pipeline for a mission. `agentId` is optional and defaults to the session identity resolved from the active DNA (persona or registered agent) — never the model name.',
        input: {
          type: 'object',
          properties: {
            missionId: { type: 'string' },
            agentId: { type: 'string' },
            stages: { type: 'array', items: { type: 'string' } },
          },
          required: ['missionId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { missionId: string; agentId?: string; stages?: string[] };
          const report = bos.runAudit({
            missionId: params.missionId,
            agentId: params.agentId,
            stages: params.stages,
          });
          await persistState(ctx);
          recordLog(
            'tool',
            'info',
            'bos_run_audit',
            `Audit complete: ${report.overall} by ${report.agentId}`,
          );
          return {
            content: `Audit complete: ${report.overall} (agent: ${report.agentId}, dna: ${report.dnaPattern ?? 'none'})`,
          };
        },
      });

      // Tool 26: bos_set_agent — pick the governed agent identity for the session
      tools.add({
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
          await persistState(ctx);
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
      tools.add({
        name: 'bos_whoami',
        description:
          'Resolve the governed agent identity acting in this session (agent id, DNA pattern, persona, source)',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const identity = bos.resolveAgentIdentity();
          const payload = {
            ...identity,
            personas: bos.getDNA()?.personas.map((p) => p.role) ?? [],
            registeredAgents: bos
              .listAgents()
              .map((a) => ({ id: a.id, name: a.name, type: a.type })),
          };
          return { content: JSON.stringify(payload, null, 2) };
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
          await persistState(ctx);
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
          await persistState(ctx);
          recordLog(
            'protocol',
            'info',
            'bos_get_state',
            `Protocol step ${bos.getState().currentStep + 1}: ${bos.getState().selectedDna ?? 'no DNA'}`,
          );
          const state = bos.getState();
          return {
            content: JSON.stringify(state, null, 2),
          };
        },
      });

      // Tool 13: bos_get_log — read the governance log on screen
      tools.add({
        name: 'bos_get_log',
        description:
          'Read the recent Behavior-OS governance log (how DNA rules were applied to actions in this session)',
        input: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { limit?: number };
          const entries = getGovernanceLog(params.limit ?? 50);
          return {
            content: JSON.stringify({ total: entries.length, entries }, null, 2),
          };
        },
      });

      // Tool 14: bos_verify_audit_trail — recompute the hash chain and report
      // whether the governance log is intact (tamper-evident audit). With a
      // durable sink enabled it also verifies the whole persisted history.
      tools.add({
        name: 'bos_verify_audit_trail',
        description:
          'Verify the SHA-256 hash chain of the governance log: the in-memory window plus, when BEHAVIOR_OS_AUDIT_LOG is set, the whole append-only JSONL history',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const verification = verifyGovernanceLog();
          const chain = getGovernanceChainHead();
          const sink = getGovernanceLogSinkStatus();
          return {
            content: JSON.stringify(
              {
                ...verification,
                ...chain,
                sink: {
                  enabled: sink.path !== null,
                  path: sink.path,
                  writeErrors: sink.writeErrors,
                  // Whole-history verification: catches a truncated head, a
                  // deleted line or a reordered entry. `null` when disabled.
                  durable: sink.path ? verifyGovernanceLogFile(sink.path) : null,
                },
              },
              null,
              2,
            ),
          };
        },
      });

      // Tool 15: bos_preflight — synchronous pre-execution veto
      tools.add({
        name: 'bos_preflight',
        description: 'Synchronously check whether an action may proceed (runs pre gates only)',
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
          const result = bos.preflightAction(params.action, {
            agent: params.agent,
            context: params.context,
          });
          return { content: JSON.stringify(result, null, 2) };
        },
      });

      // Tool 16: bos_decide — weighted voting/quorum resolution
      tools.add({
        name: 'bos_decide',
        description:
          'Resolve a subject by weighted vote (majority/supermajority/unanimous + quorum)',
        input: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
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
            quorum: { type: 'number' },
            missionId: { type: 'string' },
          },
          required: ['subject', 'votes'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            subject: string;
            votes: Array<{ voterId: string; choice: string; weight?: number; reason?: string }>;
            policy?: string;
            quorum?: number;
            missionId?: string;
          };
          const decision = bos.decide({
            subject: params.subject,
            votes: params.votes.map((v) => ({
              voterId: v.voterId,
              choice: v.choice as 'approve' | 'reject' | 'abstain',
              weight: v.weight,
              reason: v.reason,
            })),
            policy: params.policy as 'majority' | 'supermajority' | 'unanimous',
            quorum: params.quorum,
            missionId: params.missionId,
          });
          return { content: JSON.stringify(decision, null, 2) };
        },
      });

      // Tool 17: bos_evolution — propose (and optionally apply) DNA evolution
      tools.add({
        name: 'bos_evolution',
        description:
          'Propose (and optionally apply) learning-driven DNA changes, scored by confidence',
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
          const result = bos.applyEvolution({
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

      // Tool 18: bos_code_fixes — propose code fixes from repeated fix events
      tools.add({
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
      tools.add({
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
      tools.add({
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
      tools.add({
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
      tools.add({
        name: 'bos_list_pipeline_runs',
        description:
          'List persisted gate-pipeline runs / blocked pre-flights (requires persistence)',
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
      tools.add({
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
      tools.add({
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

      // Tool 25: bos_drift — compare two DNA patterns by name
      tools.add({
        name: 'bos_drift',
        description: 'Compare two DNA patterns (by name) and report behavioral drift',
        input: {
          type: 'object',
          properties: {
            dnaA: { type: 'string' },
            dnaB: { type: 'string' },
          },
          required: ['dnaA', 'dnaB'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { dnaA: string; dnaB: string };
          const a = loadedDnaPatterns.get(params.dnaA);
          const b = loadedDnaPatterns.get(params.dnaB);
          if (!a || !b) {
            const missing = [!a ? params.dnaA : null, !b ? params.dnaB : null]
              .filter(Boolean)
              .join('", "');
            return {
              content: `DNA pattern(s) not found: "${missing}". Available: ${Array.from(
                loadedDnaPatterns.keys(),
              )
                .sort()
                .join(', ')}`,
            };
          }
          const drift = bos.compareDNADrift(a, b);
          return { content: JSON.stringify(drift, null, 2) };
        },
      });

      // Tool 28: bos_code_edit — governed preview/apply of a code edit
      tools.add({
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
            policy?: string;
          };
          const result = bos.applyCodeEdit({
            file: params.file,
            find: params.find,
            replace: params.replace,
            apply: params.apply,
            expectedBeforeHash: params.expectedBeforeHash,
            missionId: params.missionId,
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

      // Tool 29: bos_list_code_edits — the versioned history of code edits
      tools.add({
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
    });
    // Bake a short, static Behavior-OS reminder into every agent's system prompt
    // so governance is present in the agent definition itself, not only in the
    // per-request `session.context` injection. State-free on purpose: the live
    // DNA/step/mission stay in the context hook to avoid stale duplication.
    await ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        editor.update(String(agent.id), (draft) => {
          const existing = draft.system ?? '';
          if (existing.includes(GOVERNED_PREAMBLE_MARKER)) return;
          draft.system = existing
            ? `${existing}\n\n${buildGovernedPreamble()}`
            : buildGovernedPreamble();
        });
      }
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
          // Attribute to the governed identity (DNA persona / registered agent),
          // never to the host's model-facing agent name.
          agent: bos.resolveAgentIdentity().agentId,
          context,
        });

        // Denies only ever apply to state-changing actions, and never to the
        // governance control plane (bos_*): reading PII is not an *operation* on
        // it, and a restrictive DNA must stay escapable (a bootstrap deadlock
        // would otherwise be inescapable). Either way the verdict is recorded,
        // never silently lost.
        const isControlPlane = /^bos_/i.test(event.action);
        const readOnly = !isMutating(event.action);
        const overridden = decision.verdict === 'deny' && (isControlPlane || readOnly);
        const effectiveVerdict = overridden ? 'allow' : decision.verdict;

        // Record the decision in the governance log: always for deny/escalate;
        // for allow only when at least one rule was actually evaluated, keeping
        // the log focused on governance activity rather than benign tool calls.
        const isActive =
          effectiveVerdict !== 'allow' || overridden || decision.rulesEvaluated.length > 0;
        if (isActive) {
          recordLog(
            'permission',
            decision.verdict as GovernanceLogOutcome,
            event.action,
            overridden ? `control-plane override: ${decision.reason}` : decision.reason,
          );
        }

        if (effectiveVerdict === 'deny') {
          event.effect = 'deny';
          event.message = `[Behavior-OS:${currentState.selectedDna}] ${decision.reason}`;
          await notify(
            event.sessionID,
            `[Behavior-OS] ⛔ Blocked "${event.action}" — ${decision.reason}\n${BLOCK_HINT}`,
          );
        } else if (effectiveVerdict === 'escalate' && event.effect !== 'deny') {
          event.effect = 'ask';
          event.message = `[Behavior-OS:${currentState.selectedDna}] ${decision.reason}`;
          await notify(
            event.sessionID,
            `[Behavior-OS] ⚠️ "${event.action}" needs approval — ${decision.reason}\n${ASK_HINT}`,
          );
        }
      } catch (error) {
        // A governance failure must never be invisible: record it as well.
        recordLog('permission', 'error', event.action, describeError(error));
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
          agent: bos.resolveAgentIdentity().agentId,
          context,
        });
        if (decision.verdict === 'escalate') {
          recordLog('advisory', 'warn', toolName, decision.reason);
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
        await persistState(ctx);
        recordLog(
          'learning',
          'error',
          `tool:${event.tool}`,
          `Tool failure recorded as learning: ${event.error.message}`,
        );
      } catch (error) {
        console.warn(`[Behavior-OS] Learning capture error: ${describeError(error)}`);
      }
    });

    // Intelligent DNA selection + auto-mission: classify the user's prompt,
    // auto-select a matching pattern when none is active yet, and open a mission
    // so `activeMission` reflects the work in progress.
    await ctx.session.hook('prompt', async (event): Promise<void> => {
      const text = event.prompt?.text?.trim() ?? '';
      if (!text) return;

      const behavioros: Record<string, unknown> = {};

      // 1) Auto-select a DNA pattern when none is active yet.
      if (!bos.getState().selectedDna) {
        const match = classifyDNA(text, loadedDnaPatterns.keys());
        const dna = match ? loadedDnaPatterns.get(match) : undefined;
        if (match && dna) {
          await bos.loadDNA(dna);
          behavioros.autoSelectedDna = match;
          recordLog(
            'dna_selected',
            'info',
            'session.prompt',
            `Auto-selected DNA "${match}" from prompt intent`,
          );
          await notify(
            event.sessionID,
            `[Behavior-OS] 🧬 Auto-selected DNA "${match}" — governance rules are now active.`,
          );
        }
      }

      // 2) Auto-create + start a mission so `activeMission` is never left null.
      // Only when a DNA is active and no mission is currently active, which
      // prevents per-message mission spam: the mission stays active until it is
      // completed, failed, or the persisted state is cleared.
      const state = bos.getState();
      if (state.selectedDna && !state.activeMission) {
        const intent = classifyMissionIntent(text);
        if (intent) {
          const mission = bos.createMission({
            ...intent,
            createdBy: 'behavior-os:auto',
            // Auto-missions must not advance the protocol: progress still
            // reflects the steps the agent performs explicitly.
            advanceProtocol: false,
          });
          bos.startMission(mission.id, { advanceProtocol: false });
          behavioros.autoMission = mission.id;
          recordLog(
            'mission',
            'info',
            'session.prompt',
            `Auto-created mission "${mission.id}" (${intent.type}/${intent.priority})`,
          );
          await notify(
            event.sessionID,
            `[Behavior-OS] 🎯 Opened mission "${mission.id}" for this request.`,
          );
        }
      }

      if (Object.keys(behavioros).length > 0) {
        event.metadata = { ...(event.metadata ?? {}), behavioros };
        await persistState(ctx);
      }
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
        // Surface the governed identity so the model attributes audits and
        // governance entries to a DNA-derived role instead of its model name.
        const identity = bos.resolveAgentIdentity();
        event.system.push({
          type: 'text',
          text: [
            `[Behavior-OS] Active DNA: ${currentState.selectedDna}`,
            `Acting agent: ${identity.agentId}${
              identity.persona ? ` (persona: ${identity.persona})` : ''
            } [${identity.source}] — use it as \`agentId\`, never the model name`,
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
