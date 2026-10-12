import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STORAGE_KEY = 'behavioros:state';

interface CapturedTool {
  name: string;
  execute?: (input: unknown) => Promise<{ content: string }>;
}

type SessionHook = (event: unknown) => Promise<void>;

interface FakeContext {
  location: { directory: string };
  agent: {
    transform: (cb: (editor: unknown) => void) => Promise<void>;
  };
  tool: {
    transform: (cb: (editor: unknown) => void) => Promise<void>;
    hook: () => Promise<unknown>;
  };
  session: {
    hook: (name: string, cb: SessionHook) => Promise<unknown>;
  };
  permission: {
    hook: () => Promise<unknown>;
  };
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
    scan: () => Promise<unknown>;
  };
}

function createContext(storageData: Map<string, unknown>) {
  const addedTools: CapturedTool[] = [];
  const sessionHooks: Record<string, SessionHook> = {};

  const ctx: FakeContext = {
    location: { directory: repoRoot },
    agent: {
      transform: async (cb) => {
        await cb({
          list: () => [],
          get: () => undefined,
          default: () => {},
          update: () => {},
          remove: () => {},
        });
      },
    },
    tool: {
      transform: async (cb) => {
        await cb({
          add: (tool: CapturedTool) => addedTools.push(tool),
          namespace: () => {},
          update: () => {},
          remove: () => {},
        });
      },
      hook: async () => ({}),
    },
    session: {
      hook: async (name, cb) => {
        sessionHooks[name] = cb;
        return {};
      },
    },
    permission: {
      hook: async () => ({}),
    },
    storage: {
      get: async (key) => storageData.get(key),
      set: async (key, value) => {
        storageData.set(key, value);
      },
      remove: async (key) => {
        storageData.delete(key);
      },
      scan: async () => ({ entries: [] }),
    },
  };

  return { ctx, addedTools, sessionHooks };
}

async function runTool(
  tools: CapturedTool[],
  name: string,
  input: Record<string, unknown> = {},
): Promise<{ content: string }> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool?.execute) throw new Error(`tool ${name} not registered`);
  return tool.execute(input);
}

/** Import the plugin with fresh module-local state to simulate a restart. */
async function loadFreshPlugin() {
  vi.resetModules();
  const mod = await import('../src/index');
  return mod.default;
}

describe('behavior-os session flow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not create a mission for a greeting', async () => {
    const plugin = await loadFreshPlugin();
    const storageData = new Map<string, unknown>();
    const { ctx, sessionHooks } = createContext(storageData);
    await plugin.setup(ctx as never);

    const event = { prompt: { text: 'hi there' }, metadata: {} as Record<string, unknown> };
    await sessionHooks.prompt(event);

    expect(event.metadata.behavioros).toBeUndefined();
    expect(storageData.has(STORAGE_KEY)).toBe(false);
  });

  it('opens a mission from the prompt without advancing the protocol', async () => {
    const plugin = await loadFreshPlugin();
    const storageData = new Map<string, unknown>();
    const { ctx, sessionHooks } = createContext(storageData);
    await plugin.setup(ctx as never);

    const event = {
      prompt: { text: 'Fix the crash in the payment service' },
      metadata: {} as Record<string, unknown>,
    };
    await sessionHooks.prompt(event);

    const meta = event.metadata.behavioros as { autoSelectedDna?: string; autoMission?: string };
    expect(meta.autoSelectedDna).toBe('financial-compliance');
    expect(meta.autoMission).toMatch(/^mission-/);

    const snapshot = storageData.get(STORAGE_KEY) as {
      agentState: { currentStep: number; activeMission: string | null; selectedDna: string | null };
      missions: unknown[];
    };
    expect(snapshot.agentState.selectedDna).toBeTruthy();
    expect(snapshot.agentState.activeMission).toBe(meta.autoMission);
    // Only DNA selection advanced the protocol (step 1); the auto-mission did not.
    expect(snapshot.agentState.currentStep).toBe(1);
    expect(snapshot.missions).toHaveLength(1);
  });

  it('persists and restores state across a restart', async () => {
    const storageData = new Map<string, unknown>();

    const pluginA = await loadFreshPlugin();
    const a = createContext(storageData);
    await pluginA.setup(a.ctx as never);
    await runTool(a.addedTools, 'bos_select_dna', { pattern: 'surgical-team' });
    await runTool(a.addedTools, 'bos_create_mission', {
      title: 'Persist me',
      type: 'feature',
      priority: 'high',
    });

    const afterCreate = storageData.get(STORAGE_KEY) as { missions: Array<{ id: string }> };
    const missionId = afterCreate.missions[0].id;
    await runTool(a.addedTools, 'bos_start_mission', { missionId });

    const persisted = storageData.get(STORAGE_KEY) as {
      dna: { name: string } | null;
      agentState: { activeMission: string | null };
      revision: number;
      writer: string;
    };
    expect(persisted.dna?.name).toBe('Surgical Team');
    expect(persisted.agentState.activeMission).toBe(missionId);
    // Every snapshot is stamped with a monotonic revision and the writer id.
    expect(typeof persisted.revision).toBe('number');
    expect(persisted.revision).toBeGreaterThan(0);
    expect(typeof persisted.writer).toBe('string');

    // Restart: brand-new plugin instance (fresh module state) sharing storage.
    const pluginB = await loadFreshPlugin();
    const b = createContext(storageData);
    await pluginB.setup(b.ctx as never);

    const state = JSON.parse((await runTool(b.addedTools, 'bos_get_state')).content) as {
      selectedDna: string | null;
      activeMission: string | null;
    };
    expect(state.selectedDna).toBe('Surgical Team');
    expect(state.activeMission).toBe(missionId);

    // The restarted instance is a different writer and must not reuse the old
    // revision — it writes strictly forward.
    const afterRestart = storageData.get(STORAGE_KEY) as { revision: number; writer: string };
    expect(afterRestart.revision).toBeGreaterThan(persisted.revision);
    expect(afterRestart.writer).not.toBe(persisted.writer);
  });
});
