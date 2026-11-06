#!/usr/bin/env node
/**
 * Verifies that the built Behavior-OS OpenCode plugin can be imported and that
 * its `setup()` registers the expected tools and hooks against the plugin API,
 * and that governance now actually denies actions via the permission hook.
 *
 * This is the same code path OpenCode runs when it loads the plugin, minus the
 * real OpenCode domains (which are stubbed with lightweight doubles).
 *
 * Usage: node scripts/verify-plugin.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import plugin from '../plugins/opencode-v2/dist/index.js';

// This verifier boots the real plugin and exercises the prompt hook, which
// opens auto-missions. Pin an ephemeral store so verification never writes
// test missions into the operator's live database or durable audit sink.
process.env.BEHAVIOROS_DB_PATH = ':memory:';
process.env.BEHAVIOR_OS_AUDIT_LOG = '';

let exitCode = 0;

function fail(message) {
  throw new Error(message);
}

try {
  if (!plugin || typeof plugin !== 'object') {
    fail('Plugin default export is not an object');
  }
  if (plugin.id !== 'behavior-os') {
    fail(`Unexpected plugin id: ${plugin.id}`);
  }
  if (typeof plugin.setup !== 'function') {
    fail('Plugin setup is not a function');
  }

  const addedTools = [];
  const toolHooks = new Map();
  const sessionHooks = new Map();
  const permissionHooks = new Map();
  const agents = [
    { id: 'build', name: 'Build', system: 'You are the build agent.' },
    { id: 'review', name: 'Review' },
  ];

  const ctx = {
    location: { directory: process.cwd() },
    agent: {
      transform(callback) {
        callback({
          list: () => agents,
          get: (id) => agents.find((agent) => agent.id === id),
          default() {},
          update(id, update) {
            const agent = agents.find((candidate) => candidate.id === id);
            if (agent) update(agent);
          },
          remove() {},
        });
        return { dispose: async () => {} };
      },
    },
    tool: {
      transform(callback) {
        return callback({
          add: (tool) => addedTools.push(tool),
          namespace() {},
          update() {},
          remove() {},
          list() {
            return [];
          },
          get() {
            return undefined;
          },
        });
      },
      hook(name, cb) {
        toolHooks.set(name, cb);
      },
    },
    session: {
      hook(name, cb) {
        sessionHooks.set(name, cb);
      },
    },
    permission: {
      hook(name, cb) {
        permissionHooks.set(name, cb);
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
    'bos_get_log',
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
  console.log('Tool hooks  :', [...toolHooks.keys()].join(', '));
  console.log('Session hooks:', [...sessionHooks.keys()].join(', '));
  console.log('Permission hooks:', [...permissionHooks.keys()].join(', '));
  console.log('Tools (%d)  : %s', toolNames.length, toolNames.join(', '));

  if (toolNames.length === 0) fail('Plugin registered no tools');
  const missing = expectedTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) fail(`Missing tools: ${missing.join(', ')}`);

  const requiredToolHooks = ['execute.before', 'execute.after'];
  for (const hook of requiredToolHooks) {
    if (!toolHooks.has(hook)) fail(`Missing tool hook: ${hook}`);
  }
  if (!sessionHooks.has('context')) fail('Missing session context hook');
  if (!sessionHooks.has('prompt')) fail('Missing session prompt hook');
  if (!permissionHooks.has('evaluate')) fail('Missing permission evaluate hook');

  // Governed agent preamble: every agent's system prompt carries the marker.
  for (const agent of agents) {
    if (!agent.system?.includes('<!-- behavior-os:governed -->')) {
      fail(`Agent "${agent.id}" did not receive the governed preamble`);
    }
  }

  // Protocol flow: selecting a DNA pattern then resolving truth must advance
  // currentStep in the AgentState surfaced by bos_get_state (content = JSON).
  const byName = Object.fromEntries(addedTools.map((tool) => [tool.name, tool]));
  const runTool = async (name, input = {}) => byName[name].execute(input);

  const beforeState = JSON.parse((await runTool('bos_get_state')).content);
  if (beforeState.currentStep !== 0) {
    fail(`Expected currentStep 0 before DNA selection, got ${beforeState.currentStep}`);
  }

  // Cold start: the context hook must inject guidance even without DNA.
  {
    const event = { system: [] };
    await sessionHooks.get('context')(event);
    if (event.system.length === 0 || !event.system[0].text.includes('No DNA pattern selected')) {
      fail('Context hook did not inject cold-start guidance without DNA');
    }
  }

  // Intelligent selection: a prompt mentioning patients should pick healthcare-hipaa.
  {
    const event = {
      prompt: { text: 'Update the patient record handling for HIPAA' },
      metadata: {},
    };
    await sessionHooks.get('prompt')(event);
    const state = JSON.parse((await runTool('bos_get_state')).content);
    if (!state.selectedDna) fail('Prompt hook did not auto-select a DNA pattern');
  }

  await runTool('bos_select_dna', { pattern: 'surgical-team' });

  const afterState = JSON.parse((await runTool('bos_get_state')).content);
  const selectEntry = afterState.stepHistory?.find((entry) => entry.tool === 'bos_select_dna');
  if (selectEntry?.step !== 1) fail('bos_select_dna did not complete protocol step 1');
  if (afterState.currentStep < 3) fail(`Expected currentStep >= 3, got ${afterState.currentStep}`);
  if (!afterState.selectedDna) fail('No selectedDna after bos_select_dna');

  // Governance enforcement: preparing to deploy to production under surgical-team
  // must be denied by the permission hook.
  {
    const event = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'verify',
      effect: 'allow',
    };
    await permissionHooks.get('evaluate')(event);
    if (event.effect !== 'deny') {
      fail(`Expected permission effect "deny", got "${event.effect}"`);
    }
    if (!event.message || !/surgical/i.test(event.message)) {
      fail(`Expected denial message naming the DNA, got "${event.message}"`);
    }
  }

  // The governed skill should be discoverable by OpenCode v2 from the project.
  {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const skillPath = path.join(repoRoot, '.opencode', 'skills', 'behavior-os', 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      fail(`Missing behavior-os skill at ${skillPath}`);
    }
    const skill = fs.readFileSync(skillPath, 'utf-8');
    if (!skill.includes('description:')) {
      fail('behavior-os skill is missing a description (it would not be advertised)');
    }
  }

  // Governance log: bos_get_log must surface the DNA selection and the denial
  // recorded above, stamped with the active DNA.
  {
    const logResult = JSON.parse((await runTool('bos_get_log', { limit: 20 })).content);
    if (!Array.isArray(logResult.entries) || logResult.entries.length === 0) {
      fail('bos_get_log returned no governance entries');
    }
    const dnaEntries = logResult.entries.filter((entry) => entry.kind === 'dna_selected');
    const dnaEntry = dnaEntries[dnaEntries.length - 1];
    if (dnaEntry?.dna !== 'Surgical Team') {
      fail('bos_get_log is missing the surgical-team DNA selection entry');
    }
    const denyEntry = logResult.entries.find(
      (entry) => entry.kind === 'permission' && entry.outcome === 'deny',
    );
    if (denyEntry?.dna !== 'Surgical Team') {
      fail('bos_get_log is missing the permission deny entry');
    }
    console.log(
      'Log: bos_get_log returned',
      logResult.entries.length,
      'entries incl. dna_selected + permission deny',
    );
  }

  console.log('Protocol flow: step 1 complete, currentStep =', afterState.currentStep);
  console.log('Agents: governed preamble applied to', agents.map((a) => a.id).join(', '));
  console.log('Governance: "deploy to production" denied under surgical-team');
  console.log('Skill: .opencode/skills/behavior-os/SKILL.md present and advertised');
} catch (error) {
  exitCode = 1;
  console.error('Plugin verification failed:', error.message);
}

process.exit(exitCode);
