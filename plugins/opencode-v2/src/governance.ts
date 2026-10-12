/**
 * Pure governance helpers for the Behavior-OS OpenCode plugin.
 *
 * These are deliberately free of any OpenCode/plugin imports so they can be unit
 * tested in isolation and reused by the CLI or MCP server.
 */

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
