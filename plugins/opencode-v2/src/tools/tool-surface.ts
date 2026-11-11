/**
 * The shared context handed to every tool-domain registrar.
 *
 * `setup()` builds this object once and passes it to each `register*`
 * function in `tools/`. This is the seam that lets a 3000-line `setup()`
 * body be split into per-domain files without changing behavior: each
 * registrar reads only what it needs from this bag instead of closing over
 * the whole scope.
 *
 * Keep this interface minimal and explicit — it is the *only* channel
 * between `setup()` and the domain files. If a new cross-cutting need
 * appears, add it here (with a test), never by reaching back into the
 * enclosing scope.
 */
import type { BehaviorOS, BehaviorOSSnapshot } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import type { Info as PluginToolInfo } from '@opencode/plugin/promise/tool';

/** The persistence result shape the lifecycle helpers return. */
export type PersistResult = { ok: boolean; error?: string };

export interface ToolRegistrarContext {
  /** The engine. All tool handlers delegate here; never reach into internals. */
  bos: BehaviorOS;
  /** Loaded DNA patterns (by key), set during setup before tools register. */
  dnas: Map<string, DNA>;
  /** Add a tool, codemode disabled (a first-class, directly-callable tool). */
  addTool: (tool: PluginToolInfo) => void;
  /** Add a tool whose mutation window runs under the lifecycle lock. */
  addLifecycleTool: (tool: PluginToolInfo) => void;
  /** Stamp a governance-log entry; never throws (best-effort observability). */
  recordLog: (kind: string, outcome: string, action: string, detail: string) => void;
  /** Persist the whole engine state after a state-changing call. */
  persistState: () => Promise<PersistResult>;
  /**
   * Persist a lifecycle mutation *and roll back to `before` on failure*, so
   * a storage outage never commits a half-applied transition. This is the
   * real `persistLifecycleChange` from `setup()` — the registrar files
   * cannot reimplement the rollback.
   */
  persistLifecycle: (before: BehaviorOSSnapshot) => Promise<PersistResult>;
  /** Workspace root — the real audit stages must run here, not the host cwd. */
  locationDirectory: string;
}
