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

  const expectedTools = [
    'bos_check_quality',
    'bos_create_mission',
    'bos_evaluate_governance',
    'bos_get_insights',
    'bos_get_state',
    'bos_get_status',
    'bos_list_dna',
    'bos_list_missions',
    'bos_record_learning',
    'bos_run_audit',
    'bos_select_dna',
    'bos_start_mission',
  ];

  console.log('Plugin id   :', plugin.id);
  console.log('Hooks       :', hooks.join(', '));
  console.log('Tools (%d)  : %s', toolNames.length, toolNames.join(', '));

  if (toolNames.length === 0) throw new Error('Plugin registered no tools');
  const missing = expectedTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing tools: ${missing.join(', ')}`);
  }
  if (hooks.includes('tool:execute.before') === false) {
    throw new Error('Missing execute.before hook');
  }
  if (hooks.includes('session:context') === false) {
    throw new Error('Missing session context hook');
  }

  // Protocol flow: selecting a DNA pattern then resolving truth must advance
  // currentStep in the AgentState surfaced by bos_get_state (content = JSON).
  const byName = Object.fromEntries(addedTools.map((tool) => [tool.name, tool]));
  const runTool = async (name, input = {}) => byName[name].execute(input);

  const beforeState = JSON.parse((await runTool('bos_get_state')).content);
  if (beforeState.currentStep !== 0) {
    throw new Error(`Expected currentStep 0 before DNA selection, got ${beforeState.currentStep}`);
  }

  await runTool('bos_select_dna', { pattern: 'surgical-team' });

  const afterState = JSON.parse((await runTool('bos_get_state')).content);
  const selectEntry = afterState.stepHistory?.find((entry) => entry.tool === 'bos_select_dna');
  if (selectEntry?.step !== 1) {
    throw new Error('bos_select_dna did not complete protocol step 1');
  }
  if (afterState.currentStep < 3) {
    throw new Error(`Expected currentStep >= 3, got ${afterState.currentStep}`);
  }
  if (!afterState.selectedDna) {
    throw new Error('No selectedDna after bos_select_dna');
  }

  console.log('Protocol flow: step 1 complete, currentStep =', afterState.currentStep);
} catch (error) {
  exitCode = 1;
  console.error('Plugin verification failed:', error.message);
}

process.exit(exitCode);
