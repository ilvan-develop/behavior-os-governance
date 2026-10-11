#!/usr/bin/env node
/**
 * Verifies that the built Behavior-OS OpenCode plugin can be imported and that
 * its `setup()` registers the expected tools and hooks against the plugin API.
 *
 * This is the same code path OpenCode runs when it loads the plugin, minus the
 * real OpenCode domains (which are stubbed with lightweight doubles).
 *
 * Usage: node scripts/verify-plugin.mjs
 */
import plugin from '../plugins/opencode-v2/dist/index.js';

let exitCode = 0;

try {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin default export is not an object');
  }
  if (plugin.id !== 'behavior-os') {
    throw new Error(`Unexpected plugin id: ${plugin.id}`);
  }
  if (typeof plugin.setup !== 'function') {
    throw new Error('Plugin setup is not a function');
  }

  const addedTools = [];
  const hooks = [];

  const ctx = {
    tool: {
      transform(callback) {
        return callback({ add: (tool) => addedTools.push(tool) });
      },
      hook(name) {
        hooks.push(`tool:${name}`);
      },
    },
    session: {
      hook(name) {
        hooks.push(`session:${name}`);
      },
    },
  };

  await plugin.setup(ctx);

  const toolNames = addedTools.map((tool) => tool.name).sort();

  console.log('Plugin id   :', plugin.id);
  console.log('Hooks       :', hooks.join(', '));
  console.log('Tools (%d)  : %s', toolNames.length, toolNames.join(', '));

  if (toolNames.length === 0) throw new Error('Plugin registered no tools');
  if (!toolNames.includes('bos_list_dna')) throw new Error('Missing bos_list_dna tool');
  if (!hooks.includes('tool:execute.before')) throw new Error('Missing execute.before hook');
  if (!hooks.includes('session:context')) throw new Error('Missing session context hook');
} catch (error) {
  exitCode = 1;
  console.error('Plugin verification failed:', error.message);
}

process.exit(exitCode);
