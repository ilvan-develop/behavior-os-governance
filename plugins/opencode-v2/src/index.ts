import * as os from 'node:os';
import * as path from 'node:path';
import {
  BehaviorOS,
  type BehaviorOSSnapshot,
  isControlPlaneAction,
  PROTOCOL_STEPS,
} from '@behavior-os/core';
import type {
  DNA,
  LearningStage,
  MissionPriority,
  MissionStatus,
  MissionType,
  ProtocolStep,
} from '@behavior-os/schemas';
import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { Info as PluginToolInfo } from '@opencode/plugin/promise/tool';
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
import { NotificationCoalescer, type NotificationIdentity } from './notifications.js';
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

/** Coalescing window for synthetic notices: one minute. */
const NOTIFICATION_WINDOW_MS = 60_000;
/** At most three synthetic notices per session per window. */
const NOTIFICATION_MAX_PER_WINDOW = 3;
/** Storage key for the persisted coalescer snapshot. */
const NOTIFICATION_STORAGE_KEY = 'behavioros:notifications:v1';

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    behaviorOS = new BehaviorOS({
      // Opt-in governed code editing: off unless explicitly enabled, and even
      // then a write requires `apply: true` on the individual call.
      codeEdit: {
        enabled: process.env.BEHAVIOR_OS_CODE_EDIT === 'true',
        root: process.env.BEHAVIOR_OS_CODE_EDIT_ROOT,
      },
      // Opt-in DNA evolution: with BEHAVIOROS_EVOLUTION=true the learning loop
      // can actually *apply* tool-scoped warn rules derived from recorded
      // failure events (still requires the caller to pass apply:true). Without
      // the flag, proposals remain read-only suggestions.
      evolution: process.env.BEHAVIOROS_EVOLUTION === 'true' ? { enabled: true } : undefined,
      // Durable state joins the MCP host's storage: with BEHAVIOROS_DB_PATH
      // set, missions/learning events AND learning lifecycle records, agents,
      // decisions, roles and policies persist through the facade across
      // restarts. ctx.storage still holds the plugin-local UX state (the
      // notification coalescer and the per-session governance snapshot); the
      // facade-level store is the cross-host source of truth.
      //
      // When running as a global plugin (no project-local BEHAVIOROS_DB_PATH),
      // fall back to a user-scoped SQLite path so persona roles survive server
      // restarts. The role registry is otherwise in-memory-only.
      //
      // In test mode we do NOT create a persistent SQLite store: the tests
      // exercise Map-based snapshot persistence, and a shared file-path store
      // would bleed state between test cases that call `vi.resetModules()`.
      persistence: process.env.BEHAVIOROS_DB_PATH
        ? { path: process.env.BEHAVIOROS_DB_PATH }
        : typeof process.env.VITEST !== 'undefined'
          ? undefined
          : { path: path.join(os.homedir(), '.config', 'opencode', 'behavioros.db') },
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
 * Persist the current engine snapshot so state survives a restart.
 *
 * Observability writes are best-effort, but lifecycle transitions pass
 * `strict: true`: a completion/failure/cancellation that durable storage did
 * not accept is reported as `PERSISTENCE_FAILED` and rolled back, never as a
 * success. A host without `ctx.storage` therefore cannot complete missions.
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

/**
 * Serialize lifecycle state mutation, not just the storage writes.
 *
 * A lifecycle transition captures a whole snapshot, mutates in memory, persists
 * and — if persistence fails — restores the captured snapshot. `persistQueue`
 * serializes the writes, but two transitions can still interleave at the
 * `await` boundary: the failing one would then restore a snapshot taken before
 * the other's mutation and silently erase it (G-010). This queue holds the
 * whole capture -> mutate -> persist -> rollback window, so transitions are
 * atomic per plugin instance.
 *
 * The queue never rejects: a failed task resolves the chain so later
 * transitions still run, while the rejection is delivered to its own caller.
 */
let lifecycleQueue: Promise<void> = Promise.resolve();

function withLifecycleLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lifecycleQueue.then(task);
  lifecycleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface PersistOutcome {
  ok: boolean;
  error?: string;
}

async function persistState(
  ctx: Context,
  options: { strict?: boolean } = {},
): Promise<PersistOutcome> {
  const run = persistQueue.then(() => persistStateOnce(ctx, options.strict === true));
  persistQueue = run.catch(() => {});
  try {
    await run;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/** One serialized persist round: plan -> adopt/merge -> write -> verify. */
async function persistStateOnce(ctx: Context, strict = false): Promise<void> {
  const storage: Context['storage'] | undefined = ctx.storage;
  if (!storage || typeof storage.set !== 'function' || !behaviorOS) {
    if (strict) throw new Error('storage unavailable');
    return;
  }
  const revisionBefore = storageRevision;
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
    if (strict) {
      // `writeSnapshot` advances storageRevision before awaiting storage.set.
      // If the write fails, the next persist must re-adopt and re-merge the
      // foreign snapshot instead of skipping it as already observed.
      storageRevision = revisionBefore;
      throw error;
    }
    console.warn(`[Behavior-OS] State persist failed: ${describeError(error)}`);
  }
}

/**
 * Persist a lifecycle transition or restore the pre-transition snapshot.
 * Lifecycle tools must never report success for a state durable storage did
 * not accept; best-effort persistence is only acceptable for non-lifecycle
 * observability writes.
 */
async function persistLifecycleChange(
  ctx: Context,
  before: BehaviorOSSnapshot,
): Promise<PersistOutcome> {
  const outcome = await persistState(ctx, { strict: true });
  if (outcome.ok) return outcome;
  getBehaviorOS().importState(before);
  return outcome;
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

// YAML parser using js-yaml (same parser as the MCP server and CLI)
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

    // Load DNA patterns from directory through the facade: the validating
    // DNALoader owns the schema, so an invalid `dna as DNA` cast can no
    // longer sneak a half-shaped pattern into loadDNA().
    try {
      const dnasDir = process.env.BEHAVIOROS_DNA_PATH
        ? path.resolve(process.env.BEHAVIOROS_DNA_PATH)
        : path.join(ctx.location.directory, 'dnas');
      const { patterns, errors } = await bos.loadDNAFromDirectory(dnasDir);
      loadedDnaPatterns = patterns;
      for (const error of errors) {
        console.warn(`DNA pattern skipped: ${error}`);
      }

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

    // --- Notification coalescing -------------------------------------------
    // `delivery: 'queue'` is retained: notices must not interrupt a turn. The
    // coalescer bounds the producer side only; it never acknowledges host
    // inbox records and never claims that a notice was delivered.
    const notifications = new NotificationCoalescer({
      windowMs: NOTIFICATION_WINDOW_MS,
      maxPerWindow: NOTIFICATION_MAX_PER_WINDOW,
    });
    const notificationStorage = ctx.storage;
    const storedNotifications =
      notificationStorage && typeof notificationStorage.get === 'function'
        ? await notificationStorage.get(NOTIFICATION_STORAGE_KEY).catch(() => undefined)
        : undefined;
    if (storedNotifications !== undefined && !notifications.restore(storedNotifications)) {
      console.warn('[Behavior-OS] Ignoring invalid notification coalescer state');
    }

    // Serialize snapshot writes so an older snapshot cannot overwrite a newer
    // one when several notices are admitted in the same turn.
    let notificationPersist: Promise<void> = Promise.resolve();
    const persistNotifications = (): Promise<void> => {
      const storage = ctx.storage;
      if (!storage || typeof storage.set !== 'function') return Promise.resolve();
      const snapshot = notifications.snapshot();
      notificationPersist = notificationPersist
        .then(() => storage.set(NOTIFICATION_STORAGE_KEY, toStorageJson(snapshot)))
        .then(() => undefined)
        .catch((error) => {
          console.warn(
            `[Behavior-OS] Could not persist notification state: ${describeError(error)}`,
          );
        });
      return notificationPersist;
    };

    // Post a short user-visible message into the session TUI for significant
    // governance events (DNA selection, mission creation, deny/escalate).
    // Repeated decisions inside one window are collapsed, and a session may
    // enqueue at most NOTIFICATION_MAX_PER_WINDOW notices per window.
    // Never throws: notifications are observability, not enforcement.
    const notify = async (
      sessionID: string | undefined,
      text: string,
      identity: Omit<NotificationIdentity, 'sessionID'>,
    ): Promise<void> => {
      if (!sessionID) return;
      const send = ctx.session?.synthetic;
      if (typeof send !== 'function') return;

      const decision = notifications.take({ ...identity, sessionID });
      const stats = notifications.stats(sessionID);
      if (!decision.send) {
        // One aggregated log line per suppression; never another synthetic
        // message, so suppression stays quieter than the event it suppresses.
        recordLog(
          'advisory',
          'info',
          identity.action,
          `Suppressed ${decision.suppressed} notification (${identity.kind}); duplicate=${stats.suppressedDuplicate} cap=${stats.suppressedCap} sent=${stats.sent}`,
        );
        return;
      }

      try {
        await send({
          sessionID,
          text,
          delivery: 'queue',
          metadata: {
            bosKind: identity.kind,
            bosKey: decision.key,
            bosAt: decision.at,
            bosSuppressedDuplicate: stats.suppressedDuplicate,
            bosSuppressedCap: stats.suppressedCap,
          },
        });
      } catch {
        // ignore: best-effort on-screen notification
      }
      await persistNotifications();
    };

    await ctx.tool.transform((editor) => {
      // Register every bos_* tool as a direct (non-Code-Mode) tool. In v2,
      // tools default to Code Mode exposure (options.codemode defaults to true)
      // which makes them invokable only through the execute tool. codemode:false
      // exposes them as first-class tools the agent can call by name.
      const tools = {
        add: (tool: PluginToolInfo) => editor.add({ ...tool, options: { codemode: false } }),
      };

      /**
       * Register a lifecycle tool. Its whole capture -> mutate -> persist ->
       * rollback window runs under the lifecycle lock, so a failing transition
       * can never roll back a concurrent transition's committed mutation.
       */
      const addLifecycle = (tool: PluginToolInfo): void => {
        const execute = tool.execute as
          | ((input: unknown) => Promise<{ content: string }>)
          | undefined;
        if (!execute) {
          tools.add(tool);
          return;
        }
        tools.add({
          ...tool,
          execute: (input: unknown) => withLifecycleLock(() => execute(input)),
        });
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
      addLifecycle({
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
          const persisted = await persistLifecycleChange(ctx, before);
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
      addLifecycle({
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
          const persisted = result.changed
            ? await persistLifecycleChange(ctx, before)
            : { ok: true };
          if (!persisted.ok) {
            return {
              content: `Mission transition failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
            };
          }
          recordLog(
            'mission',
            'info',
            'bos_start_mission',
            `Started mission "${params.missionId}"`,
          );
          return {
            content: `Mission "${params.missionId}" started. Status: ${result.mission.status}`,
          };
        },
      });

      // Tool 5a: bos_complete_mission
      addLifecycle({
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
          const persisted = result.changed
            ? await persistLifecycleChange(ctx, before)
            : { ok: true };
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
      addLifecycle({
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
          const persisted = result.changed
            ? await persistLifecycleChange(ctx, before)
            : { ok: true };
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
      addLifecycle({
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
          const persisted = result.changed
            ? await persistLifecycleChange(ctx, before)
            : { ok: true };
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
            simulate: {
              type: 'boolean',
              description:
                'true (default) runs a simulated audit and never reports a pass; false executes the real checks',
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
          };
          const report = await bos.runAudit({
            missionId: params.missionId,
            agentId: params.agentId,
            stages: params.stages,
            simulate: params.simulate,
            // The host process cwd is not guaranteed to be the project; the
            // plugin knows the workspace, so the real audit stages must run
            // there (otherwise typecheck/security fail with "no script").
            root: ctx.location.directory,
          });
          await persistState(ctx);
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
        description:
          'Record a learning event, or promote an existing learning record one lifecycle stage (observation → lesson → candidate → validated → policy → monitored). Promotion to validated requires evidence.',
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
            learningId: {
              type: 'string',
              description: 'Existing learning record to promote (instead of recording a new event)',
            },
            stage: {
              type: 'string',
              enum: ['observation', 'lesson', 'candidate', 'validated', 'policy', 'monitored'],
              description: 'Target stage; must be exactly one step after the current stage',
            },
            evidence: {
              type: 'array',
              items: { type: 'string' },
              description: 'Evidence for the promotion; required to reach validated',
            },
            reason: { type: 'string' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            type: string;
            source: string;
            content: string;
            impact: string;
            relatedMission?: string;
            learningId?: string;
            stage?: string;
            evidence?: string[];
            reason?: string;
          };

          // Promotion path: move an existing record exactly one stage forward.
          if (params.learningId) {
            if (!params.stage) {
              return {
                content:
                  'Learning promotion refused [INVALID_INPUT]: provide the target `stage` for `learningId`.',
              };
            }
            return withLifecycleLock(async () => {
              if (typeof bos.advanceLearningRecord !== 'function') {
                return {
                  content:
                    'Learning promotion unavailable [STALE_HOST]: this session loaded an older @behavior-os/core. Restart the session after building to load the lifecycle API.',
                };
              }
              const before = bos.exportState();
              const advanced = bos.advanceLearningRecord(
                params.learningId as string,
                params.stage as LearningStage,
                {
                  actor: bos.resolveAgentIdentity().agentId,
                  ...(params.reason ? { reason: params.reason } : {}),
                  ...(params.evidence ? { evidence: params.evidence } : {}),
                },
              );
              if (!advanced.ok) {
                return {
                  content: `Learning promotion refused [${advanced.code}]: ${advanced.message}`,
                };
              }
              const persisted = await persistLifecycleChange(ctx, before);
              if (!persisted.ok) {
                return {
                  content: `Learning promotion failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
                };
              }
              recordLog(
                'learning',
                'info',
                'bos_record_learning',
                `Advanced learning ${advanced.record.id} to ${advanced.record.stage}`,
              );
              return {
                content: `Learning advanced: ${advanced.record.id} -> ${advanced.record.stage}`,
              };
            });
          }

          const missing = (['type', 'source', 'content', 'impact'] as const).filter(
            (field) => !params[field],
          );
          if (missing.length > 0) {
            return {
              content: `Learning not recorded [INVALID_INPUT]: missing ${missing.join(', ')} (required when no learningId is given).`,
            };
          }

          const record =
            typeof bos.createLearningRecord === 'function'
              ? bos.createLearningRecord({
                  title: params.content.slice(0, 80),
                  content: params.content,
                  source: params.source,
                  impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
                  ...(params.relatedMission ? { relatedMission: params.relatedMission } : {}),
                  ...(params.evidence ? { evidence: params.evidence } : {}),
                })
              : null;
          const event = bos.recordLearning({
            type: params.type as 'insight' | 'pattern' | 'fix' | 'failure' | 'optimization',
            source: params.source,
            content: params.content,
            impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
            relatedMission: params.relatedMission,
          });
          await persistState(ctx);
          return {
            content: record
              ? `Learning recorded: ${event.id} (record ${record.id} at observation; promote it with learningId + stage)`
              : `Learning recorded: ${event.id} (lifecycle record unavailable [STALE_HOST]: restart the session to load the rebuilt core)`,
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

      // Tools 30-34: role/policy registry — same contract as their MCP
      // counterparts. The permission hook ENFORCES these policies on every
      // mutating, non-control-plane action, so being able to define them from
      // inside the governed session is what closes the enforcement loop.
      tools.add({
        name: 'bos_register_role',
        description: 'Register a role with attached policy-rule ids for role-based governance',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Role id (how actors resolve to this role)' },
            name: { type: 'string' },
            displayName: { type: 'string' },
            responsibilities: { type: 'array', items: { type: 'string' } },
            policies: { type: 'array', items: { type: 'string' } },
            canAudit: { type: 'boolean' },
            canEnforce: { type: 'boolean' },
            canTeach: { type: 'boolean' },
          },
          required: ['id', 'name', 'displayName', 'responsibilities'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            id: string;
            name: string;
            displayName: string;
            responsibilities: string[];
            policies?: string[];
            canAudit?: boolean;
            canEnforce?: boolean;
            canTeach?: boolean;
          };
          const result = bos.registerRole({
            id: params.id,
            name: params.name,
            displayName: params.displayName,
            responsibilities: params.responsibilities,
            policies: params.policies,
            canAudit: params.canAudit ?? false,
            canEnforce: params.canEnforce ?? false,
            canTeach: params.canTeach ?? false,
          });
          return { content: JSON.stringify(result, null, 2) };
        },
      });

      tools.add({
        name: 'bos_define_policy',
        description:
          'Define a policy rule (condition/action/severity/applies-to) used by registered roles',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            condition: {
              type: 'string',
              description:
                "Action matcher: '*' for any action, or an action prefix (e.g. 'deploy', 'git push')",
            },
            action: { type: 'string', enum: ['require', 'warn', 'block', 'auto-fix'] },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
            appliesTo: {
              type: 'array',
              items: { type: 'string', enum: ['persona', 'role', 'agent', 'project'] },
            },
            effectiveFrom: {
              type: 'string',
              description: 'ISO date from which the rule is effective',
            },
            effectiveUntil: { type: 'string', description: 'Optional ISO expiry date' },
          },
          required: [
            'id',
            'name',
            'description',
            'condition',
            'action',
            'severity',
            'appliesTo',
            'effectiveFrom',
          ],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            id: string;
            name: string;
            description: string;
            condition: string;
            action: 'require' | 'warn' | 'block' | 'auto-fix';
            severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
            appliesTo: Array<'persona' | 'role' | 'agent' | 'project'>;
            effectiveFrom: string;
            effectiveUntil?: string;
          };
          const result = bos.defineRolePolicy({
            id: params.id,
            name: params.name,
            description: params.description,
            condition: params.condition,
            action: params.action,
            severity: params.severity,
            appliesTo: params.appliesTo,
            effectiveFrom: params.effectiveFrom,
            ...(params.effectiveUntil ? { effectiveUntil: params.effectiveUntil } : {}),
          });
          return { content: JSON.stringify(result, null, 2) };
        },
      });

      tools.add({
        name: 'bos_evaluate_role_action',
        description:
          'Evaluate an action against the role/policy registry — returns the deterministic decision',
        input: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Actor role id or persona' },
            agentId: { type: 'string', description: 'Actor agent id' },
            action: { type: 'string', description: 'The action about to be performed' },
          },
          required: ['action'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { role?: string; agentId?: string; action: string };
          const decision = bos.evaluateRoleAction(
            { role: params.role, agentId: params.agentId },
            params.action,
          );
          return { content: JSON.stringify(decision, null, 2) };
        },
      });

      tools.add({
        name: 'bos_role_policy_report',
        description:
          'Per-role audit report: decision counts by action and by role, plus the last decision',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const report = bos.getRolePolicyEngine().getReport();
          return { content: JSON.stringify(report, null, 2) };
        },
      });

      tools.add({
        name: 'bos_list_roles',
        description: 'List registered roles and policy rules of the role/policy engine',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          const engine = bos.getRolePolicyEngine();
          const result = { roles: engine.listRoles(), policies: engine.listPolicies() };
          return { content: JSON.stringify(result, null, 2) };
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
        // governance control plane: reading PII is not an *operation* on it,
        // and a restrictive DNA must stay escapable (a bootstrap deadlock
        // would otherwise be inescapable). The policy lives in the facade
        // (`bootstrapDenyOverride`) so every enforcement host applies the
        // same rule; either way the verdict is recorded, never silently lost.
        const isControlPlane = isControlPlaneAction(event.action);
        const readOnly = !isMutating(event.action);
        const overridden = bos.bootstrapDenyOverride(event.action, decision);
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
            { kind: 'deny', action: event.action, reason: decision.reason },
          );
        } else if (effectiveVerdict === 'escalate' && event.effect !== 'deny') {
          event.effect = 'ask';
          event.message = `[Behavior-OS:${currentState.selectedDna}] ${decision.reason}`;
          await notify(
            event.sessionID,
            `[Behavior-OS] ⚠️ "${event.action}" needs approval — ${decision.reason}\n${ASK_HINT}`,
            { kind: 'escalate', action: event.action, reason: decision.reason },
          );
        }

        // Second deterministic authority: operator-defined role/policy rules,
        // evaluated AFTER the DNA so the DNA verdict is already applied and no
        // role decision can ever downgrade it (a role can only block or
        // escalate further). Same bootstrap carve-out as the DNA override
        // above: governance control-plane and read-only actions stay
        // escapable — role policies govern what agents DO, not their ability
        // to govern. The auto-registered persona role carries no policies, so
        // this evaluates as a deterministic no-op ("no policy matched") until
        // an operator defines one; a named-but-unknown role fails safe to
        // require. auto-fix is escalated rather than silently applied: the
        // permission hook has no rewrite channel.
        if (!isControlPlane && !readOnly) {
          const roleDecision = bos.evaluateRoleAction(
            { agentId: bos.resolveAgentIdentity().agentId },
            event.action,
          );
          if (roleDecision.action === 'block') {
            const reason = `role-policy: ${roleDecision.reason}`;
            recordLog('permission', 'deny', event.action, reason);
            if (event.effect !== 'deny') {
              event.effect = 'deny';
              event.message = `[Behavior-OS:role-policy] ${roleDecision.reason}`;
              await notify(
                event.sessionID,
                `[Behavior-OS] ⛔ Role policy blocked "${event.action}" — ${roleDecision.reason}`,
                { kind: 'deny', action: event.action, reason },
              );
            }
          } else if (
            (roleDecision.action === 'require' || roleDecision.action === 'auto-fix') &&
            event.effect !== 'deny' &&
            event.effect !== 'ask'
          ) {
            const reason = `role-policy: ${roleDecision.reason}`;
            recordLog('permission', 'escalate', event.action, reason);
            event.effect = 'ask';
            event.message = `[Behavior-OS:role-policy] ${roleDecision.reason}`;
            await notify(
              event.sessionID,
              `[Behavior-OS] ⚠️ Role policy: "${event.action}" needs approval — ${roleDecision.reason}`,
              { kind: 'escalate', action: event.action, reason },
            );
          } else if (roleDecision.action === 'warn') {
            recordLog(
              'permission',
              'info',
              event.action,
              `role-policy warn: ${roleDecision.reason}`,
            );
          }
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

      // A real user prompt starts a new notification window. OpenCode does not
      // run this hook for synthetic messages, so a notice can never reset the
      // window that suppressed it.
      const previousWindow = notifications.reset(event.sessionID);
      if (previousWindow) {
        recordLog(
          'advisory',
          'info',
          'session.prompt',
          `Notification window reset; sent=${previousWindow.sent} duplicate=${previousWindow.suppressedDuplicate} cap=${previousWindow.suppressedCap}`,
        );
        await persistNotifications();
      }

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
            { kind: 'dna', action: 'session.prompt', reason: `Auto-selected DNA "${match}"` },
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
            { kind: 'mission', action: 'session.prompt', reason: `Opened mission "${mission.id}"` },
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
