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

interface FakeContext {
  location: { directory: string };
  tool: {
    transform: (cb: (editor: unknown) => void) => Promise<void>;
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
  };
  session: {
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
  };
}

function createFakeContext(locationDirectory: string) {
  const addedTools: CapturedTool[] = [];
  const toolHooks: Record<string, unknown> = {};
  const sessionHooks: Record<string, unknown> = {};

  const ctx: FakeContext = {
    location: { directory: locationDirectory },
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
    },
  };

  return { ctx, addedTools, toolHooks, sessionHooks };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const emptyDir = path.join(repoRoot, 'plugins', 'opencode-v2', 'tests');

const EXPECTED_TOOLS = [
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

describe('behavior-os plugin registration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly the 12 bos_* tools', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const names = addedTools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('marks every tool as a direct (non-Code-Mode) tool via options.codemode=false', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(addedTools).toHaveLength(12);
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

    expect(addedTools).toHaveLength(12);
    const select = addedTools.find((t) => t.name === 'bos_select_dna');
    const enumValues = (
      select?.input as { properties?: { pattern?: { enum?: string[] } } } | undefined
    )?.properties?.pattern?.enum;

    expect(enumValues).toBeDefined();
    expect(enumValues?.length).toBeGreaterThanOrEqual(1);
    expect(enumValues).toContain('surgical-team');
  });

  it('registers the execute.before governance hook and the session context hook', async () => {
    const { ctx, toolHooks, sessionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(Object.keys(toolHooks)).toContain('execute.before');
    expect(Object.keys(sessionHooks)).toContain('context');
    expect(typeof toolHooks['execute.before']).toBe('function');
    expect(typeof sessionHooks.context).toBe('function');
  });

  it('governance hook is a no-op when no DNA is selected', async () => {
    const { ctx, toolHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const hook = toolHooks['execute.before'] as (event: unknown) => Promise<void>;
    await expect(
      hook({ tool: 'bash', agent: 'test', input: { command: 'echo hi' } }),
    ).resolves.toBeUndefined();
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
      return tool as CapturedTool & { execute: (input: unknown) => Promise<{ content: string }> };
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
});
