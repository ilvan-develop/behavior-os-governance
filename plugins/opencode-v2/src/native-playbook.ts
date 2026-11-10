/**
 * Native operating contract for Behavior-OS.
 *
 * Behavior-OS is only "native" when the model does not need to be told which
 * capability to use. This module is the small, pure mapping between intent and
 * the Behavior-OS surface:
 *
 *   intent -> capability -> concrete `bos_*` tools / skill
 *
 * It is consumed by two hooks:
 *
 *  - `agent.transform` appends {@link buildOperatingContract} to every agent's
 *    system prompt (static, always present);
 *  - `session.context` injects the plan produced by the `ChiefOrchestrator`
 *    (live, per request).
 *
 * Pure by design: no host imports, so it is unit-testable and reusable by the
 * MCP server or CLI.
 */

/** A capability the model should reach for without being asked. */
export interface CapabilityRule {
  id: CapabilityId;
  /** Human-readable trigger summary used in the operating contract. */
  trigger: string;
  /** Substrings that activate the capability (lower-case, matched on text). */
  signals: readonly string[];
  /** Behavior-OS surface the model should use, in order. */
  tools: readonly string[];
  /** One-line instruction injected into the contract. */
  instruction: string;
}

export type CapabilityId =
  | 'architecture'
  | 'brainstorm'
  | 'conversation'
  | 'consensus'
  | 'research'
  | 'stack-setup'
  | 'data-assessment'
  | 'fairness'
  | 'risk'
  | 'audit'
  | 'learning';

export const CAPABILITY_RULES: readonly CapabilityRule[] = [
  {
    id: 'architecture',
    trigger: 'designing, planning or choosing an approach',
    signals: [
      'architecture',
      'design',
      'approach',
      'tradeoff',
      'trade-off',
      'strategy',
      'should we',
      'choose',
    ],
    tools: ['bos_create_meta_decision', 'bos_resolve_consensus', 'bos_decide'],
    instruction:
      'State the decision, the alternatives considered and the rationale; record it before building.',
  },
  {
    id: 'brainstorm',
    trigger: 'open-ended ideation or several viable options',
    signals: [
      'brainstorm',
      'idea',
      'ideas',
      'explore options',
      'possibilities',
      'alternatives',
      'compare',
      'what if',
    ],
    tools: ['bos_create_brainstorm', 'bos_propose_idea', 'bos_vote_idea'],
    instruction:
      'Open a brainstorm session and propose at least two competing ideas; do not jump to the first one.',
  },
  {
    id: 'conversation',
    trigger: 'a problem needs more than one perspective or the team disagrees',
    signals: [
      'team',
      'agents',
      'collaborat',
      'debate',
      'discuss',
      'conflict',
      'disagree',
      'review',
    ],
    tools: ['bos_start_conversation', 'bos_add_conversation_turn', 'bos_resolve_conversation'],
    instruction:
      'Run a structured pragmatic conversation and resolve it with a solution plus lessons learned.',
  },
  {
    id: 'consensus',
    trigger: 'irreversible or contested decisions',
    signals: ['consensus', 'vote', 'decide together', 'quorum', 'disagreement'],
    tools: ['bos_resolve_consensus', 'bos_collective_decision', 'bos_decide'],
    instruction: 'Use weighted votes, not a single opinion; ties fail safe to rejected.',
  },
  {
    id: 'research',
    trigger: 'any external library, framework, SDK, API or version',
    signals: [
      'library',
      'framework',
      'sdk',
      'api',
      'docs',
      'documentation',
      'version',
      'upgrade',
      'install',
      'setup',
      'scaffold',
      'official',
      'example',
    ],
    tools: ['docs-research skill', 'webfetch', 'bos_record_learning'],
    instruction:
      'Consult official documentation and examples before writing code; never invent an API.',
  },
  {
    id: 'stack-setup',
    trigger: 'installing a stack, scaffolding a project or adding dependencies',
    signals: [
      'install',
      'scaffold',
      'bootstrap',
      'create app',
      'new project',
      'setup',
      'set up',
      'stack',
      'dependency',
      'shadcn',
      'next.js',
      'vite',
      'react',
      'fastapi',
      'django',
    ],
    tools: ['stack-install skill', 'framework CLI', 'pnpm typecheck', 'pnpm test'],
    instruction:
      'Use the framework CLI to generate the stack; do not hand-write generated files. Verify with real commands.',
  },
  {
    id: 'data-assessment',
    trigger: 'datasets, schemas, ETL, data quality or migrations',
    signals: [
      'data',
      'dataset',
      'schema',
      'etl',
      'warehouse',
      'quality',
      'lineage',
      'migration',
      'ingest',
    ],
    tools: ['bos_check_quality', 'bos_query_knowledge_graph', 'bos_record_learning'],
    instruction:
      'Assess provenance, shape and quality before transforming data; record the dataset assumptions.',
  },
  {
    id: 'fairness',
    trigger: 'models, automated decisions, rankings or protected groups',
    signals: [
      'fairness',
      'bias',
      'model',
      'training',
      'predict',
      'classification',
      'recommendation',
      'ranking',
      'credit',
      'hiring',
    ],
    tools: ['bos_evaluate_fairness', 'bos_map_compliance'],
    instruction:
      'Evaluate fairness (parity, disparate impact, equal opportunity) and provenance before shipping a model decision.',
  },
  {
    id: 'risk',
    trigger: 'production, deployment, destructive or security-sensitive changes',
    signals: [
      'production',
      'deploy',
      'release',
      'delete',
      'drop',
      'destroy',
      'migrate',
      'secret',
      'credential',
      'permission',
      'security',
    ],
    tools: ['bos_preflight', 'bos_evaluate_governance', 'bos_run_audit'],
    instruction: 'Preflight before acting; a DNA deny is final and is reported, never bypassed.',
  },
  {
    id: 'audit',
    trigger: 'compliance, review or any completion claim',
    signals: ['audit', 'compliance', 'review', 'verify', 'done', 'complete', 'finish'],
    tools: ['bos_run_audit', 'bos_map_compliance', 'bos_verify_audit_trail'],
    instruction: 'Run the audit with real checks before saying the work is complete.',
  },
  {
    id: 'learning',
    trigger: 'the end of any mission or a repeated failure',
    signals: ['learning', 'lesson', 'retrospective', 'postmortem', 'repeated failure'],
    tools: ['bos_record_learning', 'bos_get_insights', 'bos_recommendations'],
    instruction: 'Record the verified outcome and promote lessons through the learning lifecycle.',
  },
];

export interface CapabilityIntent {
  id: CapabilityId;
  confidence: number;
  signals: string[];
  tools: string[];
}

/**
 * Classify free text into the capabilities it genuinely needs.
 *
 * Confidence is a bounded signal count, not a probability: two distinct
 * signals score 0.6, one scores 0.4. The guidance threshold is 0.4.
 */
export function classifyCapabilities(text: string): CapabilityIntent[] {
  const haystack = ` ${text.toLowerCase()} `;
  const intents: CapabilityIntent[] = [];

  for (const rule of CAPABILITY_RULES) {
    const hits = rule.signals.filter((signal) => haystack.includes(signal));
    if (hits.length === 0) continue;
    intents.push({
      id: rule.id,
      confidence: Math.min(0.9, 0.4 + (hits.length - 1) * 0.2),
      signals: hits,
      tools: [...rule.tools],
    });
  }

  return intents.sort((a, b) => b.confidence - a.confidence);
}

/** Render the per-request recommendation block (empty when nothing matches). */
export function renderCapabilityHints(intents: readonly CapabilityIntent[]): string {
  if (intents.length === 0) return '';
  const lines = intents.slice(0, 4).map((intent) => {
    const rule = CAPABILITY_RULES.find((candidate) => candidate.id === intent.id);
    return `- ${intent.id}: ${rule?.instruction ?? 'use the matching Behavior-OS tools'} (${intent.tools.join(', ')})`;
  });
  return ['[Behavior-OS:native] Detected capabilities for this request:', ...lines].join('\n');
}

/**
 * Static operating contract appended to every agent system prompt.
 *
 * Kept short on purpose: it changes *default behavior* (what the model reaches
 * for without being asked) and defers live state to `session.context`.
 */
export function buildOperatingContract(): string {
  return [
    '[Behavior-OS:native] Operating contract — this is not optional advice; it is how you behave in this workspace.',
    'You are a governed teammate, not a generic assistant. Decide reversible, in-scope choices yourself; escalate only when a DNA rule or an irreversible/high-risk action requires a human.',
    'Reach for these capabilities without waiting to be told:',
    '- Architecture/design/trade-off -> state alternatives, decide, record with bos_create_meta_decision / bos_resolve_consensus, then build.',
    '- Ideation or several viable options -> bos_create_brainstorm -> bos_propose_idea (at least two) -> bos_vote_idea -> converge.',
    '- More than one perspective or disagreement -> bos_start_conversation -> bos_add_conversation_turn -> bos_resolve_conversation.',
    '- Library/framework/SDK/API/version -> consult official docs and examples first (docs-research skill); never invent an API.',
    '- Install/scaffold/add a stack -> use the framework CLI (stack-install skill); never hand-write generated code; verify with real commands.',
    '- Dataset/schema/ETL -> assess provenance and quality before transforming.',
    '- Model/automated decision/ranking -> bos_evaluate_fairness before shipping (parity, disparate impact, opportunity).',
    '- Production/destructive/security change -> bos_preflight, then obey the DNA verdict (a deny is final).',
    '- Before saying "done" -> bos_run_audit with real evidence, then bos_record_learning.',
    'If a Behavior-OS tool exists for the step, use it instead of an ad-hoc equivalent. Keep plans, decisions and evidence in Behavior-OS so the next agent inherits them.',
  ].join('\n');
}

/** Reuse a collaboration artifact inside this window even when the intent differs. */
export const NATIVE_COLLAB_REUSE_MS = 5 * 60 * 1000;

/** The fields needed to decide whether a new prompt may reuse a collaboration. */
export interface CollaborationReuseState {
  at: number;
  goalKey: string;
}

/**
 * Decide whether a prompt may reuse the collaboration sessions already opened
 * for its session.
 *
 * Same normalized intent always reuses. A different intent reuses only for a
 * short window, so a new design topic gets a fresh brainstorm instead of
 * inheriting an unrelated one for the whole 30-minute plan window.
 */
export function shouldReuseCollaboration(
  previous: CollaborationReuseState | undefined,
  goalKey: string,
  now: number,
  planTtlMs = 30 * 60 * 1000,
): boolean {
  if (!previous) return false;
  const age = now - previous.at;
  if (age < 0 || age > planTtlMs) return false;
  return previous.goalKey === goalKey || age <= NATIVE_COLLAB_REUSE_MS;
}
