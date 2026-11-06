#!/usr/bin/env node
/**
 * Behavior-OS governance flow analyser.
 *
 * Enumerates exactly 1000 scenarios across the real Behaviour-OS engine and the
 * real (built) OpenCode v2 plugin hooks, then records the observable outcome.
 *
 *   Part A (945)  governance reachability matrix
 *                 DNA (21) x governance level (3) x context provider (3) x tool (5)
 *   Part B (55)   trigger/flow matrix
 *                 phase (5) x dnaSelected (2) x tool (5)  + 5 named edge cases
 *
 * Outputs:
 *   docs/analysis/governance-flow-scenarios.csv
 *   docs/analysis/governance-flow-summary.json
 *
 * Usage: node scripts/analyze-governance-flow.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const pluginDir = path.join(repoRoot, 'plugins', 'opencode-v2');
const outDir = path.join(repoRoot, 'docs', 'analysis');

// The analyser boots the real plugin hooks and can trigger prompt-driven
// auto-missions. Keep the run hermetic so it never mutates operator state.
process.env.BEHAVIOROS_DB_PATH = ':memory:';
process.env.BEHAVIOR_OS_AUDIT_LOG = '';

const requireFromPlugin = createRequire(path.join(pluginDir, 'package.json'));
const yaml = requireFromPlugin('js-yaml');

const { BehaviorOS } = await import(
  pathToFileURL(path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')).href
);
const { buildGovernanceContext } = await import(
  pathToFileURL(path.join(pluginDir, 'dist', 'governance.js')).href
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dnasDir = path.join(repoRoot, 'dnas');
const dnas = fs
  .readdirSync(dnasDir)
  .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
  .sort()
  .map((file) => ({
    key: file.replace(/\.(yaml|yml)$/, ''),
    dna: yaml.load(fs.readFileSync(path.join(dnasDir, file), 'utf-8')),
  }));

const LEVELS = ['strict', 'moderate', 'lenient'];
const PROVIDERS = ['plugin', 'mcp', 'caller-correct'];
const TOOLS_A = ['bash', 'write', 'edit', 'read', 'mcp__server_tool'];
const PHASES = [
  'user_prompt',
  'model_context',
  'tool_execute_before',
  'tool_execute_after',
  'permission_evaluate',
];
const TOOLS_B = ['bash', 'write', 'edit', 'read', 'glob'];

// ---------------------------------------------------------------------------
// Part A — governance reachability
// ---------------------------------------------------------------------------

function conditionFlags(dna) {
  const flags = {};
  for (const rule of dna.governance ?? []) {
    for (const cond of rule.conditions ?? []) {
      flags[cond.type] = cond.value;
    }
  }
  return flags;
}

function hasBlockRule(dna) {
  return (dna.governance ?? []).some((r) => r.action === 'block');
}

// Representative risky action the plugin heuristics can classify (a production
// deploy). Part A measures whether each caller can reach the DNA's rules.
const PLUGIN_ACTION_TEXT = 'deploy to production';

function evaluate(provider, bos, tool, flags) {
  if (provider === 'plugin') {
    // Fixed: the plugin derives a condition bag from the concrete action via
    // buildGovernanceContext, then enforces it through the permission hook.
    const context = buildGovernanceContext({ tool, action: tool, text: PLUGIN_ACTION_TEXT });
    return bos.evaluateGovernance(tool, { agent: 'opencode-agent', context });
  }
  if (provider === 'mcp') {
    // Fixed: the caller's condition bag is nested under `context.context` and
    // always carries the action.
    return bos.evaluateGovernance(tool, {
      agent: 'mcp-client',
      scope: undefined,
      context: { action: tool, ...flags },
    });
  }
  // caller-correct: nested condition context, as the engine and tests expect.
  return bos.evaluateGovernance(tool, {
    agent: 'correct-client',
    context: { action: tool, ...flags },
  });
}

async function partA() {
  const rows = [];
  for (const { key: dnaKey, dna } of dnas) {
    const flags = conditionFlags(dna);
    const blockRule = hasBlockRule(dna);
    for (const level of LEVELS) {
      const bos = new BehaviorOS({ governance: { level } });
      await bos.loadDNA(dna);
      for (const provider of PROVIDERS) {
        for (const tool of TOOLS_A) {
          let verdict = 'error';
          let reason = '';
          try {
            const decision = evaluate(provider, bos, tool, flags);
            verdict = decision.verdict;
            reason = decision.reason;
          } catch (error) {
            reason = error instanceof Error ? error.message : String(error);
          }
          rows.push({
            part: 'A',
            scenarioId: `A:${dnaKey}:${level}:${provider}:${tool}`,
            dna: dnaKey,
            tool,
            provider,
            level,
            verdict,
            reason,
            dnaHasBlockRule: blockRule,
            pluginBlocks: provider === 'plugin' && verdict === 'deny',
            gap: blockRule && verdict === 'allow',
          });
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Part B — trigger / flow matrix (drives the real built plugin hooks)
// ---------------------------------------------------------------------------

let importCounter = 0;
async function loadFreshPlugin() {
  importCounter += 1;
  const url = `${pathToFileURL(path.join(pluginDir, 'dist', 'index.js')).href}?scn=${importCounter}`;
  const mod = await import(url);
  return mod.default;
}

function makeCtx(directory) {
  const addedTools = [];
  const toolHooks = {};
  const sessionHooks = {};
  const permissionHooks = {};
  const register = (bag) => async (name, cb) => {
    bag[name] = cb;
    return { dispose: async () => {} };
  };
  const ctx = {
    location: { directory },
    agent: {
      transform: async (cb) => {
        await cb({
          list: () => [],
          get: () => undefined,
          default: () => {},
          update: () => {},
          remove: () => {},
        });
        return { dispose: async () => {} };
      },
    },
    tool: {
      transform: async (cb) => {
        await cb({
          add: (t) => addedTools.push(t),
          namespace: () => {},
          update: () => {},
          remove: () => {},
          list: () => [],
          get: () => undefined,
        });
        return { dispose: async () => {} };
      },
      hook: register(toolHooks),
    },
    session: { hook: register(sessionHooks) },
    permission: { hook: register(permissionHooks) },
  };
  return { ctx, addedTools, toolHooks, sessionHooks, permissionHooks };
}

async function runPhase(phase, tool, dnaSelected) {
  const plugin = await loadFreshPlugin();
  const { ctx, addedTools, toolHooks, sessionHooks, permissionHooks } = makeCtx(repoRoot);
  const originalLog = console.log;
  console.log = () => {};
  try {
    await plugin.setup(ctx);
  } finally {
    console.log = originalLog;
  }
  const byName = Object.fromEntries(addedTools.map((t) => [t.name, t]));
  if (dnaSelected) {
    await byName.bos_select_dna.execute({ pattern: 'surgical-team' });
  }

  switch (phase) {
    case 'user_prompt': {
      const registered = typeof sessionHooks.prompt === 'function';
      const event = {
        prompt: { text: 'Review the patient record handling for HIPAA' },
        metadata: {},
      };
      if (registered) await sessionHooks.prompt(event);
      const autoSelected = Boolean(event.metadata?.behavioros?.autoSelectedDna);
      return {
        hookRegistered: registered,
        effect: registered
          ? `prompt hook ran (autoSelectedDna=${autoSelected})`
          : 'no prompt hook — message has no Behavior-OS effect',
        gap: !registered,
      };
    }
    case 'model_context': {
      const registered = typeof sessionHooks.context === 'function';
      const event = { system: [] };
      if (registered) await sessionHooks.context(event);
      const injected = event.system.length > 0;
      return {
        hookRegistered: registered,
        effect: injected
          ? 'injected Behavior-OS state into system prompt'
          : 'no injection — model sees no Behaviour-OS guidance',
        gap: !injected,
      };
    }
    case 'tool_execute_before': {
      const registered = typeof toolHooks['execute.before'] === 'function';
      let threw = false;
      if (registered) {
        try {
          await toolHooks['execute.before']({
            tool,
            agent: 'analysis-agent',
            input: { command: 'deploy to production' },
            sessionID: 's',
            messageID: 'm',
            id: 'c',
          });
        } catch {
          threw = true;
        }
      }
      // The before hook is intentionally advisory — enforcement is the
      // permission hook's job — so it must never throw.
      return {
        hookRegistered: registered,
        effect: registered
          ? threw
            ? 'before hook threw (unexpected)'
            : 'advisory only — enforcement handled by permission hook'
          : 'no before hook',
        gap: registered ? threw : true,
      };
    }
    case 'tool_execute_after': {
      const registered = typeof toolHooks['execute.after'] === 'function';
      if (registered) {
        await toolHooks['execute.after']({
          tool,
          status: 'error',
          error: { message: 'simulated failure' },
          sessionID: 's',
        });
      }
      return {
        hookRegistered: registered,
        effect: registered ? 'after hook ran (learning captured)' : 'no after hook',
        gap: !registered,
      };
    }
    case 'permission_evaluate': {
      const registered = typeof permissionHooks.evaluate === 'function';
      const event = {
        action: tool,
        resources: ['deploy to production'],
        agent: 'analysis-agent',
        effect: 'allow',
      };
      if (registered) await permissionHooks.evaluate(event);
      const enforced = event.effect === 'deny' || event.effect === 'ask';
      return {
        hookRegistered: registered,
        effect: registered
          ? `permission hook ran (effect=${event.effect})`
          : 'no permission hook — cannot deny via the official mechanism',
        gap: registered ? dnaSelected && !enforced : true,
      };
    }
    default:
      return { hookRegistered: false, effect: 'unknown phase', gap: true };
  }
}

async function partB() {
  const rows = [];
  const originalLog = console.log;
  console.log = () => {};
  for (const phase of PHASES) {
    for (const dnaSelected of [true, false]) {
      for (const tool of TOOLS_B) {
        const result = await runPhase(phase, tool, dnaSelected);
        rows.push({
          part: 'B',
          scenarioId: `B:${phase}:${dnaSelected ? 'dna' : 'none'}:${tool}`,
          phase,
          dnaSelected,
          tool,
          hookRegistered: result.hookRegistered,
          effect: result.effect,
          gap: result.gap,
        });
      }
    }
  }

  const extras = [
    ['user_prompt', false, '(any)', 'cold session, first user message => auto-select DNA'],
    ['model_context', false, '(any)', 'no DNA selected => cold-start guidance injected'],
    ['tool_execute_before', true, 'bash', 'surgical-team + "deploy to production" (advisory)'],
    ['permission_evaluate', true, 'write', 'surgical-team + "deploy to production" => deny'],
    ['tool_execute_after', true, 'edit', 'capture learning after a failing edit'],
  ];
  for (const [phase, dnaSelected, tool, note] of extras) {
    const result = await runPhase(phase, tool, dnaSelected);
    rows.push({
      part: 'B',
      scenarioId: `B:extra:${phase}:${note}`,
      phase,
      dnaSelected,
      tool,
      hookRegistered: result.hookRegistered,
      effect: result.effect,
      gap: result.gap,
      note,
    });
  }
  console.log = originalLog;
  return rows;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const a = await partA();
const b = await partB();
const all = [...a, ...b];

fs.mkdirSync(outDir, { recursive: true });

// CSV
const columns = [
  'scenarioId',
  'part',
  'dna',
  'tool',
  'provider',
  'level',
  'verdict',
  'dnaHasBlockRule',
  'pluginBlocks',
  'phase',
  'dnaSelected',
  'hookRegistered',
  'effect',
  'gap',
  'note',
];
const esc = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csv = [columns.join(','), ...all.map((r) => columns.map((c) => esc(r[c])).join(','))].join(
  '\n',
);
fs.writeFileSync(path.join(outDir, 'governance-flow-scenarios.csv'), `${csv}\n`, 'utf-8');

// Summary
const withBlockRule = a.filter((r) => r.dnaHasBlockRule);
const providerVerdicts = (provider) => {
  const counts = {};
  for (const r of a.filter((x) => x.provider === provider)) {
    counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  }
  return counts;
};
const summary = {
  generatedAt: new Date().toISOString(),
  totalScenarios: all.length,
  partA: {
    scenarios: a.length,
    dnas: dnas.length,
    dnasWithBlockRule: new Set(withBlockRule.map((r) => r.dna)).size,
    verdictsByProvider: {
      plugin: providerVerdicts('plugin'),
      mcp: providerVerdicts('mcp'),
      'caller-correct': providerVerdicts('caller-correct'),
    },
    scenariosWhereBlockRuleExistsButVerdictAllows: a.filter(
      (r) => r.dnaHasBlockRule && r.verdict === 'allow',
    ).length,
    gapScenarios: a.filter((r) => r.gap).length,
  },
  partB: {
    scenarios: b.length,
    promptHookRegistered: b.filter((r) => r.phase === 'user_prompt' && r.hookRegistered).length,
    afterHookRegistered: b.filter((r) => r.phase === 'tool_execute_after' && r.hookRegistered)
      .length,
    permissionHookRegistered: b.filter((r) => r.phase === 'permission_evaluate' && r.hookRegistered)
      .length,
    toolExecuteBeforeBlocks: b.filter(
      (r) => r.phase === 'tool_execute_before' && r.effect.includes('threw'),
    ).length,
    permissionEnforced: b.filter(
      (r) =>
        r.phase === 'permission_evaluate' &&
        (r.effect.includes('effect=deny') || r.effect.includes('effect=ask')),
    ).length,
    modelContextInjected: b.filter(
      (r) => r.phase === 'model_context' && r.effect.includes('injected'),
    ).length,
    modelContextWithoutDnaInjected: b.filter(
      (r) => r.phase === 'model_context' && !r.dnaSelected && r.effect.includes('injected'),
    ).length,
    gapScenarios: b.filter((r) => r.gap).length,
  },
};
fs.writeFileSync(
  path.join(outDir, 'governance-flow-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf-8',
);

console.log('Enumerated scenarios:', all.length);
console.log('  Part A (governance):', a.length, '| Part B (flow):', b.length);
console.log('  DNAs:', dnas.length, '| with block rule:', summary.partA.dnasWithBlockRule);
console.log('  Verdicts plugin        :', JSON.stringify(summary.partA.verdictsByProvider.plugin));
console.log('  Verdicts mcp           :', JSON.stringify(summary.partA.verdictsByProvider.mcp));
console.log(
  '  Verdicts caller-correct:',
  JSON.stringify(summary.partA.verdictsByProvider['caller-correct']),
);
console.log(
  '  Block-rule-but-allowed :',
  summary.partA.scenariosWhereBlockRuleExistsButVerdictAllows,
);
console.log('  tool.execute.before threw   :', summary.partB.toolExecuteBeforeBlocks);
console.log('  permission enforced         :', summary.partB.permissionEnforced);
console.log('  context injections     :', summary.partB.modelContextInjected);
console.log('  prompt hooks registered :', summary.partB.promptHookRegistered);
console.log('  after hooks registered  :', summary.partB.afterHookRegistered);
console.log('  permission hooks reg.   :', summary.partB.permissionHookRegistered);
console.log(
  '  context injections (dna/no-dna):',
  summary.partB.modelContextInjected,
  '/',
  summary.partB.modelContextWithoutDnaInjected,
);
console.log('  gap scenarios          :', summary.partA.gapScenarios + summary.partB.gapScenarios);
console.log('\nWrote docs/analysis/governance-flow-scenarios.csv');
console.log('Wrote docs/analysis/governance-flow-summary.json');
