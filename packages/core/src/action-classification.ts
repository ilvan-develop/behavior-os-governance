/**
 * Action classification helpers shared by every enforcement surface
 * (plugin permission hook, MCP, CLI, orchestrator).
 *
 * The mutation vocabulary used to live in the OpenCode plugin, which meant the
 * *policy* — "a DNA deny must never lock the control plane or read-only
 * inspection tools, or a restrictive DNA would be an inescapable deadlock" —
 * existed only as a code comment next to one host implementation. Both the
 * classification and the policy now live in core so hosts cannot diverge.
 *
 * G-01: the classification is fail-closed. A deny is released only for an
 * action that is *provably* read-only (an explicit head allowlist, with no
 * state-changing verb anywhere in the string) or for the governance control
 * plane. Unknown verbs are not "probably harmless": they are treated as
 * mutating. The previous denylist shape released a denied `export`, `send`,
 * `transmit`, `git push` or any other verb it had not enumerated.
 */

/** Actions that belong to the governance control plane itself (bos_* tools). */
export const CONTROL_PLANE_ACTION = /^bos_/i;

/** Whether an action is one of the governance's own tools. */
export function isControlPlaneAction(action: string | undefined): boolean {
  return typeof action === 'string' && CONTROL_PLANE_ACTION.test(action);
}

/**
 * Verbs that change state, move data out, or perform a remote operation.
 *
 * Kept for positive classification and as a veto: a string whose head is a
 * read-only verb but which mentions `delete`, `send`, `upload`, ... anywhere is
 * not read-only (`read_then_delete`, `list_and_upload`).
 */
export const MUTATING_ACTION =
  /write|edit|patch|bash|shell|apply|create|delete|remove|move|rename|copy|deploy|publish|release|push|export|send|transmit|upload|sync|post|put|dispatch|webhook|mail|scp|destroy|drop|truncate|revoke|grant|update|save|commit|merge|reset|install|uninstall/i;

/**
 * Heads that are read-only *by themselves*. Membership is exact: `get` is
 * read-only, `get_and_delete` is not (the veto above catches it).
 */
const READ_ONLY_HEADS: ReadonlySet<string> = new Set([
  'read',
  'get',
  'list',
  'query',
  'search',
  'find',
  'grep',
  'glob',
  'inspect',
  'view',
  'show',
  'status',
  'stat',
  'diff',
  'explain',
  'verify',
  'whoami',
  'path',
  'recall',
  'cat',
  'head',
  'tail',
  'describe',
  'info',
]);

/** First token of an action, camelCase-aware and separator-aware. */
function headOf(action: string): string {
  const spaced = action.trim().replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return (spaced.split(/[\s:._/-]+/)[0] ?? '').toLowerCase();
}

/**
 * Whether an action is provably read-only. Fails closed: an unknown verb, an
 * empty string or a read-only head followed by a state-changing verb is *not*
 * read-only.
 */
export function isReadOnlyAction(action: string | undefined): boolean {
  if (typeof action !== 'string') return false;
  const trimmed = action.trim();
  if (trimmed.length === 0) return false;
  if (!READ_ONLY_HEADS.has(headOf(trimmed))) return false;
  return !MUTATING_ACTION.test(trimmed);
}

/**
 * Whether an action may perform an operation on the environment. Fail-closed:
 * anything that is not provably read-only is treated as mutating.
 */
export function isMutatingAction(action: string | undefined): boolean {
  return typeof action === 'string' && action.trim().length > 0 && !isReadOnlyAction(action);
}
