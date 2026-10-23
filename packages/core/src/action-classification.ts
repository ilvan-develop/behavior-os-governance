/**
 * Action classification helpers shared by every enforcement surface
 * (plugin permission hook, MCP, CLI, orchestrator).
 *
 * The mutation vocabulary used to live in the OpenCode plugin, which meant the
 * *policy* — "a DNA deny must never lock the control plane or read-only
 * inspection tools, or a restrictive DNA would be an inescapable deadlock" —
 * existed only as a code comment next to one host implementation. Both the
 * classification and the policy now live in core so hosts cannot diverge.
 */

/** Actions that belong to the governance control plane itself (bos_* tools). */
export const CONTROL_PLANE_ACTION = /^bos_/i;

/** Whether an action is one of the governance's own tools. */
export function isControlPlaneAction(action: string | undefined): boolean {
  return typeof action === 'string' && CONTROL_PLANE_ACTION.test(action);
}

/** Tools whose execution mutates state and therefore counts as a `change`. */
export const MUTATING_ACTION = /write|edit|patch|bash|shell|apply|create|delete|move/i;

/** Whether an action string performs an operation on the environment. */
export function isMutatingAction(action: string | undefined): boolean {
  return typeof action === 'string' && MUTATING_ACTION.test(action);
}
