import * as os from 'node:os';
import * as path from 'node:path';
import {
  appendGovernanceLog,
  BehaviorOS,
  type BehaviorOSSnapshot,
  exportGovernanceLog,
  type FairnessInput,
  GOVERNANCE_INSTANCE_ID,
  GOVERNANCE_LOG_FILE_ENV,
  type GovernanceLogKind,
  type GovernanceLogOutcome,
  getGovernanceChainHead,
  getGovernanceLog,
  getGovernanceLogSinkStatus,
  initGovernanceLogSink,
  isControlPlaneAction,
  PROTOCOL_STEPS,
  seedGovernanceLog,
  verifyGovernanceLog,
  verifyGovernanceLogFile,
} from '@behavior-os/core';
import type {
  DNA,
  GovernanceDecision,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeQuery,
  LearningStage,
  MissionPriority,
  MissionStatus,
  MissionType,
  ProtocolStep,
} from '@behavior-os/schemas';
import { Plugin } from '@opencode/plugin';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { Info as PluginToolInfo } from '@opencode/plugin/promise/tool';
import { DoomLoopGuard, evaluateDenyList, QuotaBreaker } from './company-guard.js';
import { subscribeToGovernanceEvents } from './event-monitor.js';
import { EXPOSED_ENGINES } from './exposed-engines.js';
import {
  buildGovernanceContext,
  buildGovernedPreamble,
  classifyDNA,
  classifyMissionIntent,
  GOVERNED_PREAMBLE_MARKER,
  isMutating,
} from './governance.js';
import { LoopManager, type LoopTaskInput } from './loop-manager.js';
import {
  DEFAULT_DEDUPE_TTL_MS,
  NotificationCoalescer,
  type NotificationIdentity,
} from './notifications.js';
import {
  detectOvertake,
  mergeSnapshots,
  planPersist,
  readStoredManifest,
  type SnapshotLike,
} from './storage-sync.js';

// Global state for this plugin instance
let behaviorOS: BehaviorOS | null = null;
// Autonomous-mode guard instances (created only when BEHAVIOROS_AUTONOMOUS=true)
let quotaBreaker: QuotaBreaker | undefined;
let doomLoopGuard: DoomLoopGuard | undefined;
let loadedDnaPatterns: Map<string, DNA> = new Map();
/** Highest snapshot revision this instance has written or adopted. */
let storageRevision = 0;
/** Manages autonomous control loops (bos_start_loop / bos_resume_loop / bos_loop_status). */
let loopManager: LoopManager | null = null;

/** Storage key under which the engine snapshot is persisted. */
const STORAGE_KEY = 'behavioros:state';

/** Coalescing window for synthetic notices: one minute. */
const NOTIFICATION_WINDOW_MS = 60_000;
/** At most three synthetic notices per session per window. */
const NOTIFICATION_MAX_PER_WINDOW = 3;
/** Storage key for the persisted coalescer snapshot. */
const NOTIFICATION_STORAGE_KEY = 'behavioros:notifications:v1';

/** Default window after which an untouched mission is considered stale. */
const DEFAULT_MISSION_TTL_MS = 6 * 60 * 60 * 1000;

/** Mission staleness window; `BEHAVIOROS_MISSION_TTL_MS` overrides it. */
function missionTtlMs(): number {
  const raw = Number(process.env.BEHAVIOROS_MISSION_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MISSION_TTL_MS;
}

/** True when a mission is active/paused and was touched within the TTL. */
function missionIsLive(bos: BehaviorOS, missionId: string | null): boolean {
  if (!missionId) return false;
  const mission = bos.getMission(missionId);
  if (!mission) return false;
  if (mission.status !== 'active' && mission.status !== 'paused') return false;
  const updatedAt = Date.parse(mission.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= missionTtlMs();
}

/** Map a selected DNA display name back to its `dnas/*.yaml` key. */
function dnaKeyForName(name: string | null): string | null {
  if (!name) return null;
  const wanted = name.toLowerCase();
  for (const [key, dna] of loadedDnaPatterns) {
    if (key.toLowerCase() === wanted || dna.name.toLowerCase() === wanted) return key;
  }
  return null;
}

/**
 * Detect the standalone Behavior-OS MCP server in the host's MCP config.
 *
 * Running it inside OpenCode creates a second BehaviorOS engine with its own
 * DNA, protocol step and in-memory missions. The plugin enforces with one
 * engine while the model's `bos_*` tools answer from the other — the exact
 * split-brain that makes governance look inert. The native plugin is the
 * documented single host (`docs/OPENCODE_V2.md`), so the duplicate is disabled
 * for this host by default. `BEHAVIOROS_ALLOW_DUPLICATE_HOST=true` opts out for
 * setups that deliberately keep both surfaces.
 */
function isBehaviorOsMcpServer(name: string, config: unknown): boolean {
  const value = (config ?? {}) as { command?: unknown; environment?: unknown };
  const command = Array.isArray(value.command) ? value.command.map((part) => String(part)) : [];
  const environment =
    value.environment && typeof value.environment === 'object'
      ? Object.entries(value.environment as Record<string, unknown>).map(
          ([key, entry]) => `${key}=${String(entry)}`,
        )
      : [];
  const haystack = [name, ...command, ...environment].join(' ').toLowerCase();
  return haystack.includes('behavioros') || haystack.includes('behavior-os');
}

function getBehaviorOS(): BehaviorOS {
  if (!behaviorOS) {
    const persistenceConfig = process.env.BEHAVIOROS_DB_PATH
      ? { path: process.env.BEHAVIOROS_DB_PATH }
      : typeof process.env.VITEST !== 'undefined'
        ? undefined
        : { path: path.join(os.homedir(), '.config', 'opencode', 'behavioros.db') };
    console.log(
      `[Behavior-OS] Creating new instance, persistence: ${JSON.stringify(persistenceConfig)}`,
    );
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
      persistence: persistenceConfig,
    });
    console.log(`[Behavior-OS] Instance created, hasStore: ${behaviorOS.hasPersistence()}`);
  } else {
    console.log(
      `[Behavior-OS] Reusing existing instance, hasStore: ${behaviorOS.hasPersistence()}`,
    );
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
        // Second retry with a brief backoff to let the rival instance finish
        // its write window. A third overtaken means the backend truly lacks
        // compare-and-swap and we must surface the risk rather than loop.
        await new Promise((resolve) => setTimeout(resolve, 50));
        await writeSnapshot(storage, true);
        const afterFinal = await storage.get(STORAGE_KEY);
        const storedFinal = readStoredManifest(afterFinal);
        const finalCheck = detectOvertake(
          storageRevision,
          storedFinal.revision,
          storedFinal.writer,
          GOVERNANCE_INSTANCE_ID,
        );
        if (finalCheck.overtaken) {
          logRestoreWarn(
            `Still overtaken after second retry (store rev=${finalCheck.storedRevision}); ` +
              `backend CAS required for atomicity — cross-instance data loss is possible`,
          );
        }
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

// YAML parser using js-yaml (same parser as the MCP server and CLI).
// No hardcoded DNA fallback: if dnas/ is missing or empty, governance starts
// disabled and a clear warning is emitted. Silently falling back to a partial
// pattern set made failures invisible — operators would not know their DNA
// directory was unreachable.

export type { ProtocolStep };
// The 7-step protocol is defined exactly once, in the core engine
// (`PROTOCOL_STEPS`), and re-exported here so tests and hosts read the same
// list the MCP `behavioros://protocol/steps` resource serves.
export { PROTOCOL_STEPS };

/**
 * Human-readable protocol progress. `currentStep` is the 0-based index of the
 * *next* step, so a completed protocol (currentStep === step count) must read
 * "Protocol complete", never "step 8/7".
 *
 * Exported for the regression test that pins this boundary.
 */
export function describeProtocolProgress(currentStep: number): string {
  const total = PROTOCOL_STEPS.length;
  return currentStep >= total
    ? `Protocol complete (${total}/${total})`
    : `Protocol step ${currentStep + 1}/${total}`;
}

export default Plugin.define({
  id: 'behavior-os',
  async setup(ctx: Context): Promise<(() => Promise<void> | void) | void> {
    // Opt-in durable, append-only audit sink (JSONL). When set, the file keeps
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

      if (loadedDnaPatterns.size === 0) {
        console.warn(
          'No DNA patterns found in dnas/ — governance is disabled. ' +
            'Place at least one valid YAML pattern in the dnas/ directory.',
        );
      } else {
        console.log(`Loaded ${loadedDnaPatterns.size} DNA patterns`);
      }
    } catch (error) {
      console.warn(`Failed to load DNA patterns from directory: ${error}`);
    }

    // Initialize the control-loop manager so the three bos_loop_* tools are
    // available. The manager shares the same BehaviorOS instance so missions
    // created by loop tasks appear in bos_list_missions automatically.
    loopManager = new LoopManager(bos, ctx.location.directory);

    // --- Autonomous-mode guard initialization --------------------------------
    // When BEHAVIOROS_AUTONOMOUS=true, the plugin shifts from human-in-the-loop
    // (permission `ask`) to pre-decision hardening: deny-list vetoes in
    // `execute.before`, per-session quota limits in `ctx.storage`, and doom-loop
    // detection that permanently blocks repeated failures.
    if (process.env.BEHAVIOROS_AUTONOMOUS === 'true') {
      quotaBreaker = new QuotaBreaker(ctx.storage);
      doomLoopGuard = new DoomLoopGuard();
      console.log(
        '[Behavior-OS] Autonomous mode enabled — no human gate, pre-decision hardening active',
      );
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

    // --- Single-host guard ---------------------------------------------------
    // The native plugin is the documented Behavior-OS host for OpenCode. When
    // the standalone MCP server is configured too, the model gets two engines:
    // enforcement uses this plugin's DNA/protocol/missions, while every
    // `bos_*` tool call answers from the other process. That split is silent
    // and makes governance look inert, so the duplicate is disabled for this
    // host. Opt out with BEHAVIOROS_ALLOW_DUPLICATE_HOST=true.
    if (
      process.env.BEHAVIOROS_ALLOW_DUPLICATE_HOST !== 'true' &&
      ctx.mcp &&
      typeof ctx.mcp.transform === 'function'
    ) {
      try {
        const disabledHosts: string[] = [];
        await ctx.mcp.transform((editor) => {
          for (const [name, config] of editor.list()) {
            if (config.disabled) continue;
            if (!isBehaviorOsMcpServer(name, config)) continue;
            editor.update(name, (draft) => {
              draft.disabled = true;
            });
            disabledHosts.push(name);
          }
        });
        if (disabledHosts.length > 0) {
          recordLog(
            'advisory',
            'warn',
            'setup',
            `Disabled duplicate Behavior-OS MCP host(s): ${disabledHosts.join(', ')}`,
          );
          console.warn(
            `[Behavior-OS] Disabled duplicate Behavior-OS MCP server(s): ${disabledHosts.join(
              ', ',
            )}. The native plugin is the single governance host; set BEHAVIOROS_ALLOW_DUPLICATE_HOST=true to keep both.`,
          );
        }
      } catch (error) {
        console.warn(`[Behavior-OS] Could not inspect MCP hosts: ${describeError(error)}`);
      }
    }

    // --- Notification coalescing -------------------------------------------
    // `delivery: 'queue'` is retained: notices must not interrupt a turn. The
    // coalescer bounds the producer side only; it never acknowledges host
    // inbox records and never claims that a notice was delivered.
    const notifications = new NotificationCoalescer({
      windowMs: NOTIFICATION_WINDOW_MS,
      maxPerWindow: NOTIFICATION_MAX_PER_WINDOW,
      dedupeTtlMs: DEFAULT_DEDUPE_TTL_MS,
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
            `Listed ${patterns.length} patterns (${describeProtocolProgress(bos.getState().currentStep).toLowerCase()})`,
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

      // Tool 8b: bos_evaluate_fairness
      tools.add({
        name: 'bos_evaluate_fairness',
        description:
          'Evaluate group outcomes for fairness (demographic parity, disparate impact, equal opportunity), plus data provenance and human oversight',
        input: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  group: { type: 'string' },
                  total: { type: 'number' },
                  positive: { type: 'number' },
                  actualPositive: { type: 'number' },
                  truePositive: { type: 'number' },
                },
                required: ['group', 'total', 'positive'],
              },
            },
            provenance: {
              type: 'object',
              properties: {
                datasetId: { type: 'string' },
                source: { type: 'string' },
                collectedAt: { type: 'string' },
                consentBasis: { type: 'string' },
                transformations: { type: 'array', items: { type: 'string' } },
                lineage: { type: 'array', items: { type: 'string' } },
              },
              required: ['datasetId', 'source', 'collectedAt', 'consentBasis'],
            },
            oversight: {
              type: 'object',
              properties: {
                required: { type: 'boolean' },
                approved: { type: 'boolean' },
                reviewerId: { type: 'string' },
                reviewedAt: { type: 'string' },
                rationale: { type: 'string' },
              },
              required: ['required', 'approved'],
            },
            thresholds: {
              type: 'object',
              properties: {
                maxParityDifference: { type: 'number' },
                minDisparateImpactRatio: { type: 'number' },
                maxEqualOpportunityDifference: { type: 'number' },
              },
            },
          },
          required: ['groups'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as FairnessInput;
          const result = bos.evaluateFairness(params);
          return { content: JSON.stringify(result, null, 2) };
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

      // Tool 11: bos_policy (governed policy lifecycle console)
      addLifecycle({
        name: 'bos_policy',
        description:
          'Governed policy lifecycle: list, status, events, create, validate, approve, activate, deactivate, rollback and monitor. Only a human actor can approve or activate; enforcement changes evaluateGovernance for matching actions.',
        input: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: [
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
              ],
            },
            policyId: { type: 'string' },
            versionId: { type: 'string' },
            toVersionId: { type: 'string' },
            content: { type: 'string' },
            rationale: { type: 'string' },
            reason: { type: 'string' },
            actorId: { type: 'string' },
            actorKind: { type: 'string', enum: ['human', 'agent', 'llm', 'system'] },
            approvalToken: { type: 'string' },
            issues: { type: 'array', items: { type: 'string' } },
            enforcement: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['block', 'escalate', 'require', 'warn'] },
                match: { type: 'string' },
                severity: {
                  type: 'string',
                  enum: ['critical', 'high', 'medium', 'low', 'info'],
                },
                description: { type: 'string' },
              },
            },
            success: { type: 'boolean' },
            detail: { type: 'string' },
          },
          required: ['operation'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            operation:
              | 'list'
              | 'status'
              | 'events'
              | 'create'
              | 'validate'
              | 'approve'
              | 'activate'
              | 'deactivate'
              | 'rollback'
              | 'monitor';
            policyId?: string;
            versionId?: string;
            toVersionId?: string;
            content?: string;
            rationale?: string;
            reason?: string;
            actorId?: string;
            actorKind?: 'human' | 'agent' | 'llm' | 'system';
            approvalToken?: string;
            issues?: string[];
            enforcement?: {
              action: 'block' | 'escalate' | 'require' | 'warn';
              match: string;
              severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
              description?: string;
            };
            success?: boolean;
            detail?: string;
          };

          if (typeof bos.createPolicyCandidate !== 'function') {
            return {
              content:
                'Policy console unavailable [STALE_HOST]: restart the session to load the rebuilt core.',
            };
          }

          const actor = {
            id: params.actorId ?? 'opencode',
            kind: params.actorKind ?? ('agent' as const),
          };
          const requireField = (value: string | undefined, name: string): string => {
            if (!value) throw new Error(`${name} is required for operation "${params.operation}"`);
            return value;
          };
          const readOnly =
            params.operation === 'list' ||
            params.operation === 'status' ||
            params.operation === 'events';
          const before = readOnly ? undefined : bos.exportState();

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
                source: 'opencode',
                ...(params.reason ? { reason: params.reason } : {}),
                ...(params.enforcement ? { enforcement: params.enforcement } : {}),
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

          if (before) {
            const persisted = await persistLifecycleChange(ctx, before);
            if (!persisted.ok) {
              return {
                content: `Policy ${params.operation} failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
              };
            }
          }

          const failed =
            typeof result === 'object' && result !== null && 'ok' in result && result.ok === false;
          if (failed) {
            const refusal = result as { code?: string; message?: string };
            return {
              content: `Policy ${params.operation} refused [${refusal.code ?? 'ERROR'}]: ${refusal.message ?? 'unknown error'}`,
            };
          }
          return { content: JSON.stringify(result, null, 2) };
        },
      });

      // Tool 12: bos_get_status
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
            `${describeProtocolProgress(bos.getState().currentStep)}: ${bos.getState().selectedDna ?? 'no DNA'}`,
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

      // Tools 38-41: ControlLoop — autonomous task orchestration with durable state.
      tools.add({
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

      tools.add({
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

      tools.add({
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

      tools.add({
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
          const params = input as {
            runId: string;
            decision: 'approve' | 'deny';
            reason?: string;
          };
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

      // Feature 7: Temporal Governance (Governança Temporal)
      tools.add({
        name: 'bos_add_temporal_rule',
        description:
          'Add a time-based governance rule that is only active during specific time windows (absolute, recurring/cron). Temporal rules wrap existing DNA governance rules with temporal constraints.',
        input: {
          type: 'object',
          properties: {
            baseRuleId: {
              type: 'string',
              description: 'ID of the existing DNA governance rule to wrap',
            },
            rule: { type: 'object', description: 'The governance rule to apply when active' },
            scheduleType: { type: 'string', enum: ['absolute', 'recurring', 'cron'] },
            startTime: { type: 'string', description: 'ISO timestamp (for absolute)' },
            endTime: { type: 'string', description: 'ISO timestamp (for absolute)' },
            schedule: { type: 'string', description: 'Cron expression' },
            reason: { type: 'string' },
            authorizedBy: { type: 'string' },
          },
          required: ['baseRuleId', 'rule', 'scheduleType', 'reason', 'authorizedBy'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            baseRuleId: string;
            rule: {
              id?: string;
              level: string;
              action: string;
              conditions: unknown[];
              description?: string;
            };
            scheduleType: 'absolute' | 'recurring' | 'cron';
            startTime?: string;
            endTime?: string;
            schedule?: string;
            reason: string;
            authorizedBy: string;
          };
          try {
            const result = bos.addTemporalRule({
              baseRuleId: params.baseRuleId,
              rule: {
                id: params.rule.id ?? `temp-${Date.now()}`,
                level: params.rule.level as 'critical' | 'high' | 'medium' | 'low',
                action: params.rule.action as 'block' | 'escalate' | 'warn' | 'log' | 'transform',
                conditions: params.rule.conditions as { type: string; value: unknown }[],
                description: params.rule.description,
              },
              scheduleType: params.scheduleType,
              ...(params.startTime ? { startTime: params.startTime } : {}),
              ...(params.endTime ? { endTime: params.endTime } : {}),
              ...(params.schedule ? { schedule: params.schedule } : {}),
              reason: params.reason,
              authorizedBy: params.authorizedBy,
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_check_temporal',
        description:
          'Evaluate temporal rules against a context to see which are active and which recommendations apply.',
        input: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            agentId: { type: 'string' },
            context: { type: 'object' },
            missionId: { type: 'string' },
          },
          required: ['action', 'agentId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            action: string;
            agentId: string;
            context?: Record<string, unknown>;
            missionId?: string;
          };
          try {
            const result = bos.evaluateTemporal({
              action: params.action,
              agentId: params.agentId,
              context: params.context ?? {},
              ...(params.missionId ? { missionId: params.missionId } : {}),
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_evaluate_dna_temporal',
        description:
          'Evaluate a DNA pattern with temporal overrides applied, returning the effective ruleset.',
        input: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'DNA pattern name (e.g. "lean-factory")' },
            action: { type: 'string' },
            agentId: { type: 'string' },
            context: { type: 'object' },
          },
          required: ['pattern', 'action', 'agentId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            pattern: string;
            action: string;
            agentId: string;
            context?: Record<string, unknown>;
          };
          try {
            const dna = loadedDnaPatterns.get(params.pattern.toLowerCase());
            if (!dna) {
              return {
                content: `DNA pattern "${params.pattern}" not found. Available: ${Array.from(loadedDnaPatterns.keys()).join(', ')}`,
              };
            }
            const result = bos.evaluateDNAWithTemporal(dna, {
              action: params.action,
              agentId: params.agentId,
              context: params.context ?? {},
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 5: Cognitive Load Balancer
      tools.add({
        name: 'bos_register_agent_capacity',
        description: 'Register an agent with capacity and skills for load balancing.',
        input: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            maxCapacity: { type: 'number', description: 'Maximum cognitive load (0-1)' },
            skills: { type: 'array', items: { type: 'string' } },
          },
          required: ['agentId', 'maxCapacity'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { agentId: string; maxCapacity: number; skills?: string[] };
          try {
            const engine = bos.getCognitiveLoadBalancer();
            engine.registerAgent(params.agentId, {
              maxCapacity: params.maxCapacity,
              ...(params.skills ? { skills: params.skills } : {}),
            });
            return { content: JSON.stringify({ ok: true, agentId: params.agentId }, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_assign_task',
        description:
          'Assign a task to an agent and update cognitive load. Returns overload status.',
        input: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            taskId: { type: 'string' },
          },
          required: ['agentId', 'taskId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { agentId: string; taskId: string };
          try {
            const engine = bos.getCognitiveLoadBalancer();
            const result = engine.assignTask(params.agentId, params.taskId);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_complete_task',
        description: "Complete a task and reduce the agent's cognitive load.",
        input: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            taskId: { type: 'string' },
          },
          required: ['agentId', 'taskId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { agentId: string; taskId: string };
          try {
            const engine = bos.getCognitiveLoadBalancer();
            engine.completeTask(params.agentId, params.taskId);
            return { content: JSON.stringify({ ok: true }, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_analyze_workload',
        description: 'Analyze workload distribution and get balancing recommendations.',
        input: {
          type: 'object',
          properties: {
            maxLoadThreshold: { type: 'number', description: 'Max load threshold (default 0.75)' },
            minLoadThreshold: { type: 'number', description: 'Min load threshold (default 0.25)' },
            considerSkills: { type: 'boolean', description: 'Consider skills in analysis' },
            considerFatigue: { type: 'boolean', description: 'Consider fatigue in analysis' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            maxLoadThreshold?: number;
            minLoadThreshold?: number;
            considerSkills?: boolean;
            considerFatigue?: boolean;
          };
          try {
            const engine = bos.getCognitiveLoadBalancer();
            const result = engine.analyzeWorkload({
              ...(params.maxLoadThreshold ? { maxLoadThreshold: params.maxLoadThreshold } : {}),
              ...(params.minLoadThreshold ? { minLoadThreshold: params.minLoadThreshold } : {}),
              ...(params.considerSkills !== undefined
                ? { considerSkills: params.considerSkills }
                : {}),
              ...(params.considerFatigue !== undefined
                ? { considerFatigue: params.considerFatigue }
                : {}),
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_recommend_assignment',
        description: 'Recommend an agent for a task based on load, skills, and fatigue.',
        input: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            requiredSkills: { type: 'array', items: { type: 'string' } },
            context: { type: 'object' },
          },
          required: ['taskId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { taskId: string; requiredSkills?: string[] };
          try {
            const result = bos
              .getCognitiveLoadBalancer()
              .recommendAssignment(params.taskId, params.requiredSkills ?? []);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 6: Natural Language Rules
      tools.add({
        name: 'bos_parse_rule',
        description: 'Parse a natural language rule into a structured governance rule.',
        input: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Natural language rule text' },
            rule: { type: 'string', description: 'Alias accepted by the MCP host' },
            ruleId: { type: 'string', description: 'Optional custom rule ID' },
          },
          // `text` and `rule` are alternatives; `required` cannot express an
          // anyOf here without rejecting one host's canonical field name.
          required: [],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          // Accept both the advertised `text` field and the MCP server's
          // canonical `rule` field so the two hosts cannot drift apart.
          const params = (input ?? {}) as { text?: string; rule?: string; ruleId?: string };
          const ruleText = params.text ?? params.rule;
          try {
            if (!ruleText) {
              return {
                content: JSON.stringify({ success: false, error: 'rule text is required' }),
              };
            }
            const engine = bos.getNaturalLanguageEngine();
            const result = engine.parseRule(
              ruleText,
              params.ruleId ? { ruleId: params.ruleId } : {},
            );
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_parse_rules_batch',
        description: 'Parse multiple natural language rules in a single batch.',
        input: {
          type: 'object',
          properties: {
            texts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of natural language rule texts',
            },
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Alias accepted by the MCP host',
            },
          },
          // `texts` and `rules` are alternatives; see bos_parse_rule above.
          required: [],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          // Accept the advertised `texts` field and the MCP server's `rules`
          // alias so callers can use one contract across both hosts.
          const params = (input ?? {}) as { texts?: string[]; rules?: string[] };
          const texts = params.texts ?? params.rules ?? [];
          try {
            const engine = bos.getNaturalLanguageEngine();
            const result = engine.parseRulesBatch(texts);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_apply_natural_language_rules',
        description: 'Parse and apply natural language rules to a DNA pattern.',
        input: {
          type: 'object',
          properties: {
            dnaName: { type: 'string', description: 'DNA pattern name to modify' },
            rules: {
              type: 'array',
              items: { type: 'string' },
              description: 'Natural language rules to apply',
            },
          },
          required: ['dnaName', 'rules'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { dnaName: string; rules: string[] };
          try {
            const dna = loadedDnaPatterns.get(params.dnaName.toLowerCase());
            if (!dna) {
              return {
                content: `DNA pattern "${params.dnaName}" not found. Available: ${Array.from(loadedDnaPatterns.keys()).join(', ')}`,
              };
            }
            const result = bos.getNaturalLanguageEngine().applyRules(dna, params.rules);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 2: Consensus
      tools.add({
        name: 'bos_resolve_consensus',
        description:
          'Resolve a multi-agent consensus round. Votes are weighted; ties and all-abstain resolve to rejected (fail-safe).',
        input: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'What is being decided' },
            votes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agentId: { type: 'string' },
                  choice: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
                  weight: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['agentId', 'choice'],
              },
            },
            policy: {
              type: 'string',
              enum: ['unanimous', 'supermajority', 'majority'],
              description: 'Voting policy',
            },
            quorum: { type: 'number', description: 'Minimum votes required' },
          },
          required: ['subject', 'votes'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            subject: string;
            votes: {
              agentId: string;
              choice: 'approve' | 'reject' | 'abstain';
              weight?: number;
              reason?: string;
            }[];
            policy?: 'unanimous' | 'supermajority' | 'majority';
            quorum?: number;
          };
          try {
            const result = bos.resolveConsensus({
              subject: params.subject,
              votes: params.votes,
              ...(params.policy ? { policy: params.policy } : {}),
              ...(params.quorum !== undefined ? { quorum: params.quorum } : {}),
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 3: Cross-DNA Learning
      tools.add({
        name: 'bos_suggest_cross_dna_transfer',
        description:
          'Suggest learning transfers (patterns, rules, fixes) from one DNA to another based on shared behavioral patterns.',
        input: {
          type: 'object',
          properties: {
            sourceDna: { type: 'string', description: 'Source DNA pattern name' },
            targetDna: { type: 'string', description: 'Target DNA pattern name' },
            minConfidence: {
              type: 'number',
              description: 'Minimum confidence threshold (default 0.5)',
            },
          },
          required: ['sourceDna', 'targetDna'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { sourceDna: string; targetDna: string; minConfidence?: number };
          try {
            const source = loadedDnaPatterns.get(params.sourceDna.toLowerCase());
            const target = loadedDnaPatterns.get(params.targetDna.toLowerCase());
            if (!source || !target) {
              const missing = [!source ? params.sourceDna : null, !target ? params.targetDna : null]
                .filter(Boolean)
                .join('", "');
              return {
                content: `DNA pattern(s) not found: "${missing}". Available: ${Array.from(loadedDnaPatterns.keys()).join(', ')}`,
              };
            }
            const result = bos.suggestCrossDnaTransfer(source, target, params.minConfidence ?? 0.5);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 1: Prediction
      tools.add({
        name: 'bos_predict_governance',
        description:
          'Predict likely future governance events from learning history. Returns ranked predictions with confidence scores.',
        input: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum predictions to return (default 5)' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { limit?: number };
          try {
            const result = bos.predict(params.limit ?? 5);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Feature 10: Pragmatic Conversation
      tools.add({
        name: 'bos_start_conversation',
        description: 'Start a pragmatic conversation between agents to solve a problem.',
        input: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Conversation title' },
            problem: { type: 'string', description: 'Problem description' },
            participants: {
              type: 'array',
              items: { type: 'string' },
              description: 'Agent IDs participating',
            },
          },
          required: ['title', 'problem', 'participants'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { title: string; problem: string; participants: string[] };
          try {
            const engine = bos.getPragmaticConversation();
            const result = engine.startSession({
              title: params.title,
              problem: params.problem,
              participants: params.participants,
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_add_conversation_turn',
        description: 'Add a turn to a pragmatic conversation.',
        input: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            agentId: { type: 'string' },
            content: { type: 'string' },
            role: { type: 'string', enum: ['system', 'user', 'agent', 'expert'], default: 'agent' },
          },
          required: ['sessionId', 'agentId', 'content'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            sessionId: string;
            agentId: string;
            content: string;
            role?: string;
          };
          try {
            const engine = bos.getPragmaticConversation();
            const result = engine.addTurn(
              params.sessionId,
              params.agentId,
              params.content,
              (params.role as 'system' | 'user' | 'agent' | 'expert') || 'agent',
            );
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_resolve_conversation',
        description: 'Resolve a conversation with solution and lessons learned.',
        input: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            solution: { type: 'string' },
            lessonsLearned: { type: 'array', items: { type: 'string' } },
            resolvedBy: { type: 'string' },
          },
          required: ['sessionId', 'solution', 'lessonsLearned', 'resolvedBy'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            sessionId: string;
            solution: string;
            lessonsLearned: string[];
            resolvedBy: string;
          };
          try {
            const engine = bos.getPragmaticConversation();
            const result = engine.resolveConversation(
              params.sessionId,
              params.solution,
              params.lessonsLearned,
              params.resolvedBy,
            );
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_list_conversations',
        description: 'List all active pragmatic conversation sessions.',
        input: {
          type: 'object',
          properties: {},
        },
        execute: async (): Promise<{ content: string }> => {
          try {
            const engine = bos.getPragmaticConversation();
            const sessions = engine.listSessions();
            return { content: JSON.stringify(sessions, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Knowledge Graph Tools (G-001)
      tools.add({
        name: 'bos_add_knowledge_node',
        description:
          'Add a node to the knowledge graph (agent, mission, rule, learning, decision, etc.)',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'agent',
                'mission',
                'rule',
                'learning',
                'decision',
                'pattern',
                'dna',
                'audit',
                'task',
              ],
            },
            label: { type: 'string' },
            properties: { type: 'object' },
          },
          required: ['id', 'type', 'label'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            id: string;
            type: string;
            label: string;
            properties?: Record<string, unknown>;
          };
          try {
            bos.addKnowledgeNode({
              id: params.id,
              type: params.type as KnowledgeGraphNode['type'],
              label: params.label,
              properties: params.properties ?? {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            return { content: `Node "${params.id}" added to knowledge graph` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_add_knowledge_edge',
        description: 'Add an edge to the knowledge graph representing a relationship between nodes',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            type: {
              type: 'string',
              enum: [
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
              ],
            },
            weight: { type: 'number' },
            properties: { type: 'object' },
          },
          required: ['id', 'from', 'to', 'type'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            id: string;
            from: string;
            to: string;
            type: string;
            weight?: number;
            properties?: Record<string, unknown>;
          };
          try {
            bos.addKnowledgeEdge({
              id: params.id,
              from: params.from,
              to: params.to,
              type: params.type as KnowledgeGraphEdge['type'],
              weight: params.weight ?? 1,
              properties: params.properties,
              createdAt: new Date().toISOString(),
            });
            return {
              content: `Edge "${params.id}" added: ${params.from} --[${params.type}]--> ${params.to}`,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_query_knowledge_graph',
        description: 'Query the knowledge graph with traversal and filtering',
        input: {
          type: 'object',
          properties: {
            startNode: { type: 'string' },
            nodeType: {
              type: 'string',
              enum: [
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
              ],
            },
            edgeType: {
              type: 'string',
              enum: [
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
              ],
            },
            depth: { type: 'number' },
            properties: { type: 'object' },
            sortBy: { type: 'string', enum: ['createdAt', 'weight', 'label'] },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            startNode?: string;
            nodeType?: string;
            edgeType?: string;
            depth?: number;
            properties?: Record<string, unknown>;
            sortBy?: string;
          };
          try {
            const result = bos.queryKnowledgeGraph({
              startNode: params.startNode,
              nodeType: (params.nodeType ?? 'any') as KnowledgeQuery['nodeType'],
              edgeType: (params.edgeType ?? 'any') as KnowledgeQuery['edgeType'],
              depth: params.depth ?? 3,
              properties: params.properties,
              sortBy: (params.sortBy ?? 'createdAt') as KnowledgeQuery['sortBy'],
              sortOrder: 'desc',
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_get_knowledge_graph_stats',
        description: 'Get statistics about the knowledge graph',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          try {
            const stats = bos.getKnowledgeGraphStats();
            return { content: JSON.stringify(stats, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // MetaCognition Tools (G-002)
      tools.add({
        name: 'bos_create_meta_decision',
        description:
          'Create a meta-decision from a governance evaluation with reasoning path, confidence, and bias detection',
        input: {
          type: 'object',
          properties: {
            decision: { type: 'object' },
            context: { type: 'object' },
            agentId: { type: 'string' },
            dnaPattern: { type: 'string' },
          },
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            decision: GovernanceDecision;
            context?: Record<string, unknown>;
            agentId?: string;
            dnaPattern?: string;
          };
          try {
            const result = bos.createMetaDecision(params.decision, {
              context: params.context ?? {},
              agentId: params.agentId ?? bos.resolveAgentIdentity().agentId ?? 'unknown',
              dnaPattern: params.dnaPattern,
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_get_meta_cognition_stats',
        description: 'Get statistics about the meta-cognition engine',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          try {
            const stats = bos.getMetaCognitionStats();
            return { content: JSON.stringify(stats, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // Persistent Memory Tools (G-003)
      tools.add({
        name: 'bos_save_memory',
        description: 'Save a memory (knowledge graph node) to persistent storage',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'agent',
                'mission',
                'rule',
                'learning',
                'decision',
                'pattern',
                'dna',
                'audit',
                'task',
              ],
            },
            label: { type: 'string' },
            properties: { type: 'object' },
            relevanceScore: { type: 'number' },
            expiresAt: { type: 'string' },
          },
          required: ['id', 'type', 'label'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            id: string;
            type: string;
            label: string;
            properties?: Record<string, unknown>;
            relevanceScore?: number;
            expiresAt?: string;
          };
          try {
            bos.saveMemory(
              {
                id: params.id,
                type: params.type as KnowledgeGraphNode['type'],
                label: params.label,
                properties: params.properties ?? {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              { relevanceScore: params.relevanceScore, expiresAt: params.expiresAt },
            );
            return { content: `Memory "${params.id}" saved to persistent storage` };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_recall_memory',
        description: 'Recall a memory by node ID from persistent storage',
        input: {
          type: 'object',
          properties: {
            nodeId: { type: 'string' },
          },
          required: ['nodeId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { nodeId: string };
          try {
            const result = bos.recallMemory(params.nodeId);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_recall_relevant',
        description: 'Recall memories relevant to a context via graph traversal',
        input: {
          type: 'object',
          properties: {
            startNodeId: { type: 'string' },
            maxDepth: { type: 'number' },
            minScore: { type: 'number' },
            nodeTypes: { type: 'array', items: { type: 'string' } },
          },
          required: ['startNodeId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as {
            startNodeId: string;
            maxDepth?: number;
            minScore?: number;
            nodeTypes?: string[];
          };
          try {
            const result = bos.recallRelevant(params.startNodeId, {
              maxDepth: params.maxDepth,
              minScore: params.minScore,
              nodeTypes: params.nodeTypes,
            });
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_reconstruct_context',
        description: 'Reconstruct agent context from past missions, decisions, and learnings',
        input: {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
          },
          required: ['agentId'],
        },
        execute: async (input: unknown): Promise<{ content: string }> => {
          const params = input as { agentId: string };
          try {
            const result = bos.reconstructContext(params.agentId);
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      tools.add({
        name: 'bos_consolidate_memory',
        description: 'Consolidate in-memory knowledge graph state to persistent storage',
        input: { type: 'object', properties: {} },
        execute: async (): Promise<{ content: string }> => {
          try {
            const result = bos.consolidateMemory();
            return { content: JSON.stringify(result, null, 2) };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
          }
        },
      });

      // ── Surface parity with the standalone MCP server ─────────────────────
      // These tools already exist in the engine and in `packages/mcp-server`.
      // Keeping them here means the native plugin is a complete single host, so
      // OpenCode never needs to load the MCP server as a second, divergent
      // Behavior-OS brain (see the duplicate-host guard in setup()).
      const findDna = (pattern: string): DNA | undefined => {
        const wanted = pattern.toLowerCase();
        for (const [key, dna] of loadedDnaPatterns) {
          if (key.toLowerCase() === wanted || dna.name.toLowerCase() === wanted) return dna;
        }
        return undefined;
      };

      const addJson = (
        name: string,
        description: string,
        input: Record<string, unknown>,
        run: (params: Record<string, unknown>) => unknown | Promise<unknown>,
      ): void => {
        tools.add({
          name,
          description,
          input: input as PluginToolInfo['input'],
          execute: async (raw: unknown): Promise<{ content: string }> => {
            try {
              const output = await run((raw ?? {}) as Record<string, unknown>);
              return {
                content: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return { content: JSON.stringify({ ok: false, error: message }, null, 2) };
            }
          },
        });
      };

      addJson(
        'bos_get_metrics',
        'Get current system-wide governance metrics and observability data',
        { type: 'object', properties: {} },
        () => bos.getMetrics(),
      );

      addJson(
        'bos_reset_metrics',
        'Reset all governance metrics',
        { type: 'object', properties: {} },
        () => {
          bos.resetMetrics();
          return { ok: true };
        },
      );

      // Exposed engines — one thin read-only tool per isolated engine in
      // packages/core/src/engine. See plugins/opencode-v2/src/exposed-engines.ts
      // for the full catalog (11 engines, no public tool before this commit).
      for (const def of EXPOSED_ENGINES) {
        addJson(def.name, def.description, def.input, async (params) => {
          return def.execute(params, bos);
        });
      }

      addJson(
        'bos_create_brainstorm',
        'Create a new brainstorming session for multi-agent collaboration',
        {
          type: 'object',
          properties: {
            title: { type: 'string' },
            participants: { type: 'array', items: { type: 'string' } },
            dnaPattern: { type: 'string' },
          },
          required: ['title', 'participants', 'dnaPattern'],
        },
        (p) =>
          bos.createBrainstormSession(
            String(p.title),
            p.participants as string[],
            String(p.dnaPattern),
          ),
      );

      addJson(
        'bos_list_brainstorms',
        'List all brainstorming sessions',
        { type: 'object', properties: {} },
        () => bos.listBrainstormSessions(),
      );

      addJson(
        'bos_propose_idea',
        'Propose an idea in a brainstorming session',
        {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            authorId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['sessionId', 'authorId', 'title', 'description'],
        },
        (p) =>
          bos
            .getBrainstorm()
            .proposeIdea(
              String(p.sessionId),
              String(p.authorId),
              String(p.title),
              String(p.description),
            ),
      );

      addJson(
        'bos_vote_idea',
        'Vote on an idea in a brainstorming session',
        {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            ideaId: { type: 'string' },
            voterId: { type: 'string' },
            vote: { type: 'string', enum: ['support', 'oppose', 'neutral'] },
            reason: { type: 'string' },
          },
          required: ['sessionId', 'ideaId', 'voterId', 'vote'],
        },
        (p) =>
          bos
            .getBrainstorm()
            .voteOnIdea(
              String(p.sessionId),
              String(p.ideaId),
              String(p.voterId),
              p.vote as 'support' | 'oppose' | 'neutral',
              typeof p.reason === 'string' ? p.reason : undefined,
            ),
      );

      addJson(
        'bos_create_dynamic_dna',
        'Create a dynamic DNA that can be modified at runtime',
        {
          type: 'object',
          properties: { dnaName: { type: 'string' }, baseDnaName: { type: 'string' } },
          required: ['dnaName', 'baseDnaName'],
        },
        (p) => {
          const base = findDna(String(p.baseDnaName));
          if (!base) throw new Error(`Base DNA "${String(p.baseDnaName)}" not found`);
          return bos.getDynamicDNAManager().createDynamicDNA(String(p.dnaName), base);
        },
      );

      addJson(
        'bos_override_rule',
        'Override a governance rule in a dynamic DNA',
        {
          type: 'object',
          properties: {
            dnaName: { type: 'string' },
            ruleId: { type: 'string' },
            action: { type: 'string', enum: ['block', 'escalate', 'warn', 'log', 'transform'] },
            reason: { type: 'string' },
            authorizedBy: { type: 'string' },
          },
          required: ['dnaName', 'ruleId', 'action', 'reason', 'authorizedBy'],
        },
        (p) =>
          bos
            .getDynamicDNAManager()
            .addOverride(
              String(p.dnaName),
              String(p.ruleId),
              p.action as 'block' | 'escalate' | 'warn' | 'log' | 'transform',
              undefined,
              String(p.reason),
              String(p.authorizedBy),
            ),
      );

      addJson(
        'bos_behavior_profile',
        'Generate a human-readable behavioral profile for an agent',
        {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            persona: { type: 'string' },
            dnaPattern: { type: 'string' },
          },
          required: ['agentId', 'persona', 'dnaPattern'],
        },
        (p) => {
          const dna = findDna(String(p.dnaPattern));
          if (!dna) throw new Error(`DNA pattern "${String(p.dnaPattern)}" not found`);
          const ux = bos.getBehavioralUX();
          const profile = ux.generateProfile(
            String(p.agentId),
            String(p.persona),
            String(p.dnaPattern),
            dna,
            bos.getInsights(100),
            bos.listMissions(50),
          );
          return ux.generateMarkdownReport(String(p.agentId), profile);
        },
      );

      addJson(
        'bos_behavior_diff',
        'Compare two DNA patterns and show behavioral drift with interpretation',
        {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            olderDna: { type: 'string' },
            newerDna: { type: 'string' },
          },
          required: ['agentId', 'olderDna', 'newerDna'],
        },
        (p) => {
          const older = findDna(String(p.olderDna));
          const newer = findDna(String(p.newerDna));
          if (!older || !newer) throw new Error('DNA pattern not found');
          const drift = bos.getDriftEngine().compare(older, newer);
          return bos.getBehavioralUX().compareBehaviors(String(p.agentId), older, newer, drift);
        },
      );

      addJson(
        'bos_behavior_timeline',
        'Get evolution timeline showing how agent behavior changed over time',
        {
          type: 'object',
          properties: { agentId: { type: 'string' }, limit: { type: 'number' } },
        },
        (p) =>
          bos
            .getBehavioralUX()
            .getTimeline(typeof p.agentId === 'string' ? p.agentId : undefined)
            .slice(0, typeof p.limit === 'number' ? p.limit : 20),
      );

      addJson(
        'bos_behavior_summary',
        'Get a quick one-line behavior summary for an agent',
        { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
        (p) => {
          const profile = bos.getBehavioralUX().getProfile(String(p.agentId));
          if (!profile) return `No profile found for agent "${String(p.agentId)}"`;
          return {
            summary: bos.getBehavioralUX().getBehaviorSummary(profile),
            governanceScore: profile.governanceScore,
            confidence: profile.confidence,
          };
        },
      );

      addJson(
        'bos_behavior_report',
        'Generate a full markdown behavioral report for an agent',
        {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            persona: { type: 'string' },
            dnaPattern: { type: 'string' },
            includeDiff: { type: 'boolean' },
          },
          required: ['agentId', 'persona', 'dnaPattern'],
        },
        (p) => {
          const dna = findDna(String(p.dnaPattern));
          if (!dna) throw new Error(`DNA "${String(p.dnaPattern)}" not found`);
          const ux = bos.getBehavioralUX();
          const profile = ux.generateProfile(
            String(p.agentId),
            String(p.persona),
            String(p.dnaPattern),
            dna,
            bos.getLearningEvents(),
            bos.listMissions(50),
          );
          const diff = p.includeDiff
            ? ux.getAllDiffs().find((d) => d.newerDna === String(p.dnaPattern))
            : undefined;
          return ux.generateMarkdownReport(String(p.agentId), profile, diff);
        },
      );

      addJson(
        'bos_scan_antipatterns',
        'Scan code/text for anti-patterns (TS errors, lint violations, security issues)',
        {
          type: 'object',
          properties: { text: { type: 'string' }, source: { type: 'string' } },
          required: ['text'],
        },
        (p) => {
          const engine = bos.getAntipatternEngine();
          if (!engine) throw new Error('Antipattern engine not initialized');
          return engine.scan(String(p.text), typeof p.source === 'string' ? p.source : undefined);
        },
      );

      addJson(
        'bos_fix_antipatterns',
        'Auto-fix critical and high severity anti-patterns',
        { type: 'object', properties: {} },
        () => {
          const engine = bos.getAntipatternEngine();
          if (!engine) throw new Error('Antipattern engine not initialized');
          const fixed = engine.autoFixCritical();
          return { fixed: fixed.length };
        },
      );

      addJson(
        'bos_antipattern_report',
        'Generate full anti-pattern remediation report',
        { type: 'object', properties: {} },
        () => {
          const engine = bos.getAntipatternEngine();
          if (!engine) throw new Error('Antipattern engine not initialized');
          return engine.generateReport();
        },
      );

      addJson(
        'bos_teach_behavior',
        'Teach/correct agent behavior — record a behavioral education',
        {
          type: 'object',
          properties: {
            agentId: { type: 'string' },
            pattern: { type: 'string' },
            correction: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['agentId', 'pattern', 'correction', 'reason'],
        },
        (p) => {
          const education = bos
            .getBehavioralUX()
            .teachBehavior(
              String(p.agentId),
              String(p.pattern),
              String(p.correction),
              String(p.reason),
              'user',
            );
          bos.recordLearning({
            type: 'fix',
            source: 'behavior-education',
            content: `Educated ${String(p.agentId)}: ${String(p.correction)}`,
            impact: 'high',
            relatedMission: education.id,
          });
          return education;
        },
      );

      addJson(
        'bos_assess_pragmatic_value',
        'Assess the pragmatic value of code changes: lines removed, complexity and coverage change',
        {
          type: 'object',
          properties: {
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  addedLines: { type: 'number' },
                  removedLines: { type: 'number' },
                },
                required: ['addedLines', 'removedLines'],
              },
            },
            metrics: {
              type: 'object',
              properties: {
                before: { type: 'object' },
                after: { type: 'object' },
              },
              required: ['before', 'after'],
            },
          },
          required: ['changes', 'metrics'],
        },
        (p) =>
          bos.assessPragmaticValue(
            p.changes as Array<{ addedLines: number; removedLines: number }>,
            p.metrics as {
              before: { complexity: number; testCoverage: number; rulesCount: number };
              after: { complexity: number; testCoverage: number; rulesCount: number };
            },
          ),
      );

      addJson(
        'bos_conversation_report',
        'Generate full report for a pragmatic conversation',
        { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
        (p) => {
          const engine = bos.getPragmaticConversation();
          if (!engine) throw new Error('Pragmatic conversation engine not initialized');
          const report = engine.generateReport(String(p.sessionId));
          if (!report) throw new Error(`Conversation "${String(p.sessionId)}" not found`);
          return report;
        },
      );
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
        const isControlPlane = isControlPlaneAction(event.action);
        const readOnly = !isMutating(event.action);

        // R9: Role pre-evaluate — operator-defined role policies run BEFORE DNA
        // so a role can deny an action even when the DNA would allow it. A DNA
        // deny is still authoritative: if DNA blocks, the pre-evaluate result is
        // irrelevant. Role pre-evaluate only short-circuits to deny; it never
        // forces allow over a DNA deny. Control-plane and read-only actions stay
        // escapable (same bootstrap carve-out as the post-DNA role authority).
        if (!isControlPlane && !readOnly) {
          const preRoleDecision = bos.evaluateRoleAction(
            { agentId: bos.resolveAgentIdentity().agentId },
            event.action,
          );
          if (preRoleDecision.action === 'block') {
            const reason = `role-pre-evaluate: ${preRoleDecision.reason}`;
            recordLog('permission', 'deny', event.action, reason);
            event.effect = 'deny';
            event.message = `[Behavior-OS:role] ${preRoleDecision.reason}`;
            await notify(
              event.sessionID,
              `[Behavior-OS] ⛔ Role policy blocked "${event.action}" — ${preRoleDecision.reason}\n${BLOCK_HINT}`,
              { kind: 'deny', action: event.action, reason },
            );
            return;
          }
        }

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
        } catch (dnaError) {
          // If DNA evaluation throws, fall back to role-only enforcement so we
          // don't silently allow. The pre-evaluate already ran above; we just
          // don't have a DNA verdict to layer on top.
          recordLog('permission', 'error', event.action, describeError(dnaError));
          console.warn(`[Behavior-OS] DNA evaluation error: ${describeError(dnaError)}`);
        }
      } catch (error) {
        // A governance failure must never be invisible: record it as well.
        recordLog('permission', 'error', event.action, describeError(error));
        console.warn(`[Behavior-OS] Permission evaluation error: ${describeError(error)}`);
      }
    });

    // --- Tool execution enforcement ------------------------------------------
    // In normal (human-in-the-loop) mode this is advisory: it logs escalation
    // warnings but defers enforcement to the permission hook. In autonomous
    // mode (BEHAVIOROS_AUTONOMOUS=true) it becomes a hard veto — throwing an
    // error cancels the tool call immediately, before it executes.
    await ctx.tool.hook('execute.before', async (event: unknown): Promise<void> => {
      const eventTyped = event as {
        tool?: string;
        agent?: string;
        input?: unknown;
        sessionID?: string;
      };
      const currentState = bos.getState();
      if (!currentState.selectedDna) return;

      const toolName = typeof eventTyped.tool === 'string' ? eventTyped.tool.toLowerCase() : '';
      if (!GOVERNED_TOOL.test(toolName)) return;

      // ── Autonomous mode: pre-decision hardening ──────────────────────────
      // These checks run before the DNA evaluation and throw to cancel the
      // call outright. This is the "veto" layer of defense in headless mode.
      if (quotaBreaker || doomLoopGuard) {
        const sessionID = eventTyped.sessionID ?? 'unknown';

        // 1. Doom loop detection — permanent block on repeated failures
        if (doomLoopGuard) {
          const blockedReason = doomLoopGuard.isBlocked(sessionID, toolName)
            ? doomLoopGuard.getBlockReason(sessionID, toolName)
            : undefined;
          if (blockedReason) {
            recordLog('tool', 'deny', toolName, blockedReason);
            throw new Error(`[Behavior-OS:guard] ${blockedReason}`);
          }
        }

        // 2. Deny-list — veto dangerous patterns (bash -c, node -e, etc.)
        const denyMatch = evaluateDenyList(toolName, eventTyped.input);
        if (denyMatch) {
          if (doomLoopGuard) doomLoopGuard.recordDenial(sessionID, toolName, denyMatch);
          recordLog('tool', 'deny', toolName, `deny-list: ${denyMatch}`);
          throw new Error(`[Behavior-OS:guard] Blocked by deny-list: ${denyMatch}`);
        }

        // 3. Quota circuit breaker — limit shell calls per session
        if (quotaBreaker) {
          const quotaReason = await quotaBreaker.check(sessionID, toolName);
          if (quotaReason) {
            recordLog('tool', 'deny', toolName, quotaReason);
            throw new Error(`[Behavior-OS:guard] ${quotaReason}`);
          }
        }
      }

      // ── DNA evaluation (advisory in normal mode, hard in autonomous if escalated) ─
      try {
        // The host's tool `input` is the *arguments of the call*, not a
        // summary of the target's contents. For an `edit` it is `{path,
        // oldString, newString, replaceAll}` and the caller's diff can
        // legitimately quote regulated data in one line while the file itself
        // is mostly benign. Scanning every value of `input` (as `metadata`)
        // is what makes the C9 claims-table edit — a diff that adds nothing
        // regulated — trip the data-protection rule. We therefore pass
        // only the *changed* strings (`oldString` + `newString`) and the
        // action's own labels; `input` as a whole remains available via
        // `metadata` for non-mutating tools, where the host's own content
        // is the source of the signals.
        const inputRecord = asRecord(eventTyped.input);
        const isMutTool = isMutating(toolName);
        const context = isMutTool
          ? buildGovernanceContext({
              tool: toolName,
              action: toolName,
              // For mutating tools the *new/changed* content is the diff the
              // caller is about to apply. That is the only content-domain
              // signal that should fire — the target's pre-edit document is
              // not the risk.
              text: inputRecord
                ? [inputRecord.newString, inputRecord.oldString].filter(Boolean).join(' ')
                : undefined,
              metadata: {
                path: inputRecord?.path,
              },
            })
          : buildGovernanceContext({
              tool: toolName,
              action: toolName,
              metadata: inputRecord,
            });
        const decision = bos.evaluateGovernance(toolName, {
          agent: bos.resolveAgentIdentity().agentId,
          context,
        });
        if (decision.verdict === 'escalate') {
          recordLog('advisory', 'warn', toolName, decision.reason);
          console.warn(`[Behavior-OS] Escalation advised: ${decision.reason}`);

          // In autonomous mode, escalation is treated as a hard deny —
          // there is no human to ask.
          if (quotaBreaker || doomLoopGuard) {
            const sessionID = eventTyped.sessionID ?? 'unknown';
            if (doomLoopGuard) doomLoopGuard.recordDenial(sessionID, toolName, decision.reason);
            recordLog(
              'tool',
              'deny',
              toolName,
              `autonomous-escalation-to-deny: ${decision.reason}`,
            );
            throw new Error(
              `[Behavior-OS:guard] Autonomous mode: escalation treated as deny — ${decision.reason}`,
            );
          }
        }
      } catch (error) {
        if (quotaBreaker || doomLoopGuard) {
          // In autonomous mode, governance errors are deny-by-default, not advisory
          console.warn(`[Behavior-OS] Governance error: ${describeError(error)}`);
          throw error;
        }
        // In normal mode, advisory errors are just logged
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

      // A real user prompt starts a new cap window. Recent decision identities
      // are retained, so a host that re-evaluates the same pending permission
      // request is suppressed across turns instead of notifying on every prompt.
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

      // 0) Release a mission that can no longer describe the current task.
      // A mission whose last transition/evidence is older than the TTL is
      // stale: keeping its pointer would freeze auto-missions and pin the DNA
      // of an unrelated task forever (the failure that made a persisted
      // "Lean Factory" session govern every later request). Cancelling records
      // the release in the mission history and clears `activeMission`.
      const observed = bos.getState();
      if (observed.activeMission && !missionIsLive(bos, observed.activeMission)) {
        const stale = bos.getMission(observed.activeMission);
        if (stale && (stale.status === 'active' || stale.status === 'paused')) {
          bos.cancelMission(stale.id, {
            reason: `stale mission released on new prompt: no transition within ${Math.round(
              missionTtlMs() / 60_000,
            )} min`,
          });
          behavioros.releasedMission = stale.id;
          recordLog(
            'mission',
            'info',
            'session.prompt',
            `Released stale mission "${stale.id}" (${stale.status}, updated ${stale.updatedAt})`,
          );
        }
      }

      // 1) Select a DNA from the prompt intent. A different pattern replaces the
      // current one only when no *live* mission is in flight, so governance
      // adapts per task instead of staying pinned to the first pattern ever
      // selected while a single mission is never disturbed mid-flight.
      const beforeDna = bos.getState();
      const match = classifyDNA(text, loadedDnaPatterns.keys());
      const dna = match ? loadedDnaPatterns.get(match) : undefined;
      if (!beforeDna.selectedDna && match && dna) {
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
      } else if (match && dna && !missionIsLive(bos, beforeDna.activeMission)) {
        const currentKey = dnaKeyForName(beforeDna.selectedDna);
        if (currentKey && currentKey !== match) {
          await bos.loadDNA(dna);
          behavioros.dnaSwitched = match;
          recordLog(
            'dna_selected',
            'info',
            'session.prompt',
            `Switched DNA "${currentKey}" -> "${match}" for a new task`,
          );
          await notify(
            event.sessionID,
            `[Behavior-OS] 🧬 Switched DNA to "${match}" for this task — previous pattern "${currentKey}" is no longer active.`,
            { kind: 'dna', action: 'session.prompt', reason: `Switched DNA to "${match}"` },
          );
        }
      }

      // 2) Auto-create + start a mission so `activeMission` reflects the work in
      // progress. Only when a DNA is active and no live mission exists, which
      // prevents per-message mission spam within one task.
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
            // Default required checks so auto-created missions cannot complete
            // without real evidence. Without this, a prompt like "fix the bug"
            // would spawn a mission that `bos_complete_mission` closes with
            // `no-required-checks` — effectively no audit trail.
            requiredChecks: ['governance', 'audit'],
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
        const activeMission = currentState.activeMission
          ? bos.getMission(currentState.activeMission)
          : null;
        const missionLine = currentState.activeMission
          ? `Active mission: ${currentState.activeMission} (${activeMission?.status ?? 'unknown'}) — use this missionId for audits and completion`
          : 'Active mission: none — create and start one (bos_create_mission, then bos_start_mission) before mutating or auditing';
        event.system.push({
          type: 'text',
          text: [
            `[Behavior-OS] Active DNA: ${currentState.selectedDna}`,
            `Acting agent: ${identity.agentId}${
              identity.persona ? ` (persona: ${identity.persona})` : ''
            } [${identity.source}] — use it as \`agentId\`, never the model name`,
            stepLine,
            missionLine,
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

    // --- Real-time event monitoring (Ring 2: Detect) ---------------------------
    // Subscribes to the OpenCode V2 event bus and routes governance events to
    // the Behavior-OS engines (anomaly detection, temporal patterns, circuit
    // breaker intelligence, compliance re-checks, etc.). Best-effort: a host
    // without `ctx.event` simply disables real-time monitoring.
    let eventCleanup: (() => void) | undefined;
    try {
      eventCleanup = await subscribeToGovernanceEvents(ctx, bos, (name) =>
        loadedDnaPatterns.get(name),
      );
    } catch (error) {
      console.warn(`[Behavior-OS] Event subscription failed: ${describeError(error)}`);
    }

    return async () => {
      eventCleanup?.();
    };
  },
});
