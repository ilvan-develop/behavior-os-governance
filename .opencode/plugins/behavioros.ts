// Auto-discovered OpenCode plugin entry for Behavior-OS.
// The canonical implementation lives in the versioned workspace package
// `plugins/opencode-v2`; this thin loader re-exports its built output so that
// OpenCode's `.opencode/plugins/` discovery picks it up without configuration.
export { default } from '../../plugins/opencode-v2/dist/index.js';
