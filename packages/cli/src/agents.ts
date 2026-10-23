import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteStore } from '@behavior-os/core';
import type { Agent } from '@behavior-os/schemas';

export interface AgentRegistryResult {
  /** Registry file that was read, or the first default candidate. */
  path: string;
  /** Whether the registry file exists. */
  found: boolean;
  /** Agents ordered by id (`SqliteStore.listAgents()`). */
  agents: Agent[];
  /** Read error, when the file exists but could not be opened. */
  error: string | null;
}

/**
 * Resolve the agent registry path.
 *
 * The documented SDK default is `./behavioros.db`; `.behavioros/behavioros.db`
 * is also accepted for projects that keep all local state in `.behavioros/`.
 * An explicit `--db` always wins, even when the file does not exist yet.
 */
export function resolveAgentRegistryPath(
  directory: string,
  explicitPath?: string,
): { path: string; exists: boolean } {
  if (explicitPath) return { path: explicitPath, exists: existsSync(explicitPath) };

  const candidates = [
    join(directory, 'behavioros.db'),
    join(directory, '.behavioros', 'behavioros.db'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, exists: true };
  }
  return { path: candidates[0], exists: false };
}

/**
 * Read registered agents from the SQLite registry.
 *
 * A missing registry is not an error: a project that never enabled persistence
 * simply has no agents to list. An existing but unreadable/corrupt database is
 * reported instead of being presented as an empty registry.
 */
export function listRegisteredAgents(
  directory: string,
  explicitPath?: string,
): AgentRegistryResult {
  const resolved = resolveAgentRegistryPath(directory, explicitPath);
  if (!resolved.exists) {
    return { path: resolved.path, found: false, agents: [], error: null };
  }

  let store: SqliteStore | null = null;
  try {
    store = new SqliteStore({ path: resolved.path });
    return { path: resolved.path, found: true, agents: store.listAgents(), error: null };
  } catch (error) {
    return {
      path: resolved.path,
      found: true,
      agents: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      store?.close();
    } catch {
      // The read result is already determined; a close failure must not hide it.
    }
  }
}
