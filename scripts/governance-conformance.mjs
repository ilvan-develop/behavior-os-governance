#!/usr/bin/env node
/**
 * Behavior-OS — Governance Conformance Harness
 *
 * Answers one question: *"how do we prove the governance promises hold?"*
 *
 * You cannot prove "100% governance" as a vibe. You can only prove it as
 * **coverage over an explicitly enumerated, executable set of claims**. This
 * script enumerates every promise Behavior-OS makes to an agent host, turns each
 * one into a falsifiable check, runs them against the *current build* in-process,
 * and prints a claims -> evidence table plus a machine-readable report.
 *
 * Hermetic on purpose: it spins up the real plugin (`plugins/opencode-v2/dist`)
 * with a stubbed host, and the real core engine (`packages/core/dist`), so it
 * does not depend on a live OpenCode server, on network, or on transient state.
 *
 * Exit code is non-zero if any claim FAILs, so it can gate CI.
 *
 * Usage: node scripts/governance-conformance.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorOS } from '../packages/core/dist/index.js';
import plugin from '../plugins/opencode-v2/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(repoRoot, 'docs', 'analysis', 'governance-conformance.json');

class ClaimFailure extends Error {}

function expect(condition, message) {
  if (!condition) throw new ClaimFailure(message);
}

/**
 * Boot the real plugin against a stubbed OpenCode host and return the handles a
 * claim needs: the registered tools, the hooks, and the on-screen notifications.
 * Pass a freshly imported module to simulate a second, independent instance.
 */
async function bootPlugin(pluginModule = plugin, sharedStorage) {
  const addedTools = [];
  const toolHooks = new Map();
  const sessionHooks = new Map();
  const permissionHooks = new Map();
  const syntheticCalls = [];
  const storage = sharedStorage ?? new Map();
  const agents = [
    { id: 'build', name: 'Build', system: 'You are the build agent.' },
    { id: 'review', name: 'Review' },
  ];

  const ctx = {
    location: { directory: repoRoot },
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
      async synthetic(input) {
        syntheticCalls.push(input);
        return { id: `synthetic-${syntheticCalls.length}` };
      },
    },
    permission: {
      hook(name, cb) {
        permissionHooks.set(name, cb);
      },
    },
    storage: {
      async get(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      async set(key, value) {
        // Await the underlying write: a storage stub may be asynchronous, and
        // the plugin re-reads the store right after writing to verify the write
        // landed. Fire-and-forget would break that verification.
        await storage.set(key, value);
      },
    },
  };

  await pluginModule.setup(ctx);

  const byName = Object.fromEntries(addedTools.map((tool) => [tool.name, tool]));
  const runTool = async (name, input = {}) => {
    const tool = byName[name];
    if (!tool) throw new ClaimFailure(`tool "${name}" is not registered`);
    const result = await tool.execute(input);
    // Most tools return JSON, but some (select_dna, create_mission, ...) return a
    // human-readable sentence. Normalise both so claims can read fields directly.
    try {
      return JSON.parse(result.content);
    } catch {
      return result.content;
    }
  };

  return {
    ctx,
    agents,
    addedTools,
    toolHooks,
    sessionHooks,
    permissionHooks,
    syntheticCalls,
    storage,
    runTool,
  };
}

const SURGICAL = 'surgical-team';
const ENTERPRISE = 'enterprise-governance';
const MINIMAL_DNA = {
  name: 'Conformance DNA',
  version: '1.0.0',
  description: 'Minimal DNA used to verify engine-level promises',
  personas: [],
  governance: [
    {
      id: 'conformance-block',
      level: 'critical',
      action: 'block',
      conditions: [{ type: 'production', value: true }],
      description: 'Block production changes',
    },
  ],
  quality: [{ id: 'coverage', type: 'test_coverage', threshold: 100 }],
};

const claims = [
  {
    id: 'C01',
    category: 'ENFORCEMENT',
    promise: 'Surgical Team blocks production changes (permission hook → deny)',
    async check(env) {
      await env.runTool('bos_select_dna', { pattern: SURGICAL });
      const event = {
        action: 'bash',
        resources: ['deploy to production'],
        agent: 'conformance',
        effect: 'allow',
      };
      await env.permissionHooks.get('evaluate')(event);
      expect(event.effect === 'deny', `expected effect "deny", got "${event.effect}"`);
      expect(/surgical/i.test(event.message ?? ''), 'denial must name the active DNA');
      return { status: 'PASS', evidence: `effect=deny message="${event.message}"` };
    },
  },
  {
    id: 'C02',
    category: 'CONSISTENCY',
    promise: 'Agent self-check agrees with enforcement (same action → deny)',
    async check(env) {
      const result = await env.runTool('bos_evaluate_governance', {
        action: 'bash',
        agent: 'conformance',
        tool: 'bash',
        resources: ['deploy to production'],
      });
      expect(
        result.verdict === 'deny',
        `bos_evaluate_governance returned "${result.verdict}" but the enforcer denies`,
      );
      return { status: 'PASS', evidence: `verdict=deny rules=${result.rulesEvaluated?.join(',')}` };
    },
  },
  {
    id: 'C03',
    category: 'ENFORCEMENT',
    promise: 'Enterprise Governance escalates changes (permission hook → ask)',
    async check(env) {
      await env.runTool('bos_select_dna', { pattern: ENTERPRISE });
      const event = { action: 'bash', agent: 'conformance', effect: 'allow' };
      await env.permissionHooks.get('evaluate')(event);
      expect(event.effect === 'ask', `expected effect "ask" (escalate), got "${event.effect}"`);
      return { status: 'PASS', evidence: `effect=ask message="${event.message}"` };
    },
  },
  {
    id: 'C04',
    category: 'CONSISTENCY',
    promise: 'Agent self-check agrees with escalation (same action → escalate)',
    async check(env) {
      const result = await env.runTool('bos_evaluate_governance', {
        action: 'bash',
        agent: 'conformance',
        tool: 'bash',
      });
      expect(
        result.verdict === 'escalate',
        `bos_evaluate_governance returned "${result.verdict}" but the enforcer escalates`,
      );
      return {
        status: 'PASS',
        evidence: `verdict=escalate rules=${result.rulesEvaluated?.join(',')}`,
      };
    },
  },
  {
    id: 'C05',
    category: 'OBSERVABILITY',
    promise: 'Every deny/escalate is recorded in the governance log with DNA + step',
    async check(env) {
      const log = await env.runTool('bos_get_log', { limit: 100 });
      const deny = log.entries.filter((e) => e.kind === 'permission' && e.outcome === 'deny');
      expect(deny.length > 0, 'no permission "deny" entry was recorded');
      const entry = deny[deny.length - 1];
      expect(entry.dna === 'Surgical Team', `deny entry dna="${entry.dna}"`);
      expect(typeof entry.step === 'number', 'deny entry is missing its protocol step');
      return {
        status: 'PASS',
        evidence: `deny entries=${deny.length} dna=${entry.dna} step=${entry.step}`,
      };
    },
  },
  {
    id: 'C06',
    category: 'OBSERVABILITY',
    promise: 'Governance log is bounded and monotonic (ring buffer, seq++ )',
    async check(env) {
      const log = await env.runTool('bos_get_log', { limit: 500 });
      expect(log.entries.length <= 200, `log holds ${log.entries.length} entries (> 200)`);
      let previous = 0;
      for (const entry of log.entries) {
        expect(entry.seq > previous, `seq not monotonic at ${entry.seq}`);
        previous = entry.seq;
      }
      return { status: 'PASS', evidence: `${log.entries.length} entries, seq monotonic` };
    },
  },
  {
    id: 'C07',
    category: 'PROTOCOL',
    promise: 'Selecting a DNA pattern records protocol step 1 (monotonic history)',
    async check(env) {
      const state = await env.runTool('bos_get_state');
      const entry = (state.stepHistory ?? []).find((e) => e.tool === 'bos_select_dna');
      expect(entry?.step === 1, `bos_select_dna not recorded as step 1 (got ${entry?.step})`);
      expect(state.currentStep >= 1, `currentStep=${state.currentStep}`);
      return { status: 'PASS', evidence: `step1 recorded, currentStep=${state.currentStep}` };
    },
  },
  {
    id: 'C08',
    category: 'PERSISTENCE',
    promise: 'exportState → importState round-trips DNA, step and missions',
    async check() {
      const source = new BehaviorOS();
      await source.loadDNA(MINIMAL_DNA);
      source.createMission({ title: 'Conformance', type: 'feature', priority: 'medium' });
      const snapshot = JSON.parse(JSON.stringify(source.exportState()));

      const restored = new BehaviorOS();
      const ok = restored.importState(snapshot);
      expect(ok === true, 'importState returned false for a snapshot from the same version');
      const state = restored.getState();
      expect(state.selectedDna === 'Conformance DNA', `restored dna="${state.selectedDna}"`);
      expect(restored.listMissions().length === 1, 'mission list did not survive the round-trip');
      return { status: 'PASS', evidence: `dna=${state.selectedDna} missionCount=1` };
    },
  },
  {
    id: 'C09',
    category: 'CONSISTENCY',
    promise: 'Starting a mission sets activeMission to that mission id (no divergence)',
    async check(env) {
      await env.runTool('bos_create_mission', {
        title: 'Conformance mission',
        type: 'feature',
        priority: 'medium',
      });
      // The create tool returns a human string; recover the id from the mission list.
      const missions = await env.runTool('bos_list_missions', { limit: 50 });
      const target = missions[missions.length - 1];
      expect(target?.id, 'no mission was created');
      await env.runTool('bos_start_mission', { missionId: target.id });
      const state = await env.runTool('bos_get_state');
      expect(
        state.activeMission === target.id,
        `activeMission="${state.activeMission}" but started mission "${target.id}"`,
      );
      const active = missions.find((m) => m.id === target.id);
      return {
        status: 'PASS',
        evidence: `activeMission=${target.id} status=${active?.status ?? 'unknown'}`,
      };
    },
  },
  {
    id: 'C10',
    category: 'QUALITY',
    promise: 'Quality gates enforce the active DNA thresholds',
    async check(env) {
      await env.runTool('bos_select_dna', { pattern: SURGICAL });
      const failing = await env.runTool('bos_check_quality', { metrics: { test_coverage: 50 } });
      expect(failing.passed === false, 'quality gate did NOT fail at 50% coverage (threshold=100)');
      const passing = await env.runTool('bos_check_quality', { metrics: { test_coverage: 100 } });
      expect(passing.passed === true, 'quality gate did not pass at 100% coverage');
      return { status: 'PASS', evidence: 'threshold 100: 50%→fail, 100%→pass' };
    },
  },
  {
    id: 'C11',
    category: 'LEARNING',
    promise: 'Recorded learnings surface through the insights API',
    async check(env) {
      await env.runTool('bos_record_learning', {
        type: 'failure',
        source: 'conformance',
        content: 'Conformance harness learning probe',
        impact: 'high',
      });
      const insights = await env.runTool('bos_get_insights', { limit: 10 });
      const list = Array.isArray(insights) ? insights : (insights.insights ?? []);
      expect(list.length > 0, 'recorded learning did not appear in insights');
      return { status: 'PASS', evidence: `${list.length} insight(s) returned` };
    },
  },
  {
    id: 'C12',
    category: 'OBSERVABILITY',
    promise: 'Deny/escalate surfaces an on-screen notification (synthetic message)',
    async check(env) {
      await env.runTool('bos_select_dna', { pattern: SURGICAL });
      const before = env.syntheticCalls.length;
      const event = {
        action: 'write',
        resources: ['deploy to production'],
        agent: 'conformance',
        effect: 'allow',
        sessionID: 'ses-conformance',
      };
      await env.permissionHooks.get('evaluate')(event);
      expect(event.effect === 'deny', `expected deny, got ${event.effect}`);
      const emitted = env.syntheticCalls.slice(before);
      expect(emitted.length > 0, 'no synthetic notification was emitted for the denial');
      expect(/blocked/i.test(emitted[0].text ?? ''), 'notification does not describe the block');
      return { status: 'PASS', evidence: `synthetic: "${emitted[0].text}"` };
    },
  },
  {
    id: 'C13',
    category: 'CONSISTENCY',
    promise: 'Auto-mission from a prompt leaves activeMission == the opened mission',
    async check() {
      // Boot a *second, independent* module instance (fresh singleton + storage)
      // so this claim reproduces the session.prompt path in isolation.
      const fresh = await import(
        new URL(`../plugins/opencode-v2/dist/index.js?fresh=${Date.now()}`, import.meta.url).href
      );
      const env = await bootPlugin(fresh.default);
      const event = {
        prompt: { text: 'Fix the crash in the payment service' },
        metadata: {},
      };
      await env.sessionHooks.get('prompt')(event);
      const auto = event.metadata?.behavioros?.autoMission;
      expect(/^mission-/.test(auto ?? ''), 'prompt hook did not auto-open a mission');
      const state = await env.runTool('bos_get_state');
      expect(
        state.activeMission === auto,
        `activeMission="${state.activeMission}" != autoMission="${auto}"`,
      );
      return { status: 'PASS', evidence: `autoMission=${auto} == activeMission` };
    },
  },
  {
    id: 'C14',
    category: 'OBSERVABILITY',
    promise: 'Log entries carry a stable instance id (cross-instance divergence visible)',
    async check(env) {
      const log = await env.runTool('bos_get_log', { limit: 20 });
      expect(log.entries.length > 0, 'no log entries to inspect');
      const ids = new Set(log.entries.map((entry) => entry.instance));
      expect(
        log.entries.every(
          (entry) => typeof entry.instance === 'string' && entry.instance.length > 0,
        ),
        'an entry is missing its instance id',
      );
      expect(ids.size === 1, `instance id is not stable within a process: ${[...ids].join(',')}`);
      return {
        status: 'PASS',
        evidence: `instance=${[...ids][0]} across ${log.entries.length} entries`,
      };
    },
  },
  {
    id: 'C15',
    category: 'CONSISTENCY',
    promise: 'Concurrent instances adopt-then-write (monotonic revisions, no clobber)',
    async check() {
      // The contract is pure and identity-driven, so it is proven directly with
      // two distinct writer ids (a real second instance is a second process).
      const { planPersist } = await import(
        new URL('../plugins/opencode-v2/dist/storage-sync.js', import.meta.url).href
      );

      // B is stale (rev 2); the store holds A's newer rev 5 -> adopt before write.
      const foreign = planPersist({
        localRevision: 2,
        instanceId: 'inst-B',
        storedRevision: 5,
        storedWriter: 'inst-A',
      });
      expect(foreign.adopt === true, 'a newer foreign snapshot must be adopted before writing');
      expect(foreign.nextRevision === 6, `expected next=6, got ${foreign.nextRevision}`);

      // Same writer -> not foreign; revisions still move forward.
      const self = planPersist({
        localRevision: 7,
        instanceId: 'inst-A',
        storedRevision: 5,
        storedWriter: 'inst-A',
      });
      expect(self.adopt === false, 'a snapshot written by self must not be treated as foreign');
      expect(self.nextRevision === 8, `expected next=8, got ${self.nextRevision}`);

      // Local is ahead of the store -> never adopt an older snapshot.
      const ahead = planPersist({
        localRevision: 9,
        instanceId: 'inst-B',
        storedRevision: 4,
        storedWriter: 'inst-A',
      });
      expect(ahead.adopt === false, 'an older snapshot must not be adopted');
      expect(ahead.nextRevision === 10, `expected next=10, got ${ahead.nextRevision}`);

      return {
        status: 'PASS',
        evidence: 'foreign→adopt rev6; self→rev8; stale-store→rev10',
      };
    },
  },
  {
    id: 'C16',
    category: 'CONSISTENCY',
    promise: 'Conflict merge preserves local items (no lost update on adopt)',
    async check() {
      const { mergeSnapshots } = await import(
        new URL('../plugins/opencode-v2/dist/storage-sync.js', import.meta.url).href
      );

      const merged = mergeSnapshots(
        {
          missions: [
            { id: 'm1', title: 'local-edit' },
            { id: 'm2', title: 'local-only' },
          ],
        },
        {
          missions: [
            { id: 'm1', title: 'foreign-edit' },
            { id: 'm3', title: 'foreign-only' },
          ],
        },
      );
      const titles = merged.missions.map((m) => m.title).sort();
      expect(
        titles.join(',') === 'foreign-edit,foreign-only,local-only',
        `an item was lost in the merge: [${titles.join(',')}]`,
      );
      expect(merged.missions.length === 3, `expected 3 missions, got ${merged.missions.length}`);

      const mergedLearnings = mergeSnapshots(
        { learnings: [{ id: 'l1', content: 'local' }] },
        { learnings: [{ id: 'l2', content: 'foreign' }] },
      );
      expect(mergedLearnings.learnings.length === 2, 'a learning was lost in the merge');

      return {
        status: 'PASS',
        evidence: `missions=[${titles.join(',')}] learnings=2 (same id → foreign/newer wins)`,
      };
    },
  },
  {
    id: 'C17',
    category: 'CONSISTENCY',
    promise:
      'Concurrent persists in one instance are serialized (single-flight): monotonic revisions, no lost write',
    async check() {
      const records = [];
      class SlowRecordMap extends Map {
        constructor(delayMs = 15) {
          super();
          this._delayMs = delayMs;
        }
        async set(key, value) {
          // Slow storage widens the get/set interleaving window: without the
          // single-flight lock two concurrent persists would both read the same
          // base revision and plan the same next one.
          await new Promise((resolve) => setTimeout(resolve, this._delayMs));
          records.push({
            rev: value?.revision ?? null,
            writer: value?.writer ?? null,
            missions: (value?.missions ?? []).map((m) => m.title),
          });
          return super.set(key, value);
        }
      }

      const env = await bootPlugin(plugin, new SlowRecordMap());
      await env.runTool('bos_select_dna', { pattern: 'surgical-team' });
      const before = records.length;
      await Promise.all([
        env.runTool('bos_create_mission', {
          title: 'race-a',
          type: 'feature',
          priority: 'high',
        }),
        env.runTool('bos_create_mission', {
          title: 'race-b',
          type: 'feature',
          priority: 'high',
        }),
      ]);
      const after = records.length;
      expect(after > before, 'the concurrent persists never reached storage');

      const revs = records.map((r) => r.rev).filter((r) => r !== null);
      for (let i = 1; i < revs.length; i += 1) {
        expect(
          revs[i] > revs[i - 1],
          `revisions are not strictly monotonic under contention: [${revs.join(',')}]`,
        );
      }

      const stored = env.storage.get('behavioros:state');
      const titles = (stored?.missions ?? []).map((m) => m.title).sort();
      expect(
        titles.includes('race-a') && titles.includes('race-b'),
        `a racing mission was lost: [${titles.join(',')}]`,
      );

      return {
        status: 'PASS',
        evidence: `revs=[${revs.join(',')}] missions=[${titles.join(',')}]`,
      };
    },
  },
];

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

async function main() {
  const env = await bootPlugin();
  const results = [];

  for (const claim of claims) {
    try {
      const outcome = await claim.check(env);
      results.push({ ...claim, ...outcome });
    } catch (error) {
      results.push({
        id: claim.id,
        category: claim.category,
        promise: claim.promise,
        status: 'FAIL',
        evidence: error instanceof ClaimFailure ? error.message : `threw: ${error.message}`,
      });
    }
  }

  const idWidth = 4;
  const catWidth = Math.max(...results.map((r) => r.category.length));
  const statusWidth = 6;

  console.log('\nBehavior-OS — Governance Conformance Report');
  console.log('='.repeat(78));
  for (const result of results) {
    console.log(
      `${pad(result.id, idWidth)} ${pad(result.category, catWidth)} ${pad(result.status, statusWidth)} ${result.promise}`,
    );
    if (result.status === 'FAIL') {
      console.log(`${' '.repeat(idWidth + catWidth + statusWidth + 3)}↳ ${result.evidence}`);
    }
  }
  console.log('-'.repeat(78));

  const proven = results.filter((r) => r.status === 'PASS').length;
  const failures = results.filter((r) => r.status === 'FAIL');
  const total = results.length;
  const coverage = Math.round((proven / total) * 100);
  console.log(`Proven: ${proven}/${total} claims (${coverage}%)  |  Failures: ${failures.length}`);
  console.log('='.repeat(78));

  const report = {
    generatedAt: new Date().toISOString(),
    plugin: plugin.id,
    total,
    proven,
    coverage,
    claims: results.map((r) => ({
      id: r.id,
      category: r.category,
      promise: r.promise,
      status: r.status,
      evidence: r.evidence,
    })),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${path.relative(repoRoot, REPORT_PATH)}`);

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Conformance harness crashed:', error);
  process.exit(1);
});
