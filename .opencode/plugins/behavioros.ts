// Auto-discovered OpenCode plugin entry for Behavior-OS.
// The canonical implementation lives in the versioned workspace package
// `plugins/opencode-v2`; this thin loader re-exports its built output so that
// OpenCode's `.opencode/plugins/` discovery picks it up without configuration.
//
// Rebuilt `dist/**` is ignored by the watcher (`opencode.json`). Touching this
// loader was tried on 2026-10-21 and did NOT reload the plugin in the running
// host: a change to the built plugin needs a host restart (or a new session).
// Do not rely on a file touch to pick up `pnpm build` output.
export { default } from '../../plugins/opencode-v2/dist/index.js';
