/**
 * Pure governance helpers for the Behavior-OS OpenCode plugin.
 *
 * These are deliberately free of any OpenCode/plugin imports so they can be unit
 * tested in isolation and reused by the CLI or MCP server.
 */

import type { MissionPriority, MissionType } from '@behavior-os/schemas';

/** Tools whose execution mutates state and therefore counts as a `change`. */
const MUTATING_TOOL = /write|edit|patch|bash|shell|apply|create|delete|move/i;

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

function isMutating(value: string | undefined): boolean {
  return typeof value === 'string' && MUTATING_TOOL.test(value);
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
  const haystack = strings.join(' ').toLowerCase();

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

  // Deployment / release activities.
  if (hasPhrase('deploy', 'releas', 'publish', 'rollout') || hasWord('ship')) {
    context.deployment = true;
  }

  // Production / live environments. `prod` uses a word boundary so "product"
  // and "produce" do not match.
  if (hasWord('production', 'prod', 'live') || hasPhrase('--prod', '-prod')) {
    context.production = true;
    context['production-change'] = true;
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

  return context;
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
  /^(hi|hello|hey|yo|thanks|thank you|ok|okay|yes|no|sure|please|go on|continue)[\s!.?]*$/i;

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
