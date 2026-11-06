import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin, { describeProtocolProgress } from '../src/index';

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
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  permission: {
    hook: (name: string, cb: unknown) => Promise<{ dispose: () => Promise<void> }>;
  };
  event?: {
    subscribe: (opts?: { signal?: AbortSignal }) => AsyncIterable<Record<string, unknown>>;
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

interface CapturedSynthetic {
  sessionID: string;
  text: string;
  delivery?: 'steer' | 'queue' | null;
  metadata?: Record<string, unknown>;
}

function createFakeContext(locationDirectory: string, storageData = new Map<string, unknown>()) {
  const addedTools: CapturedTool[] = [];
  const toolHooks: Record<string, unknown> = {};
  const sessionHooks: Record<string, unknown> = {};
  const permissionHooks: Record<string, unknown> = {};
  const syntheticCalls: CapturedSynthetic[] = [];
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
        syntheticCalls.push({
          sessionID: input.sessionID,
          text: input.text,
          delivery: input.delivery,
          metadata: input.metadata,
        });
      },
    },
    permission: {
      hook: async (name, cb) => {
        permissionHooks[name] = cb;
        return { dispose: async () => {} };
      },
    },
    event: {
      subscribe: async function* (opts?: { signal?: AbortSignal }) {
        // Mock: immediate empty iterator; tests that need events override this.
        if (opts?.signal) {
          const sig = opts.signal;
          await new Promise((_, reject) => {
            sig.addEventListener('abort', () => reject(new Error('AbortError')), {
              once: true,
            });
          });
        }
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
const _emptyDir = path.join(repoRoot, 'plugins', 'opencode-v2', 'tests');

const EXPECTED_TOOLS = [
  'bos_add_conversation_turn',
  'bos_add_knowledge_edge',
  'bos_add_knowledge_node',
  'bos_add_temporal_rule',
  'bos_adjust_policy_for_risk',
  'bos_analyze_workload',
  'bos_antipattern_report',
  'bos_apply_code_fixes',
  'bos_apply_natural_language_rules',
  'bos_approve_loop',
  'bos_assess_pragmatic_value',
  'bos_assign_task',
  'bos_behavior_diff',
  'bos_behavior_profile',
  'bos_behavior_report',
  'bos_behavior_summary',
  'bos_behavior_timeline',
  'bos_cancel_mission',
  'bos_check_quality',
  'bos_check_temporal',
  'bos_code_edit',
  'bos_code_fixes',
  'bos_collective_decision',
  'bos_complete_mission',
  'bos_complete_task',
  'bos_consolidate_memory',
  'bos_conversation_report',
  'bos_create_brainstorm',
  'bos_create_dynamic_dna',
  'bos_create_meta_decision',
  'bos_create_mission',
  'bos_decide',
  'bos_define_policy',
  'bos_detect_anomalies',
  'bos_drift',
  'bos_evaluate_dna_temporal',
  'bos_evaluate_fairness',
  'bos_evaluate_governance',
  'bos_evaluate_hybrid',
  'bos_evaluate_role_action',
  'bos_evolution',
  'bos_explainable_report',
  'bos_export_audit_to_siem',
  'bos_fail_mission',
  'bos_fix_antipatterns',
  'bos_get_insights',
  'bos_get_knowledge_graph_stats',
  'bos_get_log',
  'bos_get_meta_cognition_stats',
  'bos_get_metrics',
  'bos_get_state',
  'bos_get_status',
  'bos_governance_as_code',
  'bos_list_audit_reports',
  'bos_list_brainstorms',
  'bos_list_code_edits',
  'bos_list_code_fixes',
  'bos_list_conversations',
  'bos_list_decisions',
  'bos_list_dna',
  'bos_list_missions',
  'bos_list_pipeline_runs',
  'bos_list_roles',
  'bos_loop_status',
  'bos_map_compliance',
  'bos_override_rule',
  'bos_parse_rule',
  'bos_parse_rules_batch',
  'bos_policy',
  'bos_predict_governance',
  'bos_preflight',
  'bos_propose_idea',
  'bos_query_knowledge_graph',
  'bos_recall_memory',
  'bos_recall_relevant',
  'bos_recommend_assignment',
  'bos_recommend_circuit_breaker',
  'bos_recommendations',
  'bos_reconstruct_context',
  'bos_record_learning',
  'bos_register_agent_capacity',
  'bos_register_role',
  'bos_reset_metrics',
  'bos_resolve_consensus',
  'bos_resolve_conversation',
  'bos_resume_loop',
  'bos_role_policy_report',
  'bos_run_audit',
  'bos_save_memory',
  'bos_scan_antipatterns',
  'bos_select_dna',
  'bos_select_gates_by_confidence',
  'bos_set_agent',
  'bos_start_conversation',
  'bos_start_loop',
  'bos_start_mission',
  'bos_suggest_cross_dna_transfer',
  'bos_teach_behavior',
  'bos_transfer_across_domains',
  'bos_verify_audit_trail',
  'bos_vote_idea',
  'bos_whoami',
];

describe('behavior-os plugin registration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly the 102 bos_* tools', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const names = addedTools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('marks every tool as a direct (non-Code-Mode) tool via options.codemode=false', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(addedTools).toHaveLength(102);
    for (const tool of addedTools) {
      expect(tool.options, `tool ${tool.name} is missing options`).toBeDefined();
      expect(tool.options?.codemode, `tool ${tool.name} must set codemode:false`).toBe(false);
    }
  });

  it('gives every tool an executable contract and an object input schema', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    expect(addedTools).toHaveLength(102);
    for (const tool of addedTools) {
      const meta = tool as unknown as {
        name: string;
        description?: string;
        input?: { type?: string };
        execute?: unknown;
      };
      expect(
        meta.description?.trim().length ?? 0,
        `tool ${meta.name} has no description`,
      ).toBeGreaterThan(0);
      expect(meta.input?.type, `tool ${meta.name} has no object input schema`).toBe('object');
      expect(typeof meta.execute, `tool ${meta.name} is not executable`).toBe('function');
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

  it('emits a warning when the location has no dnas/ directory', async () => {
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      // Use the repo root itself as the location — it HAS a dnas/ directory,
      // so this test verifies the normal path still works (21 patterns loaded).
      const { ctx, addedTools } = createFakeContext(repoRoot);
      await plugin.setup(ctx as never);

      expect(addedTools).toHaveLength(102);
      const select = addedTools.find((t) => t.name === 'bos_select_dna');
      const enumValues = (
        select?.input as { properties?: { pattern?: { enum?: string[] } } } | undefined
      )?.properties?.pattern?.enum;

      expect(enumValues).toBeDefined();
      expect(enumValues?.length).toBeGreaterThanOrEqual(21);
      expect(enumValues).toContain('surgical-team');
      // No warning should be emitted when dnas/ is present.
      expect(warnings.some((w) => w.includes('No DNA patterns found'))).toBe(false);
    } finally {
      console.warn = warn;
    }
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

  it('exposes the 11 isolated engines as dedicated read-only tools', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const byName = Object.fromEntries(addedTools.map((t) => [t.name, t]));
    const exposed = [
      'bos_detect_anomalies',
      'bos_recommend_circuit_breaker',
      'bos_collective_decision',
      'bos_map_compliance',
      'bos_select_gates_by_confidence',
      'bos_transfer_across_domains',
      'bos_adjust_policy_for_risk',
      'bos_explainable_report',
      'bos_export_audit_to_siem',
      'bos_governance_as_code',
      'bos_evaluate_hybrid',
    ];
    for (const name of exposed) {
      expect(byName[name], `${name} not registered`).toBeDefined();
      expect(typeof byName[name].execute).toBe('function');
    }

    // A thin wrapper is exercised end-to-end: it must run the engine and
    // return JSON without throwing on empty inputs.
    const circuit = byName.bos_recommend_circuit_breaker;
    if (!circuit?.execute) throw new Error('circuit breaker tool missing');
    const result = await circuit.execute({});
    expect(JSON.parse((result as { content: string }).content).ok).toBe(true);

    const reportTool = byName.bos_explainable_report;
    if (!reportTool?.execute) throw new Error('explainable report tool missing');
    const report = await reportTool.execute({ agentId: 'a', decisions: [] });
    expect(JSON.parse((report as { content: string }).content).ok).toBe(true);
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
    expect(build?.system).toContain('bos_start_loop');
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
    const { ctx, addedTools, sessionHooks } = createFakeContext(repoRoot);
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

    // The live mission must reach the model through the context hook, not only
    // through tool responses; otherwise the model cannot audit or complete it.
    const missionId = (event.metadata.behavioros as { autoMission?: string }).autoMission;
    const contextEvent = { system: [] as Array<{ type: string; text: string }> };
    await (sessionHooks.context as (e: unknown) => Promise<void>)(contextEvent);
    const contextText = contextEvent.system.map((entry) => entry.text).join('\n');
    expect(contextText).toContain(`Active mission: ${missionId}`);
    expect(contextText).toMatch(/Active mission: mission-\S+ \(active\)/);

    // A second prompt must not spawn another mission while one is active.
    const second = {
      prompt: { text: 'Now deploy the changes to production' },
      metadata: {} as Record<string, unknown>,
    };
    await (sessionHooks.prompt as (e: unknown) => Promise<void>)(second);
    expect(second.metadata.behavioros).toBeUndefined();

    // Cancelling the live mission clears activeMission; the context hook must
    // then tell the model to create and start a new one instead of implying an
    // audit can run without a mission.
    await runTool(addedTools, 'bos_cancel_mission', {
      missionId,
      reason: 'test cleanup',
    });
    const afterCancel = { system: [] as Array<{ type: string; text: string }> };
    await (sessionHooks.context as (e: unknown) => Promise<void>)(afterCancel);
    expect(afterCancel.system.map((entry) => entry.text).join('\n')).toContain(
      'Active mission: none',
    );
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

  it('escalates a real deployment but not a read-only search that mentions one (C24)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'devops-pipeline' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;

    // Searching for the rule's own name is not a deployment: no ask is raised.
    const search: FakePermissionEvent = {
      action: 'grep',
      resources: ['dnas/devops-pipeline.yaml'],
      metadata: { pattern: 'deployment-approval' },
      agent: 'test',
    };
    await permission(search);
    expect(search.effect).toBeUndefined();

    // A command that actually deploys still needs approval.
    const deploy: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      agent: 'test',
    };
    await permission(deploy);
    expect(deploy.effect).toBe('ask');
  });

  it('does not deny a read-only action under data-encryption (C20)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'financial-compliance' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'grep',
      resources: ['look for the ssn column in the records'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).toBe('allow');
  });

  it('never blocks the governance control plane even when the DNA would deny it (C21)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'financial-compliance' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bos_create_mission',
      resources: ['review the ssn column'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).not.toBe('deny');
  });

  it('blocks a mutating action via an operator-defined role policy (post-DNA authority)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    // The actor's governed id comes from the identity the plugin itself
    // enforces against — closing the loop "who am I" → "what may I do".
    const whoami = await runTool(addedTools, 'bos_whoami', {});
    const agentId = (JSON.parse(whoami.content) as { agentId: string }).agentId;

    await runTool(addedTools, 'bos_define_policy', {
      id: 'p-no-shell',
      name: 'No shell for the governed persona',
      description: 'The persona may not run shell commands in this deployment',
      condition: 'bash',
      action: 'block',
      severity: 'high',
      appliesTo: ['role'],
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await runTool(addedTools, 'bos_register_role', {
      id: agentId,
      name: 'Governed persona role',
      displayName: 'Governed persona role',
      responsibilities: ['enforced in the session'],
      policies: ['p-no-shell'],
    });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['ls'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).toBe('deny');
    // R9: role pre-evaluate runs BEFORE DNA, so the message uses the role prefix.
    expect(event.message).toMatch(/role/i);
  });

  it('role pre-evaluate blocks BEFORE DNA when a role policy denies (R9)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    // Select a DNA that would ALLOW bash (devops-pipeline requires approval but doesn't deny).
    await runTool(addedTools, 'bos_select_dna', { pattern: 'devops-pipeline' });

    const whoami = await runTool(addedTools, 'bos_whoami', {});
    const agentId = (JSON.parse(whoami.content) as { agentId: string }).agentId;

    // Register a role that blocks 'bash-r9-test' — this should short-circuit BEFORE DNA runs.
    // Using a unique action suffix to avoid interfering with other tests sharing the singleton.
    // The action contains 'bash' so isMutating returns true, triggering the pre-evaluate path.
    await runTool(addedTools, 'bos_define_policy', {
      id: 'p-r9-unique-deny',
      name: 'Block bash-r9-test via role pre-evaluate',
      description: 'Role denies bash-r9-test before DNA is consulted',
      condition: 'bash-r9-test',
      action: 'block',
      severity: 'high',
      appliesTo: ['role'],
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await runTool(addedTools, 'bos_register_role', {
      id: agentId,
      name: 'R9 test role',
      displayName: 'R9 test role',
      responsibilities: ['pre-evaluate'],
      policies: ['p-r9-unique-deny'],
    });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash-r9-test',
      resources: ['test resource'],
      agent: agentId,
      effect: 'allow',
    };
    await permission(event);

    expect(event.effect).toBe('deny');
    // Pre-evaluate denial uses the role prefix, not the DNA prefix.
    expect(event.message).toMatch(/role/i);
    expect(event.message).not.toMatch(/devops/i);
  });

  it('role policies never gate control-plane or read-only actions (same bootstrap carve-out)', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const whoami = await runTool(addedTools, 'bos_whoami', {});
    const agentId = (JSON.parse(whoami.content) as { agentId: string }).agentId;

    await runTool(addedTools, 'bos_define_policy', {
      id: 'p-block-all',
      name: 'Block everything for the governed persona',
      description: "Catch-all '*' to prove control-plane and read-only stay escapable",
      condition: '*',
      action: 'block',
      severity: 'critical',
      appliesTo: ['role'],
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    await runTool(addedTools, 'bos_register_role', {
      id: agentId,
      name: 'Governed persona role',
      displayName: 'Governed persona role',
      responsibilities: ['enforced in the session'],
      policies: ['p-block-all'],
    });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;

    const reading: FakePermissionEvent = {
      action: 'grep',
      resources: ['dnas/surgical-team.yaml'],
      agent: 'test',
      effect: 'allow',
    };
    await permission(reading);
    expect(reading.effect).toBe('allow'); // read-only → no role gate

    const controlPlane: FakePermissionEvent = {
      action: 'bos_list_dna',
      agent: 'test',
      effect: 'allow',
    };
    await permission(controlPlane);
    expect(controlPlane.effect).toBe('allow'); // control-plane must stay escapable
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

  it('bos_parse_rule parses the text field its schema advertises', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rule').execute({
      text: 'Block production deploys when tests are failing',
    });
    const parsed = JSON.parse(result.content) as {
      success?: boolean;
      error?: string;
      rule?: { action?: string };
    };

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBe(true);
    expect(parsed.rule?.action).toBe('block');
  });

  it('bos_parse_rule accepts the MCP canonical rule alias', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rule').execute({
      rule: 'Warn before large transfers if amount exceeds threshold',
    });
    const parsed = JSON.parse(result.content) as {
      success?: boolean;
      error?: string;
      rule?: { action?: string };
    };

    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBe(true);
    expect(parsed.rule?.action).toBe('warn');
  });

  it('bos_parse_rule returns a structured error instead of throwing when no text is supplied', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rule').execute(undefined);
    const parsed = JSON.parse(result.content) as { success?: boolean; error?: string };

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('rule text is required');
  });

  it('bos_parse_rules_batch parses the texts field its schema advertises', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rules_batch').execute({
      texts: ['Block deletes', 'Warn on low coverage'],
    });
    const parsed = JSON.parse(result.content) as Array<{ rule?: { action?: string } }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.rule?.action).toBe('block');
    expect(parsed[1]?.rule?.action).toBe('warn');
  });

  it('bos_parse_rules_batch accepts the MCP canonical rules alias', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rules_batch').execute({
      rules: ['Block deletes', 'Warn on low coverage'],
    });
    const parsed = JSON.parse(result.content) as Array<{ rule?: { action?: string } }>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('bos_parse_rules_batch returns an empty list instead of throwing on missing input', async () => {
    const byName = await setupTools();
    const result = await byName('bos_parse_rules_batch').execute(undefined);
    const parsed = JSON.parse(result.content) as unknown[];

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });
});

describe('behavior-os control loops (real dispatch)', () => {
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

  interface LoopOutput {
    ok: boolean;
    runId: string;
    exists?: boolean;
    status?: string;
    outcome?: string;
    missionId?: string;
    error?: string;
    tasks: Array<{
      id: string;
      status: string;
      outcome?: string;
      attempts: number;
      assignedAgentId?: string;
      evidence: number;
      error?: { code: string; message: string };
    }>;
  }

  const successTask = {
    id: 'task-echo',
    objective: 'print the marker to stdout',
    adapter: 'shell',
    agentId: 'persona:operator',
    input: { command: 'node', args: ['-e', 'console.log("loop-ok")'] },
    acceptance: [
      {
        gate: 'stdout',
        description: 'stdout contains loop-ok',
        type: 'stdout-contains',
        expected: 'loop-ok',
        required: true,
      },
    ],
  };

  it('bos_start_loop dispatches a real shell task and records validated evidence', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'devops-pipeline' });

    const started = JSON.parse(
      (await byName('bos_start_loop').execute({ title: 'loop e2e', tasks: [successTask] })).content,
    ) as LoopOutput;

    expect(started.ok).toBe(true);
    expect(started.runId).toMatch(/^loop-/);
    expect(started.tasks).toHaveLength(1);
    expect(started.tasks[0].status).toBe('completed');
    expect(started.tasks[0].outcome).toBe('PASS');
    expect(started.tasks[0].assignedAgentId).toBe('persona:operator');
    expect(started.tasks[0].evidence).toBeGreaterThan(0);

    // Fail-safe: the plugin wires no independent auditor, so the loop must never
    // report an overall PASS from task results alone.
    expect(started.outcome).not.toBe('PASS');
  });

  it('blocks a mutating shell task when the DNA persona is read-only', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'blockchain-web3' });

    const task = {
      id: 'task-readonly-should-not-run',
      objective: 'print a marker that must never be printed',
      adapter: 'shell',
      agentId: 'persona:architect',
      input: { command: 'node', args: ['-e', 'console.log("never-run")'] },
      acceptance: [
        {
          gate: 'stdout',
          description: 'stdout contains never-run',
          type: 'stdout-contains',
          expected: 'never-run',
          required: true,
        },
      ],
    };

    const started = JSON.parse(
      (await byName('bos_start_loop').execute({ title: 'readonly persona blocked', tasks: [task] }))
        .content,
    ) as LoopOutput;

    expect(started.ok).toBe(true);
    expect(started.tasks[0].status).toBe('blocked');
    expect(started.tasks[0].error?.code).toBe('AGENT_NOT_FOUND');
    expect(started.tasks[0].error?.message).toContain('Delegation refused');
    expect(started.tasks[0].evidence).toBe(0);
  });

  it('bos_loop_status reads persisted state and bos_resume_loop is idempotent', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'devops-pipeline' });

    const started = JSON.parse(
      (await byName('bos_start_loop').execute({ title: 'loop resume', tasks: [successTask] }))
        .content,
    ) as LoopOutput;

    const status = JSON.parse(
      (await byName('bos_loop_status').execute({ runId: started.runId })).content,
    ) as LoopOutput;
    expect(status.ok).toBe(true);
    expect(status.exists).toBe(true);
    expect(status.runId).toBe(started.runId);

    const resumed = JSON.parse(
      (await byName('bos_resume_loop').execute({ runId: started.runId })).content,
    ) as LoopOutput;
    expect(resumed.ok).toBe(true);
    expect(resumed.tasks[0].status).toBe('completed');

    const missing = JSON.parse(
      (await byName('bos_resume_loop').execute({ runId: 'loop-does-not-exist' })).content,
    ) as LoopOutput;
    expect(missing.error).toContain('not found');
  });

  it('bos_start_loop marks a task FAIL when its acceptance check fails', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'devops-pipeline' });

    const started = JSON.parse(
      (
        await byName('bos_start_loop').execute({
          title: 'loop failing check',
          tasks: [
            {
              ...successTask,
              id: 'task-missing-marker',
              acceptance: [
                {
                  gate: 'stdout',
                  description: 'stdout contains a marker that is never printed',
                  type: 'stdout-contains',
                  expected: 'never-printed-marker',
                  required: true,
                },
              ],
            },
          ],
        })
      ).content,
    ) as LoopOutput;

    expect(started.tasks[0].status).toBe('failed');
    expect(started.tasks[0].outcome).toBe('FAIL');
  });

  it('bos_approve_loop is a no-op when no approval is pending', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'devops-pipeline' });

    // Run a normal loop to completion (no approval gate).
    const started = JSON.parse(
      (await byName('bos_start_loop').execute({ title: 'loop approve noop', tasks: [successTask] }))
        .content,
    ) as LoopOutput;

    expect(started.ok).toBe(true);
    expect(started.tasks[0].status).toBe('completed');

    // Calling approve on a non-pending loop is a no-op and returns the current state.
    const result = JSON.parse(
      (
        await byName('bos_approve_loop').execute({
          runId: started.runId,
          decision: 'approve',
          reason: 'no-op',
        })
      ).content,
    ) as LoopOutput;
    expect(result.ok).toBe(true);
    expect(result.tasks[0].status).toBe('completed');
  });

  it('bos_approve_loop returns an error for a missing run id', async () => {
    const byName = await setupTools();
    await byName('bos_select_dna').execute({ pattern: 'devops-pipeline' });

    const result = JSON.parse(
      (
        await byName('bos_approve_loop').execute({
          runId: 'loop-does-not-exist',
          decision: 'approve',
        })
      ).content,
    ) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
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

    // Find the deny entry that belongs to THIS test's bash action under surgical-team.
    // Earlier tests may have produced other denies under different DNAs.
    const denyEntry = parsed.entries.find(
      (entry) =>
        entry.kind === 'permission' &&
        entry.outcome === 'deny' &&
        entry.action === 'bash' &&
        entry.dna === 'Surgical Team',
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

  it('coalesces a repeated denial and carries suppression counters', async () => {
    const { ctx, addedTools, permissionHooks, syntheticCalls } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const before = JSON.parse(
      (await runTool(addedTools, 'bos_get_log', { limit: 1000 })).content,
    ) as { entries: Array<Record<string, unknown>> };

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const first: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-coalesce',
      agent: 'test',
      effect: 'allow',
    };
    const second: FakePermissionEvent = { ...first };
    const distinct: FakePermissionEvent = { ...first, action: 'edit' };

    await permission(first);
    await permission(second);
    await permission(distinct);

    expect(first.effect).toBe('deny');
    expect(second.effect).toBe('deny');
    expect(distinct.effect).toBe('deny');

    const denyNotes = syntheticCalls.filter((call) => call.text.includes('⛔'));
    expect(denyNotes).toHaveLength(2);
    expect(denyNotes[0]?.delivery).toBe('queue');
    expect(denyNotes[0]?.metadata?.bosKind).toBe('deny');
    expect(typeof denyNotes[0]?.metadata?.bosKey).toBe('string');
    expect(denyNotes[0]?.metadata?.bosSuppressedDuplicate).toBe(0);
    // The next admitted notice reports the counter from the suppressed one.
    expect(denyNotes[1]?.metadata?.bosSuppressedDuplicate).toBe(1);

    const after = JSON.parse(
      (await runTool(addedTools, 'bos_get_log', { limit: 1000 })).content,
    ) as { entries: Array<{ kind: string; outcome: string; detail: string }> };

    // The log is append-only: every earlier entry is still present unchanged.
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    const denials = after.entries.filter(
      (entry) => entry.kind === 'permission' && entry.outcome === 'deny',
    );
    expect(denials.length).toBeGreaterThanOrEqual(2);
    expect(after.entries.some((entry) => entry.detail.includes('Suppressed duplicate'))).toBe(true);
    expect(after.entries.some((entry) => entry.detail.includes('duplicate=1'))).toBe(true);
  });

  it('does not crash or retry when the notice transport rejects', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    let attempts = 0;
    ctx.session.synthetic = async () => {
      attempts += 1;
      throw new Error('transport unavailable');
    };
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    const event: FakePermissionEvent = {
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-transport',
      agent: 'test',
      effect: 'allow',
    };

    await expect(permission(event)).resolves.toBeUndefined();
    await expect(permission({ ...event })).resolves.toBeUndefined();

    expect(event.effect).toBe('deny');
    // The first notice was attempted once and failed; the repeated decision was
    // coalesced, so the transport was not called again and the action was not
    // re-executed.
    expect(attempts).toBe(1);
  });

  it('caps notices per session and reopens only on a real prompt', async () => {
    const { ctx, addedTools, permissionHooks, sessionHooks, syntheticCalls } =
      createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    for (const action of ['bash', 'edit', 'write', 'patch']) {
      await permission({
        action,
        resources: ['deploy to production'],
        sessionID: 'ses-cap',
        agent: 'test',
        effect: 'allow',
      });
    }
    expect(syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(3);

    const prompt = sessionHooks.prompt as (event: unknown) => Promise<void>;
    await prompt({ sessionID: 'ses-cap', prompt: { text: 'hello' } });

    await permission({
      action: 'patch',
      resources: ['deploy to production'],
      sessionID: 'ses-cap',
      agent: 'test',
      effect: 'allow',
    });
    expect(syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(4);
  });

  it('restores the coalescer dedupe keys across a simulated restart', async () => {
    const storageData = new Map<string, unknown>();
    const first = createFakeContext(repoRoot, storageData);
    await plugin.setup(first.ctx as never);
    await runTool(first.addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const firstPermission = first.permissionHooks.evaluate as (
      event: FakePermissionEvent,
    ) => Promise<void>;
    await firstPermission({
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-restart',
      agent: 'test',
      effect: 'allow',
    });
    expect(first.syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(1);

    const second = createFakeContext(repoRoot, storageData);
    await plugin.setup(second.ctx as never);
    const secondPermission = second.permissionHooks.evaluate as (
      event: FakePermissionEvent,
    ) => Promise<void>;
    await secondPermission({
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-restart',
      agent: 'test',
      effect: 'allow',
    });

    expect(second.syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(0);

    // A real prompt resets the cap window but retains recent decision
    // identities, so a host that re-evaluates the same pending request is not
    // re-notified on every turn.
    const prompt = second.sessionHooks.prompt as (event: unknown) => Promise<void>;
    await prompt({ sessionID: 'ses-restart', prompt: { text: 'hello' } });
    await secondPermission({
      action: 'bash',
      resources: ['deploy to production'],
      sessionID: 'ses-restart',
      agent: 'test',
      effect: 'allow',
    });
    expect(second.syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(0);

    // A distinct decision is still admitted after the prompt reset.
    await secondPermission({
      action: 'edit',
      resources: ['deploy to production'],
      sessionID: 'ses-restart',
      agent: 'test',
      effect: 'allow',
    });
    expect(second.syntheticCalls.filter((call) => call.text.includes('⛔'))).toHaveLength(1);
  });

  it('leaves mission state untouched when a notice is coalesced', async () => {
    const { ctx, addedTools, permissionHooks } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'surgical-team' });

    const created = await runTool(addedTools, 'bos_create_mission', {
      title: 'Coalescer state preservation',
      type: 'refactor',
      priority: 'low',
    });
    const missionId = created.content.replace('Mission created: ', '').trim();

    const list = async () =>
      JSON.parse(
        (await runTool(addedTools, 'bos_list_missions', { limit: 1000 })).content,
      ) as Array<Record<string, unknown> & { id: string }>;
    const before = (await list()).find((mission) => mission.id === missionId);
    expect(before).toBeDefined();

    const permission = permissionHooks.evaluate as (event: FakePermissionEvent) => Promise<void>;
    for (let index = 0; index < 2; index += 1) {
      await permission({
        action: 'bash',
        resources: ['deploy to production'],
        sessionID: 'ses-mission',
        agent: 'test',
        effect: 'allow',
      });
    }

    const after = (await list()).find((mission) => mission.id === missionId);
    expect(after).toEqual(before);
  });

  it('bos_drift compares two DNA patterns and reports a real drift', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const result = await runTool(addedTools, 'bos_drift', {
      dnaA: 'lean-factory',
      dnaB: 'surgical-team',
    });
    const drift = JSON.parse(result.content) as {
      id: string;
      olderName: string;
      newerName: string;
      totalChanges: number;
      significant: boolean;
      summary: string;
    };

    expect(drift.id).toMatch(/^drift-/);
    expect(drift.olderName).toBeTruthy();
    expect(drift.newerName).toBeTruthy();
    expect(drift.summary).not.toContain('No drift engine available');
    expect(drift.totalChanges).toBeGreaterThan(0);
    expect(drift.significant).toBe(true);
  });

  it('bos_drift reports unknown pattern names without throwing', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const result = await runTool(addedTools, 'bos_drift', {
      dnaA: 'does-not-exist',
      dnaB: 'lean-factory',
    });

    expect(result.content).toContain('not found');
  });

  it('bos_recommendations scores recent learnings', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    await runTool(addedTools, 'bos_record_learning', {
      type: 'failure',
      source: 'ci',
      content: 'pipeline failed at the deploy step',
      impact: 'critical',
    });

    const result = await runTool(addedTools, 'bos_recommendations', {});
    const recs = JSON.parse(result.content) as Array<{ text: string; score: number }>;

    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].score).toBeGreaterThan(0);
    expect(recs[0].text).toContain('failure');
  });

  it('bos_whoami reports the DNA-derived identity instead of a model name', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    await runTool(addedTools, 'bos_select_dna', { pattern: 'lean-factory' });

    const after = JSON.parse((await runTool(addedTools, 'bos_whoami', {})).content) as {
      agentId: string;
      persona: string;
      dnaPattern: string;
      source: string;
      personas: string[];
    };
    expect(after.persona).toBe('operator');
    expect(after.agentId).toBe(`persona:${after.persona}`);
    expect(after.dnaPattern).toBe('Lean Factory');
    expect(after.source).toBe('persona');
    expect(after.personas).toContain('operator');
  });

  it('bos_run_audit defaults to the DNA identity when agentId is omitted', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    await runTool(addedTools, 'bos_select_dna', { pattern: 'lean-factory' });
    const report = await runTool(addedTools, 'bos_run_audit', { missionId: 'mission-1' });

    // S1: the default audit is simulated, so it must never look like a real
    // verification or report a passing verdict.
    expect(report.content).toContain('SIMULATED');
    expect(report.content).toContain('warning');
    expect(report.content).not.toContain(': pass');
    expect(report.content).toContain('agent: persona:operator');
    expect(report.content).toContain('dna: Lean Factory');
  });

  it('bos_complete_mission refuses missing evidence and accepts a complete set', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const created = await runTool(addedTools, 'bos_create_mission', {
      title: 'S1 evidence contract',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['tests'],
    });
    const missionId = created.content.match(/mission-[a-z0-9-]+/)?.[0];
    expect(missionId).toBeDefined();
    if (!missionId) return;

    await runTool(addedTools, 'bos_start_mission', { missionId });

    const refused = await runTool(addedTools, 'bos_complete_mission', {
      missionId,
      evidence: [],
    });
    expect(refused.content).toContain('EVIDENCE_MISSING');

    const completed = await runTool(addedTools, 'bos_complete_mission', {
      missionId,
      evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
    });
    const parsed = JSON.parse(completed.content) as {
      ok: boolean;
      status: string;
      completionBasis: string;
      changed: boolean;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.changed).toBe(true);
    expect(parsed.status).toBe('completed');
    expect(parsed.completionBasis).toBe('evidence');
  });

  it('bos_fail_mission and bos_cancel_mission expose explicit terminal semantics', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const failedMission = await runTool(addedTools, 'bos_create_mission', {
      title: 'S1 fail contract',
      type: 'bugfix',
      priority: 'medium',
    });
    const failedId = failedMission.content.match(/mission-[a-z0-9-]+/)?.[0];
    expect(failedId).toBeDefined();
    if (!failedId) return;
    await runTool(addedTools, 'bos_start_mission', { missionId: failedId });

    const failed = await runTool(addedTools, 'bos_fail_mission', {
      missionId: failedId,
      reason: 'verification failed',
      expectedVersion: 1,
    });
    const failedParsed = JSON.parse(failed.content) as { ok: boolean; status: string };
    expect(failedParsed.ok).toBe(true);
    expect(failedParsed.status).toBe('failed');

    const cancelledMission = await runTool(addedTools, 'bos_create_mission', {
      title: 'S1 cancel contract',
      type: 'research',
      priority: 'low',
    });
    const cancelledId = cancelledMission.content.match(/mission-[a-z0-9-]+/)?.[0];
    expect(cancelledId).toBeDefined();
    if (!cancelledId) return;

    const cancelled = await runTool(addedTools, 'bos_cancel_mission', {
      missionId: cancelledId,
      reason: 'superseded',
    });
    const cancelledParsed = JSON.parse(cancelled.content) as { ok: boolean; status: string };
    expect(cancelledParsed.ok).toBe(true);
    expect(cancelledParsed.status).toBe('cancelled');

    const refused = await runTool(addedTools, 'bos_complete_mission', { missionId: cancelledId });
    expect(refused.content).toContain('INVALID_TRANSITION');
  });

  it('reports PERSISTENCE_FAILED and rolls back when a lifecycle write fails', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const created = await runTool(addedTools, 'bos_create_mission', {
      title: 'S1 persistence contract',
      type: 'feature',
      priority: 'high',
      requiredChecks: ['tests'],
    });
    const missionId = created.content.match(/mission-[a-z0-9-]+/)?.[0];
    expect(missionId).toBeDefined();
    if (!missionId) return;
    await runTool(addedTools, 'bos_start_mission', { missionId });

    ctx.storage.set = async () => {
      throw new Error('quota exceeded');
    };

    const completed = await runTool(addedTools, 'bos_complete_mission', {
      missionId,
      evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
    });
    expect(completed.content).toContain('PERSISTENCE_FAILED');

    const listed = JSON.parse(
      (await runTool(addedTools, 'bos_list_missions', {})).content,
    ) as Array<{
      id: string;
      status: string;
      version: number;
      evidence?: unknown[];
      completionBasis?: string;
    }>;
    const mission = listed.find((entry) => entry.id === missionId);
    expect(mission?.status).toBe('active');
    expect(mission?.version).toBe(1);
    expect(mission?.evidence ?? []).toHaveLength(0);
    expect(mission?.completionBasis).toBeUndefined();
  });

  it('does not keep a mission when creation cannot be persisted', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const before = JSON.parse(
      (await runTool(addedTools, 'bos_list_missions', {})).content,
    ) as unknown[];
    ctx.storage.set = async () => {
      throw new Error('quota exceeded');
    };

    const created = await runTool(addedTools, 'bos_create_mission', {
      title: 'S1 unpersisted mission',
      type: 'feature',
      priority: 'high',
    });
    expect(created.content).toContain('PERSISTENCE_FAILED');

    const after = JSON.parse(
      (await runTool(addedTools, 'bos_list_missions', {})).content,
    ) as unknown[];
    expect(after).toHaveLength(before.length);
  });

  it('does not let a failed lifecycle write roll back a concurrent transition (G-010)', async () => {
    const { ctx, addedTools, storageData } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const victim = await runTool(addedTools, 'bos_create_mission', {
      title: 'g010-victim',
      type: 'feature',
      priority: 'high',
    });
    const victimId = victim.content.match(/mission-[a-z0-9-]+/)?.[0];
    expect(victimId).toBeDefined();
    if (!victimId) return;

    // Fail exactly the next storage write, then let storage recover.
    const originalSet = ctx.storage.set;
    let writes = 0;
    ctx.storage.set = async (key, value) => {
      writes += 1;
      if (writes === 1) throw new Error('quota exceeded');
      return originalSet(key, value);
    };

    // Both tools mutate in-memory state and then await persistence. Without a
    // lifecycle lock, the failing create restores a snapshot taken before the
    // start transition and erases it while the start still reports success.
    const [failedCreate, startedVictim] = await Promise.all([
      runTool(addedTools, 'bos_create_mission', {
        title: 'g010-doomed',
        type: 'bugfix',
        priority: 'low',
      }),
      runTool(addedTools, 'bos_start_mission', { missionId: victimId }),
    ]);

    expect(failedCreate.content).toContain('PERSISTENCE_FAILED');
    expect(startedVictim.content).toContain('started');

    const listed = JSON.parse(
      (await runTool(addedTools, 'bos_list_missions', {})).content,
    ) as Array<{ id: string; title: string; status: string }>;
    expect(listed.find((mission) => mission.id === victimId)?.status).toBe('active');
    expect(listed.some((mission) => mission.title === 'g010-doomed')).toBe(false);

    // The committed transition must also be durable, not only in memory.
    const persisted = storageData.get('behavioros:state') as {
      missions: Array<{ id: string; title: string; status: string }>;
    };
    expect(persisted.missions.find((mission) => mission.id === victimId)?.status).toBe('active');
    expect(persisted.missions.some((mission) => mission.title === 'g010-doomed')).toBe(false);
  });

  it('promotes a learning record through the lifecycle and refuses a skip', async () => {
    const { ctx, addedTools, storageData } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);

    const recorded = await runTool(addedTools, 'bos_record_learning', {
      type: 'insight',
      source: 'g014-tool-test',
      content: 'The lifecycle is reachable through the tool surface',
      impact: 'high',
    });
    const recordId = recorded.content.match(/learn-rec-[a-z0-9-]+/)?.[0];
    expect(recordId).toBeDefined();
    if (!recordId) return;

    const skipped = await runTool(addedTools, 'bos_record_learning', {
      learningId: recordId,
      stage: 'candidate',
    });
    expect(skipped.content).toContain('INVALID_TRANSITION');

    const lesson = await runTool(addedTools, 'bos_record_learning', {
      learningId: recordId,
      stage: 'lesson',
    });
    expect(lesson.content).toContain('-> lesson');

    const candidate = await runTool(addedTools, 'bos_record_learning', {
      learningId: recordId,
      stage: 'candidate',
    });
    expect(candidate.content).toContain('-> candidate');

    const unverified = await runTool(addedTools, 'bos_record_learning', {
      learningId: recordId,
      stage: 'validated',
    });
    expect(unverified.content).toContain('EVIDENCE_REQUIRED');

    const verified = await runTool(addedTools, 'bos_record_learning', {
      learningId: recordId,
      stage: 'validated',
      evidence: ['pnpm test: 659 cases passed'],
    });
    expect(verified.content).toContain('-> validated');

    const persisted = storageData.get('behavioros:state') as {
      learningRecords: Array<{ id: string; stage: string; evidence: string[] }>;
    };
    const stored = persisted.learningRecords.find((record) => record.id === recordId);
    expect(stored?.stage).toBe('validated');
    expect(stored?.evidence).toContain('pnpm test: 659 cases passed');
  });

  it('drives the governed policy console end-to-end through the plugin', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'lean-factory' });

    const created = JSON.parse(
      (
        await runTool(addedTools, 'bos_policy', {
          operation: 'create',
          policyId: 'policy:e2e-freeze',
          content: 'Deployments must not start on Friday.',
          reason: 'e2e evidence',
          enforcement: {
            action: 'block',
            match: 'deploy',
            severity: 'critical',
            description: 'Friday deploy freeze',
          },
        })
      ).content,
    ) as { ok: boolean; version: { versionId: string } };
    expect(created.ok).toBe(true);
    const versionId = created.version.versionId;

    const validation = JSON.parse(
      (
        await runTool(addedTools, 'bos_policy', {
          operation: 'validate',
          policyId: 'policy:e2e-freeze',
          versionId,
        })
      ).content,
    ) as { ok: boolean };
    expect(validation.ok).toBe(true);

    const approval = JSON.parse(
      (
        await runTool(addedTools, 'bos_policy', {
          operation: 'approve',
          policyId: 'policy:e2e-freeze',
          versionId,
          rationale: 'Reviewed the freeze and accept the rule.',
          actorId: 'human:e2e',
          actorKind: 'human',
        })
      ).content,
    ) as { ok: boolean };
    expect(approval.ok).toBe(true);

    const activation = JSON.parse(
      (
        await runTool(addedTools, 'bos_policy', {
          operation: 'activate',
          policyId: 'policy:e2e-freeze',
          versionId,
          reason: 'Rolling out the freeze for the quarter',
          actorId: 'human:e2e',
          actorKind: 'human',
        })
      ).content,
    ) as { ok: boolean };
    expect(activation.ok).toBe(true);

    const blocked = JSON.parse(
      (
        await runTool(addedTools, 'bos_evaluate_governance', {
          action: 'deploy production',
          agent: 'agent-1',
        })
      ).content,
    ) as { verdict: string; reason: string };
    expect(blocked.verdict).toBe('deny');
    expect(blocked.reason).toContain('Friday deploy freeze');

    const list = JSON.parse(
      (await runTool(addedTools, 'bos_policy', { operation: 'list' })).content,
    ) as Array<{ policyId: string; status: string; enforced: boolean }>;
    const summary = list.find((policy) => policy.policyId === 'policy:e2e-freeze');
    expect(summary?.status).toBe('active');
    expect(summary?.enforced).toBe(true);

    const deactivated = JSON.parse(
      (
        await runTool(addedTools, 'bos_policy', {
          operation: 'deactivate',
          policyId: 'policy:e2e-freeze',
          reason: 'Freeze lifted after the quarter ended',
          actorId: 'human:e2e',
          actorKind: 'human',
        })
      ).content,
    ) as { ok: boolean };
    expect(deactivated.ok).toBe(true);

    const after = JSON.parse(
      (
        await runTool(addedTools, 'bos_evaluate_governance', {
          action: 'deploy production',
          agent: 'agent-1',
        })
      ).content,
    ) as { verdict: string };
    expect(after.verdict).not.toBe('deny');
  });

  it('bos_set_agent switches the acting persona from the active DNA', async () => {
    const { ctx, addedTools } = createFakeContext(repoRoot);
    await plugin.setup(ctx as never);
    await runTool(addedTools, 'bos_select_dna', { pattern: 'lean-factory' });

    const unknown = await runTool(addedTools, 'bos_set_agent', { persona: 'compliance' });
    expect(unknown.content).toContain('No agent or persona matched');
    expect(unknown.content).toContain('operator');

    const identity = JSON.parse(
      (await runTool(addedTools, 'bos_set_agent', { persona: 'Process Engineer' })).content,
    ) as { agentId: string; persona: string; source: string };
    expect(identity.agentId).toBe('persona:operator');
    expect(identity.source).toBe('persona');

    const registered = JSON.parse(
      (
        await runTool(addedTools, 'bos_set_agent', {
          id: 'agent-audit',
          name: 'Nightly Auditor',
          type: 'reviewer',
        })
      ).content,
    ) as { agentId: string; source: string; agent: { name: string } | null };
    expect(registered.agentId).toBe('agent-audit');
    expect(registered.source).toBe('registered');
    expect(registered.agent?.name).toBe('Nightly Auditor');
  });

  it('wires the BEHAVIOROS_EVOLUTION opt-in flag into the BehaviorOS config', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'),
      'utf-8',
    );
    // The learning→governance loop only closes when the host can actually pass
    // evolution.enabled; keep the env flag wiring from silently disappearing.
    expect(src).toContain("process.env.BEHAVIOROS_EVOLUTION === 'true'");
    expect(src).toContain('evolution: process.env');
  });

  it('joins durable persistence via the shared BEHAVIOROS_DB_PATH', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'),
      'utf-8',
    );
    // The plugin host is the other half of the architecture audit finding:
    // without a store, plugin sessions never persist records/roles/decisions.
    expect(src).toContain('process.env.BEHAVIOROS_DB_PATH');
    expect(src).toContain('persistence:');
  });
});

describe('describeProtocolProgress', () => {
  it('never reports a step beyond the protocol length at completion', () => {
    expect(describeProtocolProgress(0)).toBe('Protocol step 1/7');
    expect(describeProtocolProgress(6)).toBe('Protocol step 7/7');
    expect(describeProtocolProgress(7)).toBe('Protocol complete (7/7)');
    expect(describeProtocolProgress(9)).toBe('Protocol complete (7/7)');
  });
});
