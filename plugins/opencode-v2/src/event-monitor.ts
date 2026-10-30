/**
 * G-019 Integration: Real-time event monitoring.
 *
 * Subscribes to OpenCode V2's event bus via `ctx.event.subscribe()` and
 * feeds governance-relevant events to the Behavior-OS engines:
 * - G-005 TemporalPattern: record behavior events for pattern detection
 * - G-009 AnomalyDetection: record behavior profiles for deviation scoring
 * - G-013 ExperientialLearning: feed tool failure/success into learn loops
 * - G-016 ComplianceMapper: trigger compliance re-checks on DNA changes
 * - G-014 ValueAlignment: score agent decisions against registered values
 * - G-012 CircuitBreaker: capture failure patterns from tool errors
 * - G-004 HybridEvaluation: combined symbolic+neural verdict on permission events
 * - G-017 CounterfactualAudit: forensic what-if replay on denials
 * - G-018 ExplainableReport: stakeholder-facing transparency reports
 * - G-008 MemoryConsolidation: episodic→semantic fact conversion
 * - G-019 ExternalSystemAdapter: SIEM export + external event ingestion
 * - G-015 CollectiveIntelligence: quorum voting on governance disputes
 */
import type { BehaviorOS } from '@behavior-os/core';
import type { BehaviorProfile, DNA, GovernanceDecision } from '@behavior-os/schemas';

/** Event shape from OpenCode V2's event bus (minimal subset we consume). */
export interface GovernanceEvent {
  type: string;
  /** ISO timestamp. */
  timestamp?: string;
  /** Tool invocation events carry: */
  tool?: string;
  action?: string;
  verdict?: string;
  reason?: string;
  error?: string;
  sessionID?: string;
  agentId?: string;
  /** Resource paths involved. */
  resources?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Subscribe to the OpenCode V2 event stream and route events to the
 * appropriate Behavior-OS engines. Returns a cleanup that aborts the
 * subscription on plugin unload.
 *
 * @param ctx - The OpenCode plugin context (needs `event.subscribe`).
 * @param bos - The BehaviorOS facade instance.
 * @param getLoadedDna - Optional callback to look up loaded DNA by name.
 */
export async function subscribeToGovernanceEvents(
  ctx: {
    event?: {
      subscribe: (opts?: { signal?: AbortSignal }) => AsyncIterable<GovernanceEvent>;
    };
  },
  bos: BehaviorOS,
  getLoadedDna?: (name: string) => DNA | undefined,
): Promise<() => void> {
  if (!ctx.event?.subscribe) {
    console.warn('[Behavior-OS] ctx.event.subscribe not available; real-time monitoring disabled');
    return () => {};
  }

  const controller = new AbortController();
  const { subscribe } = ctx.event;

  void (async () => {
    try {
      for await (const event of subscribe({ signal: controller.signal })) {
        try {
          await routeEvent(bos, event, getLoadedDna);
        } catch (error) {
          console.warn(
            `[Behavior-OS] Event routing error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn(
        `[Behavior-OS] Event subscription error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();

  return () => controller.abort();
}

/** Route a single governance event to the relevant engines. */
async function routeEvent(
  bos: BehaviorOS,
  event: GovernanceEvent,
  getLoadedDna?: (name: string) => DNA | undefined,
): Promise<void> {
  const now = Date.now();
  const agentId = bos.resolveAgentIdentity().agentId ?? 'unknown';

  // --- Tool call events → Temporal Pattern + Anomaly Detection + External Adapter --
  if (event.type === 'session.tool.called') {
    const toolName = event.tool ?? 'unknown';

    // Record for temporal pattern analysis
    bos.getTemporalPattern().recordEvent({
      id: `${event.sessionID ?? 'unknown'}:${toolName}:${now}`,
      agentId,
      ruleId: toolName,
      verdict: event.verdict === 'deny' ? 'deny' : 'allow',
      timestamp: now,
    });

    // Update anomaly detection baseline
    const profile: BehaviorProfile = {
      actionRate: 1.0,
      denialRate: event.verdict === 'deny' ? 1.0 : 0,
      escalationRate: event.verdict === 'escalate' ? 1.0 : 0,
      toolDiversity: 1,
      offHoursRatio: isOffHours(event.timestamp) ? 1.0 : 0,
    };
    bos.getAnomalyDetection().recordBehavior(agentId, profile);

    // Forward event to external systems (SIEM / event bus)
    bos.getExternalSystemAdapter().receiveEvent({
      type: 'tool.called',
      source: 'opencode-v2-plugin',
      payload: { tool: toolName, verdict: event.verdict, sessionID: event.sessionID, agentId },
    });

    return;
  }

  // --- Tool failure events → Circuit Breaker + Experiential Learning + Memory Consolidation ---
  if (event.type === 'session.tool.failed') {
    const toolName = event.tool ?? 'unknown';

    bos
      .getCircuitBreakerIntelligence()
      .recordFailure(toolName, event.error ?? 'unknown error', 'default-breaker', now);

    // Feed experiential learning
    const expEngine = bos.getExperientialLearning();
    const active = expEngine.getActive();
    if (active.length === 0) {
      const record = expEngine.start(agentId, toolName);
      expEngine.observe(record.id, 'failure', event.error ?? 'Tool failed');
      expEngine.reflect(
        record.id,
        `Tool ${toolName} failed unexpectedly. Consider adjusting governance rules.`,
      );
      expEngine.abstract(
        record.id,
        `Repeated failures of ${toolName} suggest a systemic issue or policy misalignment.`,
        0.7,
      );
      expEngine.apply(
        record.id,
        `Added monitoring for ${toolName} failures via CircuitBreakerIntelligence.`,
      );
    }

    // Consolidate the failure into a semantic fact for long-term memory
    const episode = {
      id: `ep-${now}-${toolName}`,
      action: toolName,
      verdict: 'deny',
      timestamp: now,
      reason: event.error,
    };
    bos.getMemoryConsolidation().consolidate([episode]);

    // Forward failure to external systems
    bos.getExternalSystemAdapter().receiveEvent({
      type: 'tool.failed',
      source: 'opencode-v2-plugin',
      payload: { tool: toolName, error: event.error, sessionID: event.sessionID, agentId },
    });

    return;
  }

  // --- Permission decision events → Dynamic Policy + Value Alignment + Hybrid Evaluation ---
  if (event.type === 'session.permission.requested') {
    // Risk assessment for dynamic policy
    bos.getDynamicPolicy().assessRisk(agentId, {
      denialRate: event.verdict === 'deny' ? 0.8 : 0,
      anomalyDeviation: 0.1,
      toolDiversity: 1,
      offHoursRatio: isOffHours(event.timestamp) ? 0.5 : 0,
      recentFailures: 0,
    });

    // Value alignment check
    const values = bos.getValueAlignment().getValues();
    if (values.length > 0) {
      bos.getValueAlignment().assessAlignment(
        agentId,
        [
          {
            action: event.action ?? 'unknown',
            verdict: event.verdict ?? 'allow',
            reason: event.reason,
          },
        ],
        [],
      );
    }

    // Build a GovernanceDecision for hybrid + counterfactual analysis
    const decision: GovernanceDecision = {
      id: `dec-${now}-${event.action ?? 'unknown'}`,
      action: event.action ?? 'unknown',
      agentId,
      verdict: (event.verdict ?? 'allow') as GovernanceDecision['verdict'],
      reason: event.reason ?? 'no reason recorded',
      rulesEvaluated: [],
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    // Hybrid evaluation: combine symbolic verdict with neural confidence
    const baselines = bos.getAnomalyDetection().getBaseline(agentId);
    const confidence = baselines.length > 0 ? 0.7 : 0.5;
    bos.getHybridEvaluation().evaluate(decision, 1.0, confidence);

    // Counterfactual audit: if denied, check whether removing a rule would change the verdict
    if (event.verdict === 'deny' || event.verdict === 'escalate') {
      const rules = bos.getDNA()?.governance ?? [];
      if (rules.length > 0) {
        const firstRule = rules[0];
        if (firstRule?.id) {
          bos.getCounterfactualAudit().wasRuleLoadBearing(decision, firstRule.id, rules, (rs) => {
            const matched = rs.some((r) => r.action === event.action);
            return matched ? 'deny' : 'allow';
          });
        }
      }
    }

    // Explainable report: generate a stakeholder-facing summary for the decision
    bos
      .getExplainableReport()
      .generateReport(agentId, [decision], event.timestamp ?? '', event.timestamp ?? '');

    // Collective intelligence: record denials for quorum voting on policy disputes
    if (event.verdict === 'deny' || event.verdict === 'escalate') {
      bos
        .getCollectiveIntelligence()
        .vote(
          `policy-review:${event.action ?? 'unknown'}`,
          [{ agentId, choice: 'reject', weight: 1, confidence: 0.8 }],
          'majority',
        );
    }

    // Forward to external systems
    bos.getExternalSystemAdapter().receiveEvent({
      type: 'permission.requested',
      source: 'opencode-v2-plugin',
      payload: {
        action: event.action,
        verdict: event.verdict,
        reason: event.reason,
        sessionID: event.sessionID,
        agentId,
      },
    });

    return;
  }

  // --- DNA change events → Compliance re-check ---
  if (event.type === 'bos.dna.selected' || event.type === 'bos.dna.changed') {
    if (!getLoadedDna) return;
    const dnaName = bos.getState().selectedDna;
    if (!dnaName) return;
    const dna = getLoadedDna(dnaName);
    if (!dna?.governance) return;
    const maps = bos.getComplianceMapper().mapRules(dna.governance);
    for (const map of maps) bos.getComplianceMapper().setComplianceMap(map);
  }
}

function isOffHours(timestamp?: string): boolean {
  if (!timestamp) return false;
  const hour = new Date(timestamp).getHours();
  // Off-hours: 22:00–06:00
  return hour >= 22 || hour < 6;
}
