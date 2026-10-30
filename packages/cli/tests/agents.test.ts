import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehaviorOS, SqliteStore } from '@behavior-os/core';
import type { Agent } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { listRegisteredAgents, resolveAgentRegistryPath } from '../src/agents.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'behavioros-agents-'));
  temporaryDirectories.push(root);
  return root;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'DevBot',
    type: 'developer',
    status: 'idle',
    dnaPattern: 'open-source',
    capabilities: ['typescript'],
    currentMission: null,
    metrics: {
      tasksCompleted: 0,
      tasksFailed: 0,
      avgResponseTime: 0,
      governanceViolations: 0,
    },
    ...overrides,
  };
}

describe('agent registry', () => {
  it('reports a missing registry without throwing', async () => {
    const root = project();

    const result = await listRegisteredAgents(root);

    expect(result.found).toBe(false);
    expect(result.agents).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.path).toBe(join(root, 'behavioros.db'));
  });

  it('lists agents persisted through the engine, ordered by id', async () => {
    const root = project();
    const db = join(root, 'behavioros.db');
    const bos = new BehaviorOS({ persistence: { path: db } });
    bos.registerAgent(makeAgent({ id: 'agent-b', name: 'Beta' }));
    bos.registerAgent(makeAgent({ id: 'agent-a', name: 'Alpha' }));
    bos.closeStore();

    const result = await listRegisteredAgents(root);

    expect(result.found).toBe(true);
    expect(result.error).toBeNull();
    expect(result.agents.map((agent) => agent.id)).toEqual(['agent-a', 'agent-b']);
    expect(result.agents[0]?.name).toBe('Alpha');
  });

  it('reads a registry under .behavioros/ when the root database is absent', async () => {
    const root = project();
    const behavioros = join(root, '.behavioros');
    mkdirSync(behavioros);
    const store = new SqliteStore({ path: join(behavioros, 'behavioros.db') });
    store.saveAgent(makeAgent({ id: 'nested' }));
    store.close();

    const result = await listRegisteredAgents(root);

    expect(result.found).toBe(true);
    expect(result.agents.map((agent) => agent.id)).toEqual(['nested']);
  });

  it('honours an explicit --db path, even when it is missing', async () => {
    const root = project();
    const explicit = join(root, 'custom', 'agents.db');

    expect(resolveAgentRegistryPath(root, explicit)).toEqual({ path: explicit, exists: false });
    const result = await listRegisteredAgents(root, explicit);
    expect(result.found).toBe(false);
  });

  it('reports an unreadable database instead of an empty registry', async () => {
    const root = project();
    const db = join(root, 'behavioros.db');
    writeFileSync(db, 'not a sqlite database');

    const result = await listRegisteredAgents(root);

    expect(result.found).toBe(true);
    expect(result.agents).toEqual([]);
    expect(result.error).not.toBeNull();
  });

  it('returns an empty list for a valid but empty registry', async () => {
    const root = project();
    const db = join(root, 'behavioros.db');
    const store = new SqliteStore({ path: db });
    store.close();

    const result = await listRegisteredAgents(root);

    expect(result.found).toBe(true);
    expect(result.agents).toEqual([]);
    expect(result.error).toBeNull();
  });
});
