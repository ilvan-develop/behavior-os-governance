import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BehaviorOS } from '@behavior-os/core';
import type { Agent } from '@behavior-os/schemas';

export interface AgentRegistryResult {
  /** Registry file that was read, or the first default candidate. */
  path: string;
  /** Whether the registry file exists. */
  found: boolean;
  /** Agents loaded via the facade from the SQLite store. */
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
 * Read registered agents via the BehaviorOS facade instead of reaching into
 * `SqliteStore` directly (Finding #11: CLI bypass of facade).
 *
 * Creates a BehaviorOS instance configured with the same SQLite path the
 * plugin/MCP use, lets `hydrateFromStore` populate the in-memory agent map,
 * then returns `listAgents()`. The store is properly closed afterwards to
 * avoid file-handle leaks (especially on Windows).
 *
 * A missing registry is not an error: a project that never enabled persistence
 * simply has no agents to list. An existing but unreadable/corrupt database is
 * reported via the facade's `storeError` status field.
 */
export async function listRegisteredAgents(
  directory: string,
  explicitPath?: string,
): Promise<AgentRegistryResult> {
  const resolved = resolveAgentRegistryPath(directory, explicitPath);
  if (!resolved.exists) {
    return { path: resolved.path, found: false, agents: [], error: null };
  }

  const bos = new BehaviorOS({
    persistence: { path: resolved.path },
  });

  try {
    const status = bos.getStatus();

    // If the store failed to initialise (corrupt DB, wrong format), surface
    // the error instead of silently returning an empty registry.
    if (status.store === false && status.storeError) {
      return {
        path: resolved.path,
        found: true,
        agents: [],
        error: status.storeError,
      };
    }

    // hydrateFromStore runs in the constructor when persistence is set;
    // listAgents() now reflects what was persisted by any host.
    return { path: resolved.path, found: true, agents: bos.listAgents(), error: null };
  } finally {
    // Ensure the SQLite handle is released promptly (Windows file locking).
    bos.closeStore();
  }
}
