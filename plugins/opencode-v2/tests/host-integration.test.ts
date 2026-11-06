import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorOS, DNALoader } from '@behavior-os/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let staleMissionId = '';

type Hook = (event: unknown) => Promise<void>;

interface McpConfig {
  type: 'local' | 'remote';
  command?: string[];
  disabled?: boolean;
}

interface FakeMcpEditor {
  list(): Array<[string, McpConfig]>;
  update(name: string, update: (config: McpConfig) => void): void;
}

function createContext(
  storageData: Map<string, unknown>,
  mcpConfigs: Record<string, McpConfig> = {},
) {
  const sessionHooks: Record<string, Hook> = {};
  const disabled = new Set<string>();

  const ctx = {
    location: { directory: repoRoot },
    agent: {
      transform: async (cb: (editor: unknown) => void) => {
        await cb({ list: () => [], update: () => {}, remove: () => {} });
      },
    },
    tool: {
      transform: async (cb: (editor: unknown) => void) => {
        await cb({ add: () => {}, namespace: () => {}, update: () => {}, remove: () => {} });
      },
      hook: async () => ({}),
    },
    session: {
      hook: async (name: string, cb: Hook) => {
        sessionHooks[name] = cb;
        return {};
      },
      synthetic: async () => {},
    },
    permission: { hook: async () => ({}) },
    storage: {
      get: async (key: string) => storageData.get(key),
      set: async (key: string, value: unknown) => {
        storageData.set(key, value);
      },
      remove: async (key: string) => {
        storageData.delete(key);
      },
      scan: async () => ({ entries: [] }),
    },
    mcp: {
      transform: async (cb: (editor: FakeMcpEditor) => void) => {
        const configs = Object.entries(mcpConfigs).map(
          ([name, config]) =>
            [
              name,
              {
                ...config,
                disabled: config.disabled ?? false,
              },
            ] as [string, McpConfig],
        );
        await cb({
          list: () => configs,
          update: (name, update) => {
            const entry = configs.find(([candidate]) => candidate === name);
            if (!entry) return;
            update(entry[1]);
            if (entry[1].disabled) disabled.add(name);
          },
        });
      },
      reload: async () => {},
    },
  };

  return { ctx, sessionHooks, disabled };
}

async function loadFreshPlugin() {
  vi.resetModules();
  const mod = await import('../src/index');
  return mod.default;
}

async function staleSnapshot(): Promise<Record<string, unknown>> {
  const loader = new DNALoader();
  const lean = loader.loadFile(path.join(repoRoot, 'dnas', 'lean-factory.yaml'));
  const seed = new BehaviorOS();
  await seed.loadDNA(lean);
  const mission = seed.createMission({
    title: 'Old unrelated task',
    type: 'feature',
    priority: 'medium',
  });
  seed.startMission(mission.id);
  staleMissionId = mission.id;
  const snapshot = seed.exportState() as unknown as Record<string, unknown> & {
    agentState: { activeMission: string | null; selectedDna: string | null };
    missions: Array<{ id: string; createdAt: string; updatedAt: string }>;
  };
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  snapshot.agentState.selectedDna = 'Lean Factory';
  snapshot.missions[0].createdAt = old;
  snapshot.missions[0].updatedAt = old;
  return snapshot as unknown as Record<string, unknown>;
}

describe('Behavior-OS OpenCode host integration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.BEHAVIOROS_MISSION_TTL_MS;
    delete process.env.BEHAVIOROS_ALLOW_DUPLICATE_HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BEHAVIOROS_MISSION_TTL_MS;
    delete process.env.BEHAVIOROS_ALLOW_DUPLICATE_HOST;
  });

  it('disables a duplicate Behavior-OS MCP server so the plugin is the only host', async () => {
    const plugin = await loadFreshPlugin();
    const storage = new Map<string, unknown>();
    const { ctx, disabled } = createContext(storage, {
      behavioros: {
        type: 'local',
        command: ['node', 'packages/mcp-server/dist/server.js'],
      },
      unrelated: { type: 'local', command: ['node', 'other-server.js'] },
    });

    await plugin.setup(ctx as never);

    expect([...disabled]).toEqual(['behavioros']);
  });

  it('keeps the MCP host when the operator opts out', async () => {
    process.env.BEHAVIOROS_ALLOW_DUPLICATE_HOST = 'true';
    const plugin = await loadFreshPlugin();
    const storage = new Map<string, unknown>();
    const { ctx, disabled } = createContext(storage, {
      behavioros: {
        type: 'local',
        command: ['node', 'packages/mcp-server/dist/server.js'],
      },
    });

    await plugin.setup(ctx as never);

    expect([...disabled]).toEqual([]);
  });

  it('releases a stale mission and re-selects a DNA that matches the new task', async () => {
    const plugin = await loadFreshPlugin();
    const storage = new Map<string, unknown>();
    storage.set('behavioros:state', await staleSnapshot());
    const { ctx, sessionHooks } = createContext(storage);
    await plugin.setup(ctx as never);

    const event = {
      prompt: { text: 'Audit governance and PII compliance for the release' },
      metadata: {} as Record<string, unknown>,
    };
    await sessionHooks.prompt(event);

    const persisted = storage.get('behavioros:state') as {
      agentState: { selectedDna: string | null; activeMission: string | null };
      missions: Array<{ id: string; status: string; dnaPattern?: string }>;
    };
    expect(persisted.agentState.selectedDna).toBe('Enterprise Governance');
    expect(persisted.agentState.activeMission).not.toBe(staleMissionId);
    const old = persisted.missions.find((mission) => mission.id === staleMissionId);
    expect(old).toBeDefined();
    const cancelled = persisted.missions.filter((mission) => mission.status === 'cancelled');
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    const active = persisted.missions.filter((mission) => mission.status === 'active');
    expect(active.length).toBe(1);
    expect(active[0].dnaPattern).toBe('Enterprise Governance');
    expect((event.metadata.behavioros as Record<string, unknown>).dnaSwitched).toBe(
      'enterprise-governance',
    );
  });

  it('does not switch DNA while a live mission is in flight', async () => {
    const plugin = await loadFreshPlugin();
    const storage = new Map<string, unknown>();
    const snapshot = await staleSnapshot();
    const missions = snapshot.missions as Array<{ updatedAt: string }>;
    missions[0].updatedAt = new Date().toISOString();
    storage.set('behavioros:state', snapshot);
    const { ctx, sessionHooks } = createContext(storage);
    await plugin.setup(ctx as never);

    await sessionHooks.prompt({
      prompt: { text: 'Audit governance and PII compliance for the release' },
      metadata: {},
    });

    const persisted = storage.get('behavioros:state') as {
      agentState: { selectedDna: string | null; activeMission: string | null };
    };
    expect(persisted.agentState.selectedDna).toBe('Lean Factory');
  });
});
