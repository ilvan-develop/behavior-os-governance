/**
 * Exposed engines — tools that surface the 11 isolated engines.
 *
 * The `packages/core` engine set has 48 engines. Most are reachable
 * through an existing `bos_*` tool (knowledge graph, natural language,
 * metacognition stats, persistent memory, temporal, behavioral-ux,
 * circuit breaker *primitive*, consensus, cross-DNA, code-fixes, ...).
 *
 * Eleven engines have **no** tool in the OpenCode plugin or in the external
 * MCP server. They exist in the facade but the agent has no way to consult
 * them during a decision. This module adds one thin, read-only tool per
 * engine so that every engine in the facade is reachable from a prompt.
 *
 * The tools are deliberately **thin**:
 *   - one engine method per tool,
 *   - a plain-JSON input,
 *   - JSON-stringified output,
 *   - no side effects other than what the engine itself records.
 *
 * They are registered in `plugins/opencode-v2/src/index.ts` via
 * `registerExposedTools(ctx, bos)`.
 */

import type { BehaviorOS } from '@behavior-os/core';
import type { DNA, PipelinePhaseDefinition } from '@behavior-os/schemas';
export interface ExposedToolDefinition {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (input: Record<string, unknown>, bos: BehaviorOS) => Promise<unknown>;
}

function pick(input: Record<string, unknown>, key: string, fallback?: unknown): unknown {
  return key in input ? input[key] : fallback;
}
function pickString(input: Record<string, unknown>, key: string): string | undefined {
  const v = pick(input, key);
  return typeof v === 'string' ? v : undefined;
}
function pickNumber(input: Record<string, unknown>, key: string): number | undefined {
  const v = pick(input, key);
  return typeof v === 'number' ? v : undefined;
}
function pickStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const v = pick(input, key);
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}
function pickObject(
  input: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = pick(input, key);
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

/** The 11 tools, one per isolated engine. All read-only. */
export const EXPOSED_ENGINES: readonly ExposedToolDefinition[] = [
  // 1. anomaly-detection — score a behavior profile against the recent baseline
  {
    name: 'bos_detect_anomalies',
    description:
      'Score a behavior profile against the recent baseline for an agent. Returns the anomaly score (0..1), whether it crosses the threshold, and the dimensions that deviated.',
    input: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        profile: {
          type: 'object',
          description: 'BehaviorProfile: { traits: Record<string, number>, traitsCount?: number }',
        },
        threshold: { type: 'number', description: 'Anomaly threshold (default 0.3)' },
      },
      required: ['agentId', 'profile'],
    },
    execute: async (input, bos) => {
      const agentId = pickString(input, 'agentId') ?? 'unknown';
      const profile = pickObject(input, 'profile') ?? {};
      const threshold = pickNumber(input, 'threshold') ?? 0.3;
      const engine = bos.getAnomalyDetection();
      engine.recordBehavior(agentId, profile as never);
      const score = engine.scoreAnomaly(agentId, profile as never);
      const isAnomalous = engine.isAnomalous(agentId, profile as never, threshold);
      return { ok: true, agentId, score, isAnomalous, threshold };
    },
  },

  // 2. circuit-breaker-intelligence — failure-pattern-aware threshold recommendation
  {
    name: 'bos_recommend_circuit_breaker',
    description:
      'Recompute circuit-breaker threshold recommendations from observed failure patterns. Returns the current failure patterns and the recommended threshold adjustments.',
    input: {
      type: 'object',
      properties: {},
    },
    execute: async (_input, bos) => {
      const engine = bos.getCircuitBreakerIntelligence();
      const patterns = engine.getFailurePatterns();
      const adjustments = engine.recommendAdjustments();
      return { ok: true, patterns, adjustments };
    },
  },

  // 3. collective-intelligence — competence-weighted collective decision
  {
    name: 'bos_collective_decision',
    description:
      'Run a collective decision over a set of agent votes, weighted by competence and confidence. Returns the outcome, the collective confidence and which votes carried the result. Distinct from bos_resolve_consensus, which uses a flat quorum.',
    input: {
      type: 'object',
      properties: {
        proposal: { type: 'string' },
        votes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agentId: { type: 'string' },
              choice: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
              weight: { type: 'number' },
              confidence: { type: 'number' },
              rationale: { type: 'string' },
            },
          },
        },
        policy: {
          type: 'string',
          enum: ['majority', 'supermajority', 'unanimous'],
          description: 'Voting policy (default majority)',
        },
      },
      required: ['proposal', 'votes'],
    },
    execute: async (input, bos) => {
      const proposal = pickString(input, 'proposal') ?? 'no proposal';
      const votes = pick(input, 'votes');
      const policy = pickString(input, 'policy') ?? 'majority';
      const result = bos
        .getCollectiveIntelligence()
        .vote(
          proposal,
          Array.isArray(votes) ? (votes as never[]) : [],
          policy as 'majority' | 'supermajority' | 'unanimous',
        );
      return { ok: true, result };
    },
  },

  // 4. compliance-mapper — map governance rules to a regulation
  {
    name: 'bos_map_compliance',
    description:
      'Map the active DNA\u2019s governance rules to a regulation (SOC2, HIPAA, ISO27001, GDPR...). Returns the known maps, the target map, and the overall status.',
    input: {
      type: 'object',
      properties: {
        regulation: {
          type: 'string',
          description: 'Regulation name (default "SOC2")',
        },
      },
    },
    execute: async (input, bos) => {
      const regulation = pickString(input, 'regulation') ?? 'SOC2';
      const engine = bos.getComplianceMapper();
      const maps = engine.getAllMaps();
      const target = engine.getComplianceMap(regulation);
      return {
        ok: true,
        regulation,
        map: target ?? null,
        knownMaps: maps.map((m) => m.regulation),
        overall: engine.overallStatus(),
      };
    },
  },

  // 5. confidence-weighted-gate-selector — rank pipeline gates
  {
    name: 'bos_select_gates_by_confidence',
    description:
      'Rank the gates of a pipeline phase by a confidence-weighted score. Use to choose which gates to actually run — the engine drops low-confidence gates to save time.',
    input: {
      type: 'object',
      properties: {
        sourcePhase: { type: 'object', description: 'PipelinePhaseDefinition JSON' },
        targetPhase: { type: 'object', description: 'Optional target PipelinePhaseDefinition' },
        minConfidence: { type: 'number', description: 'Default 0.5' },
      },
      required: ['sourcePhase'],
    },
    execute: async (input, bos) => {
      const sourcePhase = pickObject(input, 'sourcePhase') ?? {};
      const targetPhase = pickObject(input, 'targetPhase');
      const minConfidence = pickNumber(input, 'minConfidence') ?? 0.5;
      const selection = bos
        .getConfidenceWeightedGateSelector()
        .selectGates(
          sourcePhase as PipelinePhaseDefinition,
          (targetPhase ?? null) as PipelinePhaseDefinition | null,
          minConfidence,
        );
      return { ok: true, selection };
    },
  },

  // 6. cross-domain-transfer — transfer rules between two DNAs
  {
    name: 'bos_transfer_across_domains',
    description:
      'Suggest rule transfers between two DNA patterns from *different* domains (e.g. financial-compliance → healthcare-hipaa). Returns the candidate transfers with confidence and a plain-language rationale. Distinct from bos_suggest_cross_dna_transfer, which moves learnings within the *same* DNA lineage.',
    input: {
      type: 'object',
      properties: {
        sourceDna: { type: 'string', description: 'Source DNA pattern key' },
        targetDna: { type: 'string', description: 'Target DNA pattern key' },
      },
      required: ['sourceDna', 'targetDna'],
    },
    execute: async (input, bos) => {
      const sourceKey = pickString(input, 'sourceDna') ?? '';
      const targetKey = pickString(input, 'targetDna') ?? '';
      const engine = bos.getCrossDomainTransfer();
      // The plugin holds the loaded DNA catalogue in a module-scope `Map`.
      // We accept the catalogue as a parameter so this tool stays a thin
      // wrapper over the engine; the caller (the orchestrator) resolves the
      // keys against the patterns it already knows about.
      const catalogue = pick(input, 'catalogue') as Record<string, DNA> | undefined;
      const sourceDna = catalogue?.[sourceKey];
      const targetDna = catalogue?.[targetKey];
      if (!sourceDna || !targetDna) {
        return {
          ok: false,
          error: `one or both DNAs not in the supplied catalogue: source=${sourceKey}, target=${targetKey}`,
        };
      }
      const transfers = engine.suggestTransfers(sourceDna, targetDna);
      const similarity = engine.computeSimilarity(sourceDna, targetDna);
      return { ok: true, similarity, transfers };
    },
  },

  // 7. dynamic-policy — risk-based enforcement thresholds
  {
    name: 'bos_adjust_policy_for_risk',
    description:
      'Assess the risk of an agent context (denial rate, anomaly deviation, tool diversity, off-hours ratio, recent failures) and create a dynamic policy that adjusts enforcement thresholds accordingly. This is the concrete implementation of "context adapted to each task".',
    input: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        factors: {
          type: 'object',
          description:
            'Risk factors: { denialRate, anomalyDeviation, toolDiversity, offHoursRatio, recentFailures } — each 0..1',
        },
      },
      required: ['agentId'],
    },
    execute: async (input, bos) => {
      const agentId = pickString(input, 'agentId') ?? 'unknown';
      const factors = pickObject(input, 'factors') ?? {};
      const baseRuleIds = pickStringArray(input, 'baseRuleIds') ?? [];
      const engine = bos.getDynamicPolicy();
      const assessment = engine.assessRisk(agentId, {
        denialRate: pickNumber(factors, 'denialRate') ?? 0,
        anomalyDeviation: pickNumber(factors, 'anomalyDeviation') ?? 0,
        toolDiversity: pickNumber(factors, 'toolDiversity') ?? 0,
        offHoursRatio: pickNumber(factors, 'offHoursRatio') ?? 0,
        recentFailures: pickNumber(factors, 'recentFailures') ?? 0,
      });
      const policy = engine.createDynamicPolicy(agentId, assessment, baseRuleIds);
      return { ok: true, assessment, policy };
    },
  },

  // 8. explainable-report — plain-language summary for stakeholders
  {
    name: 'bos_explainable_report',
    description:
      'Generate a plain-language report of recent governance activity for a non-technical stakeholder. Summarizes decisions, findings, recommendations and an overall severity.',
    input: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        title: { type: 'string', description: 'Report title (default "governance <agent>")' },
        from: { type: 'string', description: 'ISO start of the window (optional)' },
        to: { type: 'string', description: 'ISO end of the window (optional)' },
      },
    },
    execute: async (input, bos) => {
      const agentId = pickString(input, 'agentId') ?? 'unknown';
      const title = pickString(input, 'title') ?? `governance ${agentId}`;
      const from = pickString(input, 'from') ?? new Date(0).toISOString();
      const to = pickString(input, 'to') ?? new Date().toISOString();
      const decisions = pick(input, 'decisions') ?? [];
      const report = bos
        .getExplainableReport()
        .generateReport(agentId, Array.isArray(decisions) ? (decisions as never[]) : [], from, to);
      return { ok: true, report };
    },
  },

  // 9. external-adapter — SIEM / message-bus exports
  {
    name: 'bos_export_audit_to_siem',
    description:
      'Export the recent governance audit log in a SIEM-friendly format. Returns the exported lines and the count.',
    input: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'SIEM name (recorded in the header)' },
        limit: { type: 'number', description: 'Max entries (default 100)' },
      },
    },
    execute: async (input, bos) => {
      const target = pickString(input, 'target') ?? 'generic-siem';
      const limit = pickNumber(input, 'limit') ?? 100;
      const logLines = bos.getGovernanceLog(limit);
      const result = bos.getExternalSystemAdapter().exportAuditLogs(logLines as never, target);
      return { ok: true, target, count: logLines.length, exported: result };
    },
  },

  // 10. governance-as-code — validate a policy change as a CI-verified diff
  {
    name: 'bos_governance_as_code',
    description:
      'Create a governance policy change request (add/modify/delete a rule) and run the CI-style validation. Returns the change request, the CI status and the error list.',
    input: {
      type: 'object',
      properties: {
        dnaName: { type: 'string' },
        ruleId: { type: 'string' },
        changeType: { type: 'string', enum: ['add', 'modify', 'delete'] },
        proposedRule: {
          type: 'object',
          description: 'For add/modify: the proposed rule JSON',
        },
        rationale: { type: 'string' },
      },
      required: ['dnaName', 'changeType'],
    },
    execute: async (input, bos) => {
      const dnaName = pickString(input, 'dnaName') ?? '';
      const ruleId = pickString(input, 'ruleId') ?? '';
      const changeType = pickString(input, 'changeType') ?? 'add';
      const proposedRule = pickObject(input, 'proposedRule') ?? {};
      const rationale = pickString(input, 'rationale') ?? '';
      const engine = bos.getGovernanceAsCode();
      const request = engine.createChangeRequest(
        dnaName,
        ruleId,
        changeType as never,
        proposedRule as never,
        rationale,
      );
      const ci = engine.runCI(request.id);
      return { ok: true, request, ci };
    },
  },

  // 11. hybrid-evaluation — symbolic verdict + learned confidence
  {
    name: 'bos_evaluate_hybrid',
    description:
      'Re-evaluate a governance action with the hybrid engine: it combines the deterministic symbolic (rule-based) verdict with a learned confidence signal (pattern frequency + impact). Use when you want a second opinion on a rule verdict — the hybrid result flags when the two disagree.',
    input: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action to re-evaluate' },
        agentId: { type: 'string' },
        context: { type: 'object' },
        patternFrequency: { type: 'number', description: '0..1 (default 0.5)' },
        avgImpact: { type: 'number', description: '0..1 (default 0.5)' },
      },
      required: ['action'],
    },
    execute: async (input, bos) => {
      const action = pickString(input, 'action') ?? 'unknown';
      const agentId = pickString(input, 'agentId') ?? 'unknown';
      const context = pickObject(input, 'context') ?? {};
      const patternFrequency = pickNumber(input, 'patternFrequency') ?? 0.5;
      const avgImpact = pickNumber(input, 'avgImpact') ?? 0.5;
      // Run the symbolic evaluation first (this is what the hybrid combines).
      const symbolic = bos.evaluateGovernance(action, {
        agent: agentId,
        context: context as never,
      });
      const hybrid = bos.getHybridEvaluation().evaluate(symbolic, patternFrequency, avgImpact);
      return { ok: true, symbolic, hybrid };
    },
  },
];
