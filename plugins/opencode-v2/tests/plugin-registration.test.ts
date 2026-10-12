import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin from '../src/index';

interface CapturedTool {
  name: string;
  description?: string;
  input?: unknown;
  options?: { codemode?: boolean; namespace?: string };
  execute?: (input: unknown, context?: unknown) => Promise<unknown>;
}

interface FakeAgentInfo {
  id: string;
  name: string;
  system?: string;
}

interface FakeContext {
  location: { directory: string };
  agent: {
    transform: (cb: (editor: unknown) => void) => Promise<void>;
  };
  tool: {
    transform: (cb: (editor: unknown) => void) => Promise<void>;
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
  };
  session: {
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
    synthetic?: (input: {
      sessionID: string;
      text: string;
      delivery?: 'steer' | 'queue' | null;
    }) => Promise<unknown>;
  };
  permission: {
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
  };
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
    scan: () => Promise<unknown>;
  };
}

interface FakePermissionEvent {
  action: string;
  resources?: string[];
  agent?: string;
  sessionID?: string;
  metadata?: Record<string, unknown>;
  effect?: 'allow' | 'ask' | 'deny';
  message?: string;
}

function createFakeContext(locationDirectory: string) {
  const addedTools: CapturedTool[] = [];
  const toolHooks: Record<string, unknown> = {};
  const sessionHooks: Record<string, unknown> = {};
  const permissionHooks: Record<string, unknown> = {};
  const storageData = new Map<string, unknown>();
  const syntheticCalls: Array<{ sessionID: string; text: string }> = [];
  const agents: FakeAgentInfo[] = [
    { id: 'build', name: 'Build', system: 'You are the build agent.' },
    { id: 'review', name: 'Review' },
  ];

  const ctx: FakeContext = {
    location: { directory: locationDirectory },
    agent: {
      transform: async (cb) => {
        const editor = {
          list: () => agents,
          get: (id: string) => agents.find((agent) => agent.id === id),
          default: () => {},
          update: (id: string, update: (agent: FakeAgentInfo) => void) => {
            const agent = agents.find((candidate) => candidate.id === id);
            if (agent) update(agent);
          },
          remove: () => {},
        };
        await cb(editor);
      },
    },
    tool: {
      transform: async (cb) => {
        const editor = {
          add: (tool: CapturedTool) => {
            addedTools.push(tool);
          },
          namespace: () => {},
          update: () => {},
          remove: () => {},
        };
        await cb(editor);
      },
      hook: async (name, cb) => {
        toolHooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    session: {
      hook: async (name, cb) => {
        sessionHooks[name] = cb;
        return { dispose: async () => {} };
      },
      synthetic: async (input) => {
        syntheticCalls.push({ sessionID: input.sessionID, text: input.text });
      },
    },
    permission: {
      hook: async (name, cb) => {
        permissionHooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    storage: {
      get: async (key) => storageData.get(key),
      set: async (key, value) => {
        storageData.set(key, value);
      },
      remove: async (key) => {
        storageData.delete(key);
      },
      scan: async () => ({ entries: [] }),
    },
  };

  return {
    ctx,
    addedTools,
    toolHooks,
    sessionHooks,
    permissionHooks,
    storageData,
    agents,
    syntheticCalls,
  };
}

async function runTool(
  addedTools: CapturedTool[],
  name: string,
  input: Record<string, unknown> = {},
): Promise<{ content: string }> {
  const tool = addedTools.find((t) => t.name === name);
  if (!tool?.execute) throw new Error(`tool ${name} not registered`);
  return tool.execute(input) as Promise<{ content: string }>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const emptyDir = path.join(repoRoot, 'plugins', 'opencode-v2', 'tests');

const EXPECTED_TOOLS = [
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

describe('behavior-os plugin registration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly the 13 bos_* tools', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const names = addedTools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('marks every tool as a direct (non-Code-Mode) tool via options.codemode=false', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(addedTools).toHaveLength(13);
    for (const tool of addedTools) {
      expect(tool.options, `tool ${tool.name} is missing options`).toBeDefined();
      expect(tool.options?.codemode, `tool ${tool.name} must set codemode:false`).toBe(false);
    }
  });

  it('loads DNA patterns from ctx.location.directory (not process.cwd())', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const select = addedTools.find((t) => t.name === 'bos_select_dna');
    const enumValues = (
      select?.input as { properties?: { pattern?: { enum?: string[] } } } | undefined
    )?.properties?.pattern?.enum;

    expect(enumValues).toBeDefined();
    expect(enumValues?.length).toBeGreaterThanOrEqual(21);
    expect(enumValues).toContain('surgical-team');
    expect(enumValues).toContain('quantum-computing');
    expect(enumValues).toContain('ai-ml-pipeline');
  });

  it('falls back to built-in patterns when the location has no dnas/ directory', async () => {
    const { ctx, addedTools } = createFakeContext(emptyDir);
    await plugin.setup(ctx as never);

    expect(addedTools).toHaveLength(13);
    const select = addedTools.find((t) => t.name === 'bos_select_dna');
    const enumValues = (
      select?.input as { properties?: { pattern?: { enum?: string[] } } } | undefined
    )?.properties?.pattern?.enum;

    expect(enumValues).toBeDefined();
    expect(enumValues?.length).toBeGreaterThanOrEqual(1);
    expect(enumValues).toContain('surgical-team');
  });

  it('registers the tool, session and permission hooks', async () => {
    const { ctx, toolHooks, sessionHooks, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(Object.keys(toolHooks)).toEqual(
      expect.arrayContaining(['execute.before', 'execute.after']),
    );
    expect(Object.keys(sessionHooks)).toEqual(expect.arrayContaining(['context', 'prompt']));
    expect(Object.keys(permissionHooks)).toContain('evaluate');
    expect(typeof toolHooks['execute.before']).toBe('function');
    expect(typeof toolHooks['execute.after']).toBe('function');
    expect(typeof sessionHooks.context).toBe('function');
    expect(typeof sessionHooks.prompt).toBe('function');
    expect(typeof permissionHooks.evaluate).toBe('function');
  });

  it('injects cold-start guidance into the session context even without a DNA', async () => {
    const { ctx, sessionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const event = { system: [] as Array<{ type: string; text: string }> };
    await (sessionHooks.context as (e: unknown) => Promise<void>)(event);

    expect(event.system).toHaveLength(1);
    expect(event.system[0].text).toContain('No DNA pattern selected');
    expect(event.system[0].text).toContain('bos_select_dna');
  });

  it('appends a governed preamble to every agent system prompt, idempotently', async () => {
    const { ctx, agents } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const build = agents.find((agent) => agent.id === 'build');
    const review = agents.find((agent) => agent.id === 'review');

    // Existing system prompt is preserved and the preamble appended.
    expect(build?.system).toContain('You are the build agent.');
    expect(build?.system).toContain('<!-- behavior-os:governed -->');
    expect(build?.system).toContain('bos_select_dna');
    // Agents without a system prompt still receive it.
    expect(review?.system).toContain('<!-- behavior-os:governed -->');

    // Re-running the transform must not duplicate the preamble.
    await plugin.setup(ctx as never);
    const markerCount = (build?.system?.match(/<!-- behavior-os:governed -->/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('governance and permission hooks are a no-op when no DNA is selected', async () => {
    const { ctx, toolHooks, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const before = toolHooks['execute.before'] as (event: unknown) => Promise<void>;
    await expect(
      before({ tool: 'bash', agent: 'test', input: { command: 'echo hi' } }),
    ).resolves.toBeUndefined();

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = { action: 'bash', resources: ['deploy to production'] };
    await expect(permission(event)).resolves.toBeUndefined();
    expect(event.effect).toBeUndefined();
  });

  it('auto-selects a DNA pattern and opens a single mission from the prompt intent', async () => {
    const { ctx, sessionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const event = {
      prompt: { text: 'Update the patient record handling for HIPAA compliance' },
      metadata: {} as Record<string, unknown>,
    };
    await (sessionHooks.prompt as (e: unknown) => Promise<void>)(event);

    expect(event.metadata.behavioros).toMatchObject({ autoSelectedDna: 'healthcare-hipaa' });
    expect((event.metadata.behavioros as { autoMission?: string }).autoMission).toMatch(
      /^mission-/,
    );

    // A second prompt must not spawn another mission while one is active.
    const second = {
      prompt: { text: 'Now deploy the changes to production' },
      metadata: {} as Record<string, unknown>,
    };
    await (sessionHooks.prompt as (e: unknown) => Promise<void>)(second);
    expect(second.metadata.behavioros).toBeUndefined();
  });

  it('denies a production change through the permission hook once a DNA is selected', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).toBe('deny');
    expect(event.message).toMatch(/surgical/i);
  });

  it('escalates (ask) a deployment through the permission hook under devops-pipeline', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'devops-pipeline' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).toBe('ask');
    expect(event.message).toMatch(/behavior-os/i);
  });

  it('the agent self-check agrees with the enforcer (same inputs → same verdict)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    // Enforcement path: the permission hook decides for the real action.
    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    // Self-check path: the agent asks the engine *before* acting. It must not
    // reach a different conclusion from the code that actually enforces.
    const check = await runTool(addedTools, 'bos_evaluate_governance', {
      action: 'bash',
      agent: 'test',
      tool: 'bash',
      resources: ['deploy to production'],
    });
    const verdict = JSON.parse(check.content) as { verdict: string };

    expect(event.effect).toBe('deny');
    expect(verdict.verdict).toBe('deny');
  });
});

describe('behavior-os plugin tool execution', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupTools() {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    const byName = (name: string) => {
      const tool = addedTools.find((t) => t.name === name);
      expect(tool?.execute, `${name} has no execute`).toBeTypeOf('function');
      return tool as Omit<CapturedTool, 'execute'> & {
        execute: (input: unknown) => Promise<{ content: string }>;
      };
    };
    return byName;
  }

  it('bos_select_dna selects a known pattern', async () => {
    const byName = await setupTools();
    const result = await byName('bos_select_dna').execute({ pattern: 'surgical-team' });
    expect(result.content).toContain('surgical-team');
    expect(result.content).toContain('selected');
  });

  it('bos_select_dna reports unknown patterns without throwing', async () => {
    const byName = await setupTools();
    const result = await byName('bos_select_dna').execute({ pattern: 'nope-not-real' });
    expect(result.content).toContain('not found');
  });

  it('bos_get_state returns JSON with a numeric currentStep', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'surgical-team' });
    const result = await byName('bos_get_state').execute({});

    const state = JSON.parse(result.content) as { currentStep: number; stepHistory: unknown[] };
    expect(typeof state.currentStep).toBe('number');
    expect(state.currentStep).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(state.stepHistory)).toBe(true);
  });

  it('bos_list_dna returns the loaded patterns as JSON', async () => {
    const byName = await setupTools();
    const result = await byName('bos_list_dna').execute({});

    const parsed = JSON.parse(result.content) as { total: number; patterns: unknown[] };
    expect(parsed.total).toBeGreaterThanOrEqual(21);
    expect(parsed.patterns.length).toBe(parsed.total);
  });

  it('bos_evaluate_governance returns a structured verdict', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'surgical-team' });
    const result = await byName('bos_evaluate_governance').execute({
      action: 'deploy',
      agent: 'e2e-agent',
    });

    const verdict = JSON.parse(result.content) as { verdict: string };
    expect(['allow', 'deny', 'escalate']).toContain(verdict.verdict);
  });

  it('bos_evaluate_governance normalizes resources into condition signals', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'surgical-team' });

    // Raw context alone would carry no `production` key; the tool must run the
    // same heuristic the hook uses so "deploy to production" is recognized.
    const result = await byName('bos_evaluate_governance').execute({
      action: 'bash',
      agent: 'e2e-agent',
      tool: 'bash',
      resources: ['deploy to production'],
    });
    const verdict = JSON.parse(result.content) as { verdict: string };

    expect(verdict.verdict).toBe('deny');
  });
});

describe('behavior-os governance log', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bos_get_log surfaces the deny decision with DNA/step/mission stamped', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);
    expect(event.effect).toBe('deny');

    const result = await runTool(addedTools, 'bos_get_log', { limit: 20 });
    const parsed = JSON.parse(result.content) as {
      total: number;
      entries: Array<{
        kind: string;
        outcome: string;
        dna: string | null;
        step: number;
        mission: string | null;
        action: string;
        detail: string;
      }>;
    };

    expect(parsed.total).toBeGreaterThan(0);
    // The engine and the log are module-level singletons shared across tests,
    // so earlier tests may have logged other DNA selections; find the
    // surgical-team entry specifically.
    const dnaEntry = parsed.entries.find(
      (entry) => entry.kind === 'dna_selected' && entry.dna === 'Surgical Team',
    );
    expect(dnaEntry, 'DNA selection should be logged').toBeDefined();

    const denyEntry = parsed.entries.find(
      (entry) => entry.kind === 'permission' && entry.outcome === 'deny',
    );
    expect(denyEntry, 'deny decision should be logged').toBeDefined();
    expect(denyEntry?.dna).toBe('Surgical Team');
    expect(denyEntry?.action).toBe('bash');
    expect(denyEntry?.detail.length).toBeGreaterThan(0);
  });

  it('posts a synthetic session message when a governed action is denied', async () => {
    const { ctx, addedTools, permissionHooks, syntheticCalls } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    await permission({
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-test-123',
      agent: 'test',
      effect: 'allow',
    });

    expect(syntheticCalls.length).toBeGreaterThan(0);
    const denyNote = syntheticCalls.find((call) => call.text.includes('⛔'));
    expect(denyNote, 'deny should produce a synthetic on-screen message').toBeDefined();
    expect(denyNote?.sessionID).toBe('ses-test-123');
  });
});
