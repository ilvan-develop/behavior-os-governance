import { BehaviorOS } from '@behavior-os/core';
import { describe, expect, it } from 'vitest';
import { recordLearningInGraph } from '../src/learning-graph.js';

// Option C: every recorded learning becomes a knowledge-graph node connected
// to its mission. These tests pin the node/edge shape and the idempotency so
// the "contextual memory" the orchestrator consults is not silently lost.

function freshBos(): BehaviorOS {
  return new BehaviorOS({ persistence: undefined });
}

describe('recordLearningInGraph', () => {
  it('adds a learning node keyed by the event id', () => {
    const bos = freshBos();
    const result = recordLearningInGraph(bos, 'evt-1', {
      label: 'short label',
      type: 'insight',
      impact: 'high',
    });
    expect(result.node).toBe('learn:evt-1');
    const node = bos.getKnowledgeGraph().getNode('learn:evt-1');
    expect(node?.type).toBe('learning');
    expect(node?.label).toBe('short label');
    expect(node?.properties).toMatchObject({
      eventType: 'insight',
      impact: 'high',
      originId: 'evt-1',
    });
  });

  it('links the learning to its mission with EVIDENCE_FOR and PART_OF', () => {
    const bos = freshBos();
    const result = recordLearningInGraph(bos, 'evt-2', {
      label: 'linked',
      type: 'fix',
      relatedMission: 'mission-9',
    });
    expect(result.edges).toHaveLength(2);
    const graph = bos.getKnowledgeGraph();
    expect(graph.getNode('learn:evt-2')?.type).toBe('learning');
    expect(graph.getNode('mission:mission-9')?.type).toBe('mission');
    // The edges point learning -> mission, so inspect the incoming edges
    // directly: the strongest assertion that both relationships exist.
    const incoming = graph.getIncomingEdges('mission:mission-9');
    const edgeTypes = incoming.map((edge) => edge.type).sort();
    expect(edgeTypes).toEqual(['EVIDENCE_FOR', 'PART_OF']);
    expect(incoming.every((edge) => edge.from === 'learn:evt-2')).toBe(true);
  });

  it('is idempotent for the same event (no duplicate nodes)', () => {
    const bos = freshBos();
    recordLearningInGraph(bos, 'evt-3', { label: 'first', type: 'insight', relatedMission: 'm-1' });
    recordLearningInGraph(bos, 'evt-3', { label: 'first', type: 'insight', relatedMission: 'm-1' });
    const graph = bos.getKnowledgeGraph();
    expect(graph.getNode('learn:evt-3')?.label).toBe('first');
    // Same-id edges overwrite, so the edge count stays bounded: exactly one
    // EVIDENCE_FOR and one PART_OF edge to the mission.
    const stats = graph.getStats();
    expect(stats.totalEdges).toBe(2);
    expect(stats.edgesByType.EVIDENCE_FOR).toBe(1);
    expect(stats.edgesByType.PART_OF).toBe(1);
  });
});
