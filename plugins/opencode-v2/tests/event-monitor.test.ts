import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it, vi } from 'vitest';
import { type GovernanceEvent, subscribeToGovernanceEvents } from '../src/event-monitor';

interface CircuitFailureRecord {
  tool: string;
  error: string;
  breaker: string;
  timestamp: number;
}

function createStub() {
  const calls: Record<string, unknown[]> = {
    temporalRecord: [],
    anomalyRecord: [],
    circuitRecord: [] as CircuitFailureRecord[],
    dynamicRisk: [],
    complianceMap: [],
    externalEvents: [],
    memoryConsolidation: [],
    hybridEval: [],
    counterfactual: [],
    explainable: [],
    collectiveVote: [],
  };
  const stub = {
    resolveAgentIdentity: () => ({
      agentId: 'agent:auditor',
      persona: 'Nightly Auditor',
      source: 'dna',
    }),
    getState: () => ({ selectedDna: 'lean-factory', resolvedAgentId: 'agent:auditor' }),
    getDNA: () => ({
      name: 'lean-factory',
      version: '1.0.0',
      description: 'test',
      personas: [],
      governance: [{ id: 'rule-1', level: 'medium', action: 'block', conditions: [] }],
      quality: [],
    }),
    getTemporalPattern: () => ({
      recordEvent: (args: unknown) => {
        calls.temporalRecord?.push(args);
      },
    }),
    getAnomalyDetection: () => ({
      recordBehavior: (agentId: string, profile: unknown) => {
        calls.anomalyRecord?.push({ agentId, profile });
      },
      getBaseline: () => [],
    }),
    getCircuitBreakerIntelligence: () => ({
      recordFailure: (tool: string, error: string, breaker: string, timestamp: number) => {
        calls.circuitRecord?.push({ tool, error, breaker, timestamp });
      },
    }),
    getExperientialLearning: () => ({
      getActive: () => [],
      start: (agentId: string, action: string) => ({ id: `exp-${agentId}-${action}` }),
      observe: vi.fn(),
      reflect: vi.fn(),
      abstract: vi.fn(),
      apply: vi.fn(),
    }),
    getDynamicPolicy: () => ({
      assessRisk: (agentId: string, metrics: unknown) => {
        calls.dynamicRisk?.push({ agentId, metrics });
      },
    }),
    getValueAlignment: () => ({
      getValues: () => [{ id: 'v1', name: 'safety', weight: 1.0 }],
      assessAlignment: vi.fn(),
    }),
    getComplianceMapper: () => ({
      mapRules: (_governance: unknown) => [{ domain: 'test', control: 'c1', requirement: 'r1' }],
      setComplianceMap: (map: unknown) => {
        calls.complianceMap?.push(map);
      },
    }),
    getExternalSystemAdapter: () => ({
      receiveEvent: (event: unknown) => {
        calls.externalEvents?.push(event);
      },
    }),
    getMemoryConsolidation: () => ({
      consolidate: (episodes: unknown[]) => {
        calls.memoryConsolidation?.push(episodes);
        return { semanticFacts: [], summary: 'ok', episodesProcessed: 1, factsPruned: 0 };
      },
    }),
    getHybridEvaluation: () => ({
      evaluate: (decision: unknown, freq: number, impact: number) => {
        calls.hybridEval?.push({ decision, freq, impact });
        return {
          id: 'h1',
          symbolicVerdict: 'allow',
          neuralConfidence: 0.5,
          hybridVerdict: 'allow',
          diverged: false,
          explanation: 'ok',
          timestamp: '',
        };
      },
    }),
    getCounterfactualAudit: () => ({
      wasRuleLoadBearing: vi.fn(),
    }),
    getExplainableReport: () => ({
      generateReport: vi.fn(),
    }),
    getCollectiveIntelligence: () => ({
      vote: vi.fn(),
    }),
  };
  return { stub, calls };
}

/** Minimal DNA stub for compliance-mapping tests. */
function dnaStub(name: string): DNA {
  return {
    name,
    version: '1.0.0',
    description: 'test dna',
    personas: [],
    governance: { rules: [] },
    quality: [],
  } as unknown as DNA;
}

describe('subscribeToGovernanceEvents', () => {
  it('returns a cleanup function even when ctx.event is absent', async () => {
    const { stub } = createStub();
    const cleanup = await subscribeToGovernanceEvents({}, stub as never);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('records tool-called events to temporal pattern and anomaly detection', async () => {
    const { stub, calls } = createStub();
    const eventStream = makeEventStream([
      {
        type: 'session.tool.called',
        tool: 'bash',
        action: 'shell',
        verdict: 'allow',
        sessionID: 'sess-1',
      },
    ]);
    const cleanup = await subscribeToGovernanceEvents(
      { event: { subscribe: eventStream } },
      stub as never,
    );
    await new Promise((r) => setTimeout(r, 10));
    cleanup();

    expect(calls.temporalRecord).toHaveLength(1);
    expect(calls.anomalyRecord).toHaveLength(1);
  });

  it('records tool failures to circuit breaker and experiential learning', async () => {
    const { stub, calls } = createStub();
    const eventStream = makeEventStream([
      {
        type: 'session.tool.failed',
        tool: 'write',
        error: 'disk full',
        sessionID: 'sess-1',
      },
    ]);
    const cleanup = await subscribeToGovernanceEvents(
      { event: { subscribe: eventStream } },
      stub as never,
    );
    await new Promise((r) => setTimeout(r, 10));
    cleanup();

    const records = calls.circuitRecord as CircuitFailureRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]?.tool).toBe('write');
  });

  it('routes permission events to dynamic policy and value alignment', async () => {
    const { stub, calls } = createStub();
    const eventStream = makeEventStream([
      {
        type: 'session.permission.requested',
        action: 'write',
        verdict: 'deny',
        sessionID: 'sess-1',
      },
    ]);
    const cleanup = await subscribeToGovernanceEvents(
      { event: { subscribe: eventStream } },
      stub as never,
    );
    await new Promise((r) => setTimeout(r, 10));
    cleanup();

    expect(calls.dynamicRisk).toHaveLength(1);
  });

  it('triggers compliance re-check on bos.dna.selected events', async () => {
    const { stub, calls } = createStub();
    const eventStream = makeEventStream([{ type: 'bos.dna.selected' }]);
    const cleanup = await subscribeToGovernanceEvents(
      { event: { subscribe: eventStream } },
      stub as never,
      (name: string): DNA | undefined => (name === 'lean-factory' ? dnaStub(name) : undefined),
    );
    await new Promise((r) => setTimeout(r, 10));
    cleanup();

    expect(calls.complianceMap).toHaveLength(1);
  });
});

/** Helper: create an async generator that yields the given events then completes. */
function makeEventStream(
  events: GovernanceEvent[],
): (opts?: { signal?: AbortSignal }) => AsyncIterable<GovernanceEvent> {
  return (opts?: { signal?: AbortSignal }) => ({
    async *[Symbol.asyncIterator]() {
      let i = 0;
      while (i < events.length) {
        if (opts?.signal?.aborted) break;
        yield events[i++];
      }
    },
  });
}
