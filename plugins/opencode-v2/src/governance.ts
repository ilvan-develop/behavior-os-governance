/**
 * Pure governance helpers for the Behavior-OS OpenCode plugin.
 *
 * These are deliberately free of any OpenCode/plugin imports so they can be unit
 * tested in isolation and reused by the CLI or MCP server.
 */

import { isMutatingAction } from '@behavior-os/core';
import type { MissionPriority, MissionType } from '@behavior-os/schemas';
import { buildOperatingContract } from './native-playbook.js';

/** Alias of the core action classifier: one mutation vocabulary for all hosts. */
export const isMutating = isMutatingAction;

/**
 * Actions able to *perform* an operation on an environment: they run a command or
 * invoke an operational verb. Only these may turn their own arguments into a
 * `deployment` signal — a read-only search or a file edit that merely mentions
 * "deploy" is not a deployment, and treating it as one made every such call
 * escalate (C24: permission log seq 2649/2650/2656).
 */
const ENVIRONMENT_ACTION =
  /bash|shell|exec|execute|command|run|invoke|script|deploy|releas|publish|rollout|promote|push|apply|migrate|install/i;

/**
 * Signals used to build the condition bag a DNA governance rule is matched
 * against. The engine (`GovernanceEngine.evaluateConditions`) matches rule
 * conditions by *key* against this bag, so the keys here must line up with the
 * condition `type`s declared in the DNA YAML files (`production`, `deployment`,
 * `change`, `financial-transaction`, ...).
 */
export interface GovernanceSignals {
  /** Tool or action being performed (e.g. `bash`, `write`, `deploy`). */
  tool?: string;
  /** Human/agent action label, when distinct from the tool. */
  action?: string;
  /** Resources involved (file paths, URLs, targets). */
  resources?: readonly string[];
  /** Free-form metadata from the caller (merged in and scanned). */
  metadata?: Record<string, unknown>;
  /** Raw text to scan for heuristics (prompt, command, diff...). */
  text?: string;
}

/**
 * Collect the *values* (not keys) of a value tree into a list of strings. Keys
 * are intentionally excluded so a metadata flag like `{ production: false }`
 * does not trip the `production` keyword heuristic. Numbers/booleans are ignored
 * for the same reason.
 */
function collectStrings(value: unknown, into: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, into);
    }
  }
}

/**
 * A dependency signal derived from text is only meaningful when the action can
 * actually run a package manager. Without this guard, any edit whose surrounding
 * context quotes an install command is blocked by `license-check` — the same
 * class of false positive as C24 for deployments. A signal explicitly supplied
 * in metadata is kept: the caller declared it.
 */
function withoutDerivedDependencySignal(
  context: Record<string, unknown>,
  canOperate: boolean,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (canOperate || !('new-dependency' in context)) return context;
  if (metadata && 'new-dependency' in metadata) return context;
  const filtered = { ...context };
  delete filtered['new-dependency'];
  return filtered;
}

/**
 * Build the condition context for a governance evaluation from the concrete
 * action being taken. Returns a superset of likely signals; rules only fire when
 * their own condition keys are present, so extra keys are harmless.
 */
export function buildGovernanceContext(signals: GovernanceSignals): Record<string, unknown> {
  const strings: string[] = [signals.action ?? '', signals.tool ?? '', signals.text ?? ''];
  collectStrings(signals.metadata, strings);
  if (signals.resources) {
    for (const resource of signals.resources) collectStrings(resource, strings);
  }
  // Split camelCase/PascalCase boundaries before matching so code identifiers
  // do not leak lowercase substrings that merely *look* like a short sensitive
  // token; word- and phrase-matching then fires on real content only. Standalone
  // tokens in prose (uppercase acronyms, hyphenated values) are unaffected.
  const haystack = strings
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();

  const hasWord = (...words: string[]): boolean =>
    words.some((word) => new RegExp(`\\b${word}\\b`).test(haystack));
  const hasPhrase = (...phrases: string[]): boolean =>
    phrases.some((phrase) => haystack.includes(phrase));

  const context: Record<string, unknown> = {};
  if (signals.action) context.action = signals.action;
  if (signals.tool) context.tool = signals.tool;
  for (const [key, value] of Object.entries(signals.metadata ?? {})) {
    if (!(key in context)) context[key] = value;
  }

  // Mutating tools are always a change.
  if (isMutating(signals.tool) || isMutating(signals.action)) {
    context.change = true;
  }

  // `deployment` and `production` are read off the action's own arguments, so
  // they are derived only for actions able to *perform* one. Reading a read-only
  // `grep` for the word "deploy" as a deployment is what made the host ask for
  // approval on every search (C24). Content-domain signals (phi, pii, secrets,
  // ...) stay text-derived: there, *touching* the content is the risk.
  const changesState = isMutating(signals.tool) || isMutating(signals.action);
  const canOperate = ENVIRONMENT_ACTION.test(`${signals.action ?? ''} ${signals.tool ?? ''}`);

  // A deployment is *performed*: only an action that can run one deploys. Writing
  // a file that mentions "release" is not a release.
  if (canOperate && (hasPhrase('deploy', 'releas', 'publish', 'rollout') || hasWord('ship'))) {
    context.deployment = true;
  }

  // A production *change*, however, is touched by anything that is not read-only:
  // writing `infra/prod/main.tf` counts, and surgical-team's `sterile-field` rule
  // blocks on it. `prod` uses a word boundary so "product"/"produce" do not match.
  if (
    (canOperate || changesState) &&
    (hasWord('production', 'prod', 'live') || hasPhrase('--prod', '-prod'))
  ) {
    context.production = true;
    context['production-change'] = true;
  }

  // Domain-specific deployment/change signals. These are *performed* by an
  // action that can execute or mutate, never by a read-only mention, and each
  // maps to a block rule in exactly one DNA (model-validation, security-audit,
  // pipeline-approval, app-store-compliance). They stay text-derived because
  // the host exposes no structured signal for them.
  if (canOperate) {
    if (
      hasPhrase(
        'deploy model',
        'model deployment',
        'release model',
        'promote model',
        'model rollout',
      )
    ) {
      context['model-deployment'] = true;
    }
    if (hasPhrase('deploy contract', 'contract deployment', 'publish contract')) {
      context['contract-deployment'] = true;
    }
    if (hasPhrase('app store', 'play store', 'store submission', 'submit for review')) {
      context['app-store-submission'] = true;
    }
  }

  if (changesState) {
    const pipelineResource = (signals.resources ?? []).some((resource) =>
      /(?:\.github\/workflows\/|gitlab-ci|jenkinsfile|azure-pipelines|\.circleci)/i.test(resource),
    );
    if (
      pipelineResource ||
      hasPhrase(
        'pipeline change',
        'update pipeline',
        'modify pipeline',
        'ci/cd',
        'ci pipeline',
        'deployment pipeline',
        'workflow file',
      )
    ) {
      context['pipeline-change'] = true;
    }
  }

  // Destructive / critical actions.
  if (
    hasPhrase(
      'rm -rf',
      'drop table',
      'truncate',
      'delete from',
      'force push',
      'force-push',
      '--hard',
      'wipe',
    ) ||
    hasWord('destroy')
  ) {
    context['critical-action'] = true;
    context['breaking-change'] = true;
    context['data-modification'] = true;
  }

  // Secrets / credentials / privilege escalation.
  if (
    hasWord('secret', 'secrets', 'token', 'password', 'credential', 'credentials', 'sudo') ||
    hasPhrase('api key', 'api_key', 'chmod 777')
  ) {
    context['privilege-escalation'] = true;
  }

  // New dependencies.
  if (hasPhrase('npm install', 'npm i ', 'pnpm add', 'yarn add', 'add dependency')) {
    context['new-dependency'] = true;
  }

  // Regulated / sensitive data domains.
  if (hasPhrase('patient', 'medical record', 'clinical', 'hipaa') || hasWord('phi')) {
    context['patient-record'] = true;
    context.phi = true;
  }
  if (
    hasWord('pii') ||
    hasPhrase('personal data', 'passport', 'ssn', 'credit card', 'card number')
  ) {
    context['pii-access'] = true;
    context['pii-data'] = true;
  }
  if (hasPhrase('payment', 'transaction', 'wire transfer', 'transfer funds')) {
    context['financial-transaction'] = true;
    context['financial-operation'] = true;
  }
  if (hasPhrase('high value', 'high-value', 'large transfer')) {
    context['high-value'] = true;
  }

  return withoutDerivedDependencySignal(context, canOperate, signals.metadata);
}

/**
 * Keyword → DNA pattern classifier used to suggest a pattern for a user prompt.
 * The keys are the DNA file basenames under `dnas/`.
 */
export const DNA_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'quantum-computing': ['quantum', 'qubit', 'circuit', 'qiskit', 'qaoa'],
  'blockchain-web3': [
    'blockchain',
    'web3',
    'solidity',
    'smart contract',
    'wallet',
    'nft',
    'ethereum',
    'on-chain',
  ],
  'ai-ml-pipeline': [
    'machine learning',
    ' ml ',
    'model training',
    'dataset',
    'drift',
    'inference',
    'neural',
    'llm',
    'embedding',
  ],
  'data-engineering': [
    'etl',
    'data pipeline',
    'warehouse',
    'dbt',
    'airflow',
    'lineage',
    'data quality',
    'snowflake',
  ],
  'cloud-native': [
    'kubernetes',
    'k8s',
    'helm',
    'container',
    'cluster',
    'autoscaling',
    'terraform',
    'istio',
  ],
  'devops-pipeline': [
    'ci/cd',
    'ci pipeline',
    'pipeline',
    'deploy',
    'release',
    'rollback',
    'github actions',
    'jenkins',
  ],
  'enterprise-governance': ['governance', 'compliance', 'policy', 'audit', 'pii', 'change control'],
  'enterprise-sox': ['sox', 'financial reporting', 'segregation of duties', 'internal controls'],
  'financial-compliance': ['kyc', 'aml', 'regulatory', 'transaction monitoring', 'payment'],
  'fintech-trading': ['trading', 'order book', 'latency', 'market data', 'portfolio', 'risk limit'],
  'gaming-studio': ['game', 'unity', 'unreal', 'fps', 'shader', 'gameplay', 'asset pipeline'],
  'healthcare-hipaa': ['hipaa', 'patient', 'phi', 'medical', 'clinical', 'health record'],
  'iot-embedded': ['embedded', 'firmware', 'sensor', 'microcontroller', 'rtos', 'iot'],
  'legacy-modernization': ['legacy', 'modernization', 'modernize', 'cobol', 'strangler'],
  'lean-factory': ['lean', 'kaizen', 'waste', 'continuous improvement', 'value stream'],
  'military-operations': [
    'tactical',
    'opsec',
    'mission critical',
    'command',
    'situational awareness',
  ],
  'mobile-app': ['mobile', 'ios', 'android', 'app store', 'react native', 'flutter'],
  'open-source': [
    'open source',
    'open-source',
    'oss',
    'pull request',
    'license',
    'dco',
    'changelog',
  ],
  'research-lab': [
    'research',
    'experiment',
    'hypothesis',
    'publication',
    'reproducibility',
    'notebook',
  ],
  'startup-agile': ['sprint', 'agile', 'mvp', 'backlog', 'standup', 'scrum'],
  'surgical-team': ['surgical', 'zero-defect', 'zero defect', 'sterile', 'production change'],
};

/**
 * Classify free text into the best matching DNA pattern key.
 *
 * @param text The text to classify (e.g. the user's prompt).
 * @param available The DNA keys that are actually loaded; matches outside this
 *   set are ignored. When omitted, every keyword entry is considered.
 * @returns The best matching key, or `null` when nothing scores.
 */
export function classifyDNA(text: string, available?: Iterable<string>): string | null {
  const haystack = ` ${text.toLowerCase()} `;
  const allowed = available ? new Set(available) : null;

  let best: string | null = null;
  let bestScore = 0;

  for (const [key, keywords] of Object.entries(DNA_KEYWORDS)) {
    if (allowed && !allowed.has(key)) continue;
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) score += keyword.trim().includes(' ') ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }

  return best;
}

/** Maximum length of an auto-generated mission title. */
const MISSION_TITLE_MAX = 80;

/** First-match-wins mission type heuristics, ordered from most to least urgent. */
const MISSION_TYPE_KEYWORDS: ReadonlyArray<readonly [MissionType, readonly string[]]> = [
  ['incident', ['incident', 'outage', 'sev1', 'sev2', 'hotfix', 'production down', 'page on-call']],
  ['deployment', ['deploy', 'release', 'rollout', 'publish', 'ship to']],
  [
    'bugfix',
    ['bug', 'fix', 'error', 'crash', 'broken', 'regression', 'fails', 'failing', 'exception'],
  ],
  [
    'refactor',
    ['refactor', 'cleanup', 'clean up', 'rename', 'restructure', 'migrate', 'tech debt'],
  ],
  ['audit', ['audit', 'review', 'compliance', 'security scan', 'lint', 'vulnerab']],
  [
    'research',
    ['research', 'investigate', 'explore', 'analyze', 'analyse', 'spike', 'evaluate', 'compare'],
  ],
  [
    'feature',
    ['add', 'implement', 'create', 'build', 'support', 'introduce', 'develop', 'feature'],
  ],
];

/** Priority heuristics, scanned in order; the first hit wins. */
const MISSION_PRIORITY_KEYWORDS: ReadonlyArray<readonly [MissionPriority, readonly string[]]> = [
  [
    'critical',
    ['production', 'prod', 'outage', 'incident', 'sev1', 'urgent', 'asap', 'critical', 'data loss'],
  ],
  ['high', ['security', 'vulnerab', 'bug', 'crash', 'broken', 'regression', 'hotfix']],
  ['low', ['docs', 'documentation', 'readme', 'typo', 'comment', 'chore', 'cleanup']],
];

/** Short social replies that should never spawn a mission. */
const SOCIAL_REPLY =
  /^(hi|hello|hey|yo|thanks|thank you|ok|okay|yes|no|sure|please|go on|continue|continua|continuar|prossiga|prosseguir|segue|segue em frente|avanca|avança|next|go ahead)[\s!.?]*$/i;

/**
 * A continuation ("prossiga com a implementação") resumes existing work; it is
 * not a new work item. Creating a mission for it is what produced the echo
 * missions in the ledger, so it is filtered before keyword classification.
 */
const CONTINUATION_PREFIX =
  /^(continua|continuar|continue|prossiga|prosseguir|segue|go on|next)\b/i;

/** A lightweight, auto-derived mission. */
export interface MissionIntent {
  title: string;
  type: MissionType;
  priority: MissionPriority;
}

function buildMissionTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MISSION_TITLE_MAX) return singleLine;
  return `${singleLine.slice(0, MISSION_TITLE_MAX - 3).trimEnd()}...`;
}

/**
 * Classify a user prompt into a mission intent so an auto-created mission is
 * meaningful rather than a generic placeholder.
 *
 * @returns The derived intent, or `null` when the prompt clearly does not
 *   describe work (greetings, acknowledgements, or very short input).
 */
export function classifyMissionIntent(text: string): MissionIntent | null {
  const trimmed = text.trim();
  if (trimmed.length < 12) return null;
  if (SOCIAL_REPLY.test(trimmed)) return null;
  if (CONTINUATION_PREFIX.test(trimmed)) return null;

  const haystack = ` ${trimmed.toLowerCase()} `;
  const hasWord = (word: string): boolean => new RegExp(`\\b${word}\\b`).test(haystack);
  const hasAny = (words: readonly string[]): boolean => words.some((word) => hasWord(word));

  let type: MissionType = 'feature';
  let matched = false;
  for (const [candidate, keywords] of MISSION_TYPE_KEYWORDS) {
    if (hasAny(keywords)) {
      type = candidate;
      matched = true;
      break;
    }
  }
  // With no explicit work verb, only treat as work if the prompt is substantive.
  if (!matched && trimmed.length < 24) return null;

  let priority: MissionPriority = 'medium';
  for (const [candidate, keywords] of MISSION_PRIORITY_KEYWORDS) {
    if (hasAny(keywords)) {
      priority = candidate;
      break;
    }
  }

  return { title: buildMissionTitle(trimmed), type, priority };
}

/**
 * Marker embedded at the top of a governed agent preamble. Used to keep the
 * agent transform idempotent: an agent whose system prompt already contains it is
 * left untouched.
 */
export const GOVERNED_PREAMBLE_MARKER = '<!-- behavior-os:governed -->';

/**
 * Static, agent-level Behavior-OS preamble appended to every agent's system
 * prompt.
 *
 * Deliberately short and state-free: the live DNA, protocol step and mission are
 * injected per request by the plugin's `session.context` hook. This only makes the
 * location's governance explicit inside the agent definition itself and points
 * the model at the 7-step protocol and the `behavior-os` skill.
 */
export function buildGovernedPreamble(): string {
  return [
    GOVERNED_PREAMBLE_MARKER,
    '[Behavior-OS] This project is governed. Before mutating files or running risky commands, select a DNA pattern with bos_select_dna and follow the 7-step protocol: bos_list_dna -> bos_get_state -> bos_create_mission -> bos_start_mission -> bos_run_audit -> bos_record_learning.',
    'The active DNA, current step and mission are provided in the session context. Load the behavior-os skill for the intent-to-DNA map and the meaning of a governance block or escalation.',
    'For multi-step or delegated work, prefer the orchestration tools (bos_start_loop, bos_resolve_consensus, bos_create_brainstorm) over ad-hoc execution; validate with bos_run_audit before bos_complete_mission.',
    buildOperatingContract(),
  ].join('\n');
}
