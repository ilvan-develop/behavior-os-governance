/**
 * Chief orchestrator: the deterministic planning brain that sits above task
 * dispatch.
 *
 * `AutonomousOrchestrator` executes a plan it is given; `ChiefOrchestrator`
 * decides *what the plan should be*. It reads the goal, the active DNA and the
 * available roster, then produces:
 *
 *  - an assessment (complexity, risk, which capabilities are genuinely needed);
 *  - an architecture decision with alternatives and rationale (data, not
 *    authority — the DNA still governs execution);
 *  - a phased task plan with owners and gates;
 *  - the debate/conversation the team should have before building.
 *
 * The output is deliberately plain data. The plugin injects it into the model
 * context so any LLM follows the same governed shape, and a future control loop
 * can translate it into `MissionPlan` tasks without re-deriving the reasoning.
 *
 * This module is pure and deterministic: no I/O, no provider calls, no clock
 * drift. `now` is injectable for tests.
 */

import type { DNA, Persona } from '@behavior-os/schemas';

export type ChiefCapability =
  | 'architecture-decision'
  | 'brainstorm'
  | 'pragmatic-conversation'
  | 'consensus'
  | 'research'
  | 'stack-setup'
  | 'data-assessment'
  | 'fairness'
  | 'security-review'
  | 'delegation'
  | 'verification'
  | 'audit'
  | 'learning';

export type ChiefRisk = 'low' | 'medium' | 'high' | 'critical';

export interface ChiefRosterEntry {
  id: string;
  role?: string;
  capabilities?: string[];
  /** Readonly agents never receive a mutating task. */
  authority?: 'readonly' | 'write' | 'admin';
}

export interface ChiefProjectContext {
  type?: string;
  techStack?: string[];
  deployment?: string;
}

export interface ChiefRequest {
  goal: string;
  dna?: DNA | null;
  roster?: ChiefRosterEntry[];
  project?: ChiefProjectContext;
  /** `conservative` escalates more, `autonomous` decides more on its own. */
  riskAppetite?: 'conservative' | 'balanced' | 'autonomous';
}

export interface ChiefAssessment {
  /** 0..1 — how much planning the goal deserves. */
  complexity: number;
  risk: ChiefRisk;
  /** True when the team should debate alternatives before committing. */
  needsDebate: boolean;
  /** True when a structured multi-agent conversation is warranted. */
  needsConversation: boolean;
  needsResearch: boolean;
  needsStackSetup: boolean;
  needsDataAssessment: boolean;
  needsFairness: boolean;
  needsSecurityReview: boolean;
  /** Ordered, deduplicated capabilities this goal genuinely needs. */
  capabilities: ChiefCapability[];
  /** Human-readable reasons behind the flags. */
  rationale: string[];
}

export interface ChiefDecision {
  subject: string;
  chosen: string;
  alternatives: string[];
  rationale: string;
  confidence: number;
}

export interface ChiefTask {
  id: string;
  objective: string;
  owner: string;
  phase: string;
  dependsOn: string[];
  tools: string[];
  gate: string;
  /** False only for pure analysis tasks. Defaults to true (fail closed). */
  mutating: boolean;
}

export interface ChiefPhase {
  id: string;
  name: string;
  owner: string;
  gates: string[];
  tools: string[];
}

export interface ChiefDebate {
  topic: string;
  participants: string[];
  tools: string[];
}

export interface ChiefPlan {
  goal: string;
  assessment: ChiefAssessment;
  decision: ChiefDecision;
  phases: ChiefPhase[];
  tasks: ChiefTask[];
  delegation: Array<{
    taskId: string;
    agentId: string;
    role: string;
    reason: string;
  }>;
  debate: ChiefDebate | null;
  conversation: ChiefDebate | null;
  gates: string[];
  /** Compact block to inject into the model context. */
  context: string;
  generatedAt: string;
}

export interface ChiefOrchestratorOptions {
  now?: () => string;
}

const COMPLEXITY_SIGNALS = [
  'architecture',
  'design',
  'strategy',
  'tradeoff',
  'trade-off',
  'compare',
  'alternative',
  'refactor',
  'migrate',
  'migration',
  'platform',
  'system',
  'service',
  'pipeline',
  'orchestrat',
  'multi',
  'distributed',
  'scalab',
  'security',
  'compliance',
];

const DEBATE_SIGNALS = [
  'architecture',
  'design',
  'approach',
  'strategy',
  'tradeoff',
  'trade-off',
  'choose',
  'decide',
  'decision',
  'compare',
  'alternative',
  'refactor',
  'migrate',
  'migration',
  'should we',
];

const CONVERSATION_SIGNALS = [
  'team',
  'agents',
  'collaborat',
  'debate',
  'discuss',
  'conflict',
  'brainstorm',
  'consensus',
  'disagree',
];

/**
 * Read-only / analysis intents. A review, audit or verification request is work
 * the agent performs alone; by itself it must not open a build collaboration.
 * Explicit collaboration words below can still override this gate.
 */
const READ_ONLY_SIGNALS = [
  'review',
  'audit',
  'verify',
  'validate',
  'diagnose',
  'inspect',
  'explain',
  'summar',
  'report',
  'analys',
  'analyze',
  'investigat',
  'prove',
  'proof',
  'status',
  'read-only',
  'read only',
];

const EXPLICIT_COLLAB_SIGNALS = [
  'brainstorm',
  'debate',
  'discuss',
  'consensus',
  'disagree',
  'multiple perspectives',
  'trade-off',
  'tradeoff',
  'architecture',
  'design',
  'approach',
  'compare',
  'strategy',
  'choose',
  'refactor',
  'migrate',
];

const RESEARCH_SIGNALS = [
  'docs',
  'documentation',
  'official',
  'library',
  'framework',
  'sdk',
  'api',
  'version',
  'upgrade',
  'migrate',
  'install',
  'setup',
  'scaffold',
  'best practice',
  'example',
];

const STACK_SIGNALS = [
  'install',
  'scaffold',
  'bootstrap',
  'init',
  'create app',
  'create a app',
  'create a new app',
  'new project',
  'new service',
  'setup',
  'set up',
  'stack',
  'dependency',
  'dependencies',
  'monorepo',
  'shadcn',
  'next.js',
  'nextjs',
  'vite',
  'react',
  'vue',
  'svelte',
  'nestjs',
  'fastapi',
  'django',
  'rails',
];

const DATA_SIGNALS = [
  'data',
  'dataset',
  'schema',
  'etl',
  'warehouse',
  'quality',
  'lineage',
  'migration',
  'ingest',
  'analytics',
];

const FAIRNESS_SIGNALS = [
  'fairness',
  'bias',
  'biased',
  'model',
  'training',
  'predict',
  'classification',
  'classifier',
  'recommendation',
  'ranking',
  'credit',
  'hiring',
  'health',
  'protected group',
];

const SECURITY_SIGNALS = [
  'secret',
  'credential',
  'auth',
  'permission',
  'rbac',
  'encrypt',
  'vulnerab',
  'injection',
  'xss',
  'csrf',
  'security',
  'pii',
  'phi',
];

const HIGH_RISK_SIGNALS = [
  'production',
  'prod',
  'deploy',
  'release',
  'rollback',
  'delete',
  'drop',
  'destroy',
  'migrate',
  'migration',
  'payment',
  'transaction',
  'patient',
  'phi',
  'pii',
  'secret',
  'credential',
  'breaking',
  'outage',
  'incident',
];

const MEDIUM_RISK_SIGNALS = [
  'install',
  'dependency',
  'schema',
  'database',
  'auth',
  'api',
  'infra',
  'pipeline',
  'refactor',
];

function hasSignal(haystack: string, signals: readonly string[]): boolean {
  return signals.some((signal) => haystack.includes(signal));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function personaRoster(dna: DNA | null | undefined): ChiefRosterEntry[] {
  if (!dna) return [];
  return dna.personas.map((persona: Persona) => ({
    id: `persona:${persona.role}`,
    role: persona.role,
    capabilities: persona.skills,
    authority: authorityFor(persona.authority),
  }));
}

/** Map the DNA's free-form authority label to the orchestrator vocabulary. */
function authorityFor(authority: string): 'readonly' | 'write' | 'admin' {
  const value = authority.toLowerCase();
  if (value === 'admin') return 'admin';
  if (
    value === 'readonly' ||
    value === 'auditor' ||
    value.includes('compliance') ||
    value === 'sox-officer' ||
    value === 'healthcare'
  ) {
    return 'readonly';
  }
  return 'write';
}

const DEFAULT_ROSTER: ChiefRosterEntry[] = [
  {
    id: 'persona:architect',
    role: 'architect',
    capabilities: ['architecture', 'planning'],
    authority: 'write',
  },
  { id: 'persona:developer', role: 'developer', capabilities: ['implement'], authority: 'write' },
  { id: 'persona:reviewer', role: 'reviewer', capabilities: ['review'], authority: 'readonly' },
  { id: 'persona:auditor', role: 'auditor', capabilities: ['audit'], authority: 'readonly' },
];

function pickOwner(
  roster: ChiefRosterEntry[],
  wanted: readonly string[],
  fallback: string,
): string {
  const normalized = roster.map((entry) => ({
    entry,
    role: `${entry.role ?? ''} ${entry.id}`.toLowerCase(),
  }));

  for (const candidate of wanted) {
    const match = normalized.find(({ role }) => role.includes(candidate));
    if (match) return match.entry.id;
  }

  const writable = normalized.find(
    ({ entry }) => entry.authority !== 'readonly' && !/audit|review|explor/.test(entry.id),
  );
  return writable?.entry.id ?? roster[0]?.id ?? fallback;
}

function decideArchitecture(haystack: string, stackSetup: boolean): ChiefDecision {
  const alternatives = [
    'modular monolith with explicit boundaries',
    'modular service with explicit contracts',
    'event-driven pipeline with durable checkpoints',
    'thin CLI over a reusable library',
  ];

  if (stackSetup) {
    return {
      subject: 'implementation-approach',
      chosen: 'docs-first CLI scaffold + governed integration',
      alternatives,
      rationale:
        'The goal creates or installs a stack. Official docs and the framework CLI must produce the code; hand-written generated files are drift.',
      confidence: 0.86,
    };
  }

  if (/cli|command line|terminal|developer tool/.test(haystack)) {
    return {
      subject: 'architecture-approach',
      chosen: 'thin CLI over a reusable library',
      alternatives,
      rationale:
        'The goal is developer-tool shaped. A thin CLI keeps the domain reusable and testable without a service runtime.',
      confidence: 0.78,
    };
  }

  if (/api|service|server|backend|microservice|endpoint/.test(haystack)) {
    return {
      subject: 'architecture-approach',
      chosen: 'modular service with explicit contracts',
      alternatives,
      rationale:
        'The goal exposes behavior over a boundary. Contracts first keeps callers and tests stable while the inside evolves.',
      confidence: 0.8,
    };
  }

  if (/legacy|migrat|strangler|monolith/.test(haystack)) {
    return {
      subject: 'architecture-approach',
      chosen: 'strangler-fig modular monolith',
      alternatives,
      rationale:
        'The goal touches an existing system. Extract seams incrementally rather than rewriting behavior in one step.',
      confidence: 0.82,
    };
  }

  if (/pipeline|stream|etl|data|event/.test(haystack)) {
    return {
      subject: 'architecture-approach',
      chosen: 'event-driven pipeline with durable checkpoints',
      alternatives,
      rationale:
        'The goal moves data through stages. Durable checkpoints make failure and resume explicit instead of implicit.',
      confidence: 0.76,
    };
  }

  return {
    subject: 'architecture-approach',
    chosen: 'modular monolith with explicit boundaries',
    alternatives,
    rationale:
      'No stronger signal was found. A modular monolith keeps the first cut small while preserving seams for later extraction.',
    confidence: 0.62,
  };
}

function riskOf(haystack: string, assessment: { security: boolean; data: boolean }): ChiefRisk {
  if (hasSignal(haystack, HIGH_RISK_SIGNALS)) return 'high';
  if (assessment.security || hasSignal(haystack, MEDIUM_RISK_SIGNALS)) return 'medium';
  return 'low';
}

function uniqueCapabilities(capabilities: ChiefCapability[]): ChiefCapability[] {
  return [...new Set(capabilities)];
}

function phaseGates(phaseId: string): string[] {
  switch (phaseId) {
    case 'decide':
      return ['decision-recorded'];
    case 'research':
      return ['docs-consulted'];
    case 'build':
      return ['build-succeeds'];
    case 'verify':
      return ['tests-executed', 'lint-clean', 'typecheck-clean'];
    case 'audit':
      return ['audit-recorded'];
    case 'learn':
      return ['learning-recorded'];
    default:
      return ['assessment-recorded'];
  }
}

function phaseTools(phaseId: string, assessment: ChiefAssessment): string[] {
  switch (phaseId) {
    case 'assess':
      return ['bos_preflight', 'bos_evaluate_governance'];
    case 'decide':
      return ['bos_create_meta_decision', 'bos_resolve_consensus', 'bos_decide'];
    case 'research':
      return [
        'docs-research skill',
        'nuxt/next/framework CLI (if scaffolding)',
        'bos_record_learning',
      ];
    case 'build':
      return ['subagent:builder', 'bos_start_loop (real commands only)'];
    case 'verify':
      return ['pnpm typecheck', 'pnpm lint:check', 'pnpm test'];
    case 'audit':
      return ['bos_run_audit', 'bos_map_compliance'];
    case 'learn':
      return ['bos_record_learning', 'bos_get_insights'];
    default:
      return assessment.needsFairness ? ['bos_evaluate_fairness'] : [];
  }
}

function buildContext(plan: Omit<ChiefPlan, 'context'>): string {
  const { assessment, decision } = plan;
  const lines = [
    `[Behavior-OS:chief] Goal: ${plan.goal}`,
    `Complexity ${assessment.complexity.toFixed(2)} | risk ${assessment.risk} | capabilities: ${
      assessment.capabilities.join(', ') || 'direct execution'
    }`,
    `Decision (data, not authority): ${decision.chosen} — ${decision.rationale}`,
    `Alternatives considered: ${decision.alternatives.slice(0, 3).join('; ')}`,
  ];

  if (plan.debate) {
    lines.push(
      `Debate first: "${plan.debate.topic}" with ${plan.debate.participants.join(', ')} using ${plan.debate.tools.join(' -> ')}`,
    );
  }
  if (plan.conversation) {
    lines.push(
      `Structured conversation: "${plan.conversation.topic}" with ${plan.conversation.participants.join(', ')} using ${plan.conversation.tools.join(' -> ')}`,
    );
  }

  lines.push(
    `Phases: ${plan.phases.map((phase) => `${phase.id}[${phase.owner}]`).join(' -> ')}`,
    `Gates: ${plan.gates.join(', ')}`,
    'Rule: decide reversible choices yourself; escalate only when a DNA rule or an irreversible/high-risk action requires a human. Never install a stack by hand-writing generated code — consult official docs and use the CLI.',
  );

  return lines.join('\n');
}

/**
 * Deterministic chief planner. One instance is cheap; it holds no mutable
 * state, so a host can reuse it across prompts.
 */
export class ChiefOrchestrator {
  private readonly now: () => string;

  constructor(options: ChiefOrchestratorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  plan(request: ChiefRequest): ChiefPlan {
    const goal = request.goal.trim();
    const haystack = goal.toLowerCase();
    const dnaRoster = personaRoster(request.dna);
    const roster = request.roster?.length
      ? [...request.roster]
      : dnaRoster.length > 0
        ? dnaRoster
        : DEFAULT_ROSTER;

    const wordCount = goal.split(/\s+/).filter(Boolean).length;
    const signalHits = COMPLEXITY_SIGNALS.filter((signal) => haystack.includes(signal)).length;
    const complexity = clamp01(Math.min(0.6, wordCount / 140) + Math.min(0.4, signalHits * 0.12));

    const needsStackSetup = hasSignal(haystack, STACK_SIGNALS);
    const needsResearch = needsStackSetup || hasSignal(haystack, RESEARCH_SIGNALS);
    const needsDataAssessment = hasSignal(haystack, DATA_SIGNALS);
    const needsFairness = hasSignal(haystack, FAIRNESS_SIGNALS);
    const needsSecurityReview = hasSignal(haystack, SECURITY_SIGNALS);
    // A review/audit/verify request is analysis, not construction. Suppress the
    // build collaboration unless the user asked for it explicitly; otherwise a
    // long review prompt clears the word-count complexity threshold and opens a
    // brainstorm about reviewing.
    const readOnlyIntent = hasSignal(haystack, READ_ONLY_SIGNALS);
    const explicitCollaboration = hasSignal(haystack, EXPLICIT_COLLAB_SIGNALS);
    const collaborationAllowed = !readOnlyIntent || explicitCollaboration;
    const needsDebate =
      collaborationAllowed && (hasSignal(haystack, DEBATE_SIGNALS) || complexity >= 0.5);
    const needsConversation =
      collaborationAllowed &&
      (hasSignal(haystack, CONVERSATION_SIGNALS) || (complexity >= 0.65 && roster.length >= 3));

    const rationale: string[] = [];
    if (readOnlyIntent && !explicitCollaboration) {
      rationale.push('read-only intent: build collaboration suppressed');
    }
    if (complexity >= 0.5) rationale.push(`complexity ${complexity.toFixed(2)} >= 0.50`);
    if (needsDebate) rationale.push('goal contains an architecture/decision trade-off');
    if (needsConversation) rationale.push('goal benefits from multiple agent perspectives');
    if (needsResearch) rationale.push('goal depends on external documentation or a stack CLI');
    if (needsDataAssessment) rationale.push('goal touches data shape/quality');
    if (needsFairness) rationale.push('goal touches model decisions or protected groups');
    if (needsSecurityReview) rationale.push('goal touches security-sensitive surfaces');

    const capabilities: ChiefCapability[] = [];
    if (needsDebate) capabilities.push('architecture-decision', 'brainstorm');
    if (needsConversation) capabilities.push('pragmatic-conversation');
    if (needsDebate || needsConversation) capabilities.push('consensus');
    if (needsResearch) capabilities.push('research');
    if (needsStackSetup) capabilities.push('stack-setup');
    if (needsDataAssessment) capabilities.push('data-assessment');
    if (needsFairness) capabilities.push('fairness');
    if (needsSecurityReview) capabilities.push('security-review');
    capabilities.push('delegation', 'verification', 'audit', 'learning');

    const assessment: ChiefAssessment = {
      complexity,
      risk: riskOf(haystack, { security: needsSecurityReview, data: needsDataAssessment }),
      needsDebate,
      needsConversation,
      needsResearch,
      needsStackSetup,
      needsDataAssessment,
      needsFairness,
      needsSecurityReview,
      capabilities: uniqueCapabilities(capabilities),
      rationale,
    };

    const decision = decideArchitecture(haystack, needsStackSetup);

    const architect = pickOwner(
      roster,
      ['architect', 'principal', 'lead'],
      roster[0]?.id ?? 'architect',
    );
    const developer = pickOwner(
      roster,
      ['developer', 'engineer', 'builder', 'implement'],
      architect,
    );
    const reviewer = pickOwner(roster, ['reviewer', 'review', 'qa', 'analyst'], developer);
    const auditor = pickOwner(roster, ['auditor', 'compliance', 'security'], reviewer);

    const phases: ChiefPhase[] = [
      {
        id: 'assess',
        name: 'Assess and ground',
        owner: architect,
        gates: phaseGates('assess'),
        tools: phaseTools('assess', assessment),
      },
      {
        id: 'decide',
        name: 'Decide the approach',
        owner: architect,
        gates: phaseGates('decide'),
        tools: phaseTools('decide', assessment),
      },
    ];

    if (needsResearch) {
      phases.push({
        id: 'research',
        name: 'Consult official docs and examples',
        owner: pickOwner(roster, ['researcher', 'analyst', 'architect'], architect),
        gates: phaseGates('research'),
        tools: phaseTools('research', assessment),
      });
    }

    phases.push(
      {
        id: 'build',
        name: 'Implement through the approved adapter',
        owner: developer,
        gates: phaseGates('build'),
        tools: phaseTools('build', assessment),
      },
      {
        id: 'verify',
        name: 'Verify with executed evidence',
        owner: reviewer,
        gates: phaseGates('verify'),
        tools: phaseTools('verify', assessment),
      },
      {
        id: 'audit',
        name: 'Audit and map compliance',
        owner: auditor,
        gates: phaseGates('audit'),
        tools: phaseTools('audit', assessment),
      },
      {
        id: 'learn',
        name: 'Record the verified outcome',
        owner: auditor,
        gates: phaseGates('learn'),
        tools: phaseTools('learn', assessment),
      },
    );

    const tasks: ChiefTask[] = phases.map((phase, index) => ({
      id: `${index + 1}-${phase.id}`,
      objective: phase.name,
      owner: phase.owner,
      phase: phase.id,
      dependsOn: index === 0 ? [] : [`${index}-${phases[index - 1]?.id ?? 'assess'}`],
      tools: phase.tools,
      gate: phase.gates[0] ?? phase.id,
      mutating: phase.id === 'build' || phase.id === 'learn',
    }));

    const delegation = tasks.map((task) => ({
      taskId: task.id,
      agentId: task.owner,
      role: roster.find((entry) => entry.id === task.owner)?.role ?? 'operator',
      reason: `chief selected ${task.owner} for phase ${task.phase}`,
    }));

    const debate = needsDebate
      ? {
          topic: `Choose the approach for: ${goal.slice(0, 120)}`,
          participants: uniqueParticipants(roster, architect, reviewer),
          tools: [
            'bos_create_brainstorm',
            'bos_propose_idea',
            'bos_vote_idea',
            'bos_resolve_consensus',
          ],
        }
      : null;

    const conversation = needsConversation
      ? {
          topic: `Resolve the problem for: ${goal.slice(0, 120)}`,
          participants: uniqueParticipants(roster, developer, reviewer),
          tools: [
            'bos_start_conversation',
            'bos_add_conversation_turn',
            'bos_resolve_conversation',
          ],
        }
      : null;

    const gates = [
      ...new Set([
        ...phases.flatMap((phase) => phase.gates),
        ...(needsFairness ? ['fairness-evaluated'] : []),
        ...(needsSecurityReview ? ['security-reviewed'] : []),
      ]),
    ];

    const partial = {
      goal,
      assessment,
      decision,
      phases,
      tasks,
      delegation,
      debate,
      conversation,
      gates,
      generatedAt: this.now(),
    };

    return { ...partial, context: buildContext(partial) };
  }
}

function uniqueParticipants(roster: ChiefRosterEntry[], first: string, second: string): string[] {
  const participants = [first, second, ...roster.map((entry) => entry.id)];
  return [...new Set(participants)].slice(0, 4);
}
