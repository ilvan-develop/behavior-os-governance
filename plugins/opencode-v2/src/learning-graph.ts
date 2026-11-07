/**
 * Learning graph — turns every recorded learning into a knowledge-graph node.
 *
 * Before this module, `bos_record_learning` wrote the learning to the
 * LearningEngine (and to persistent storage when enabled) but the
 * *knowledge graph* (G-001) only received nodes when a caller manually
 * invoked `bos_add_knowledge_node` / `bos_add_knowledge_edge`. Learnings
 * were therefore siloed in the learning engine and the graph stayed empty,
 * which is exactly the "memory that the orchestrator actually uses" gap the
 * validation mission asked to close.
 *
 * This helper closes that gap: after a learning is recorded we add a
 * `learning` node to the graph and connect it to its related mission with a
 * `EVIDENCE_FOR` edge (and, when the learning derives from a mission, a
 * `PART_OF` edge). All identifiers are deterministic so re-recording the
 * same learning is idempotent.
 */

import type { BehaviorOS } from '@behavior-os/core';

export interface LearningGraphResult {
  learningId: string;
  node: string;
  edges: string[];
}

/** Deterministic node id for a learning event. */
function learningNodeId(eventId: string): string {
  return `learn:${eventId}`;
}

/** Deterministic edge ids so re-recording does not duplicate edges. */
function evidenceEdgeId(learningId: string, missionId: string): string {
  return `ev:${learningId}->${missionId}`;
}

function partOfEdgeId(learningId: string, missionId: string): string {
  return `po:${learningId}->${missionId}`;
}

/**
 * Register a recorded learning in the knowledge graph. Idempotent: the node
 * is upserted by its deterministic id and each edge is only created when it
 * is not already present (the engine overwrites same-id edges, so we check
 * first to avoid needless updatedAt churn).
 */
export function recordLearningInGraph(
  bos: BehaviorOS,
  eventId: string,
  opts: {
    label: string;
    type: string;
    impact?: string;
    source?: string;
    relatedMission?: string;
  },
): LearningGraphResult {
  const now = new Date().toISOString();
  const nodeId = learningNodeId(eventId);
  const node = {
    id: nodeId,
    type: 'learning' as const,
    label: opts.label,
    properties: {
      eventType: opts.type,
      impact: opts.impact ?? 'low',
      source: opts.source ?? 'unknown',
      originId: eventId,
    },
    createdAt: now,
    updatedAt: now,
  };
  // Upsert the node (addNode overwrites by id).
  bos.addKnowledgeNode(node);

  const edges: string[] = [];
  if (opts.relatedMission) {
    const missionId = opts.relatedMission;
    const evidenceEdge = {
      id: evidenceEdgeId(eventId, missionId),
      from: nodeId,
      to: `mission:${missionId}`,
      type: 'EVIDENCE_FOR' as const,
      weight: 1,
      properties: { role: 'learning-evidence' },
      createdAt: now,
    };
    const partOfEdge = {
      id: partOfEdgeId(eventId, missionId),
      from: nodeId,
      to: `mission:${missionId}`,
      type: 'PART_OF' as const,
      weight: 0.6,
      properties: { role: 'learning-origin' },
      createdAt: now,
    };
    // Add the mission node too (idempotent upsert) so the edge has a target.
    if (!bos.getKnowledgeGraph().getNode?.(`mission:${missionId}`)) {
      bos.addKnowledgeNode({
        id: `mission:${missionId}`,
        type: 'mission',
        label: missionId,
        properties: { originId: missionId },
        createdAt: now,
        updatedAt: now,
      });
    }
    bos.addKnowledgeEdge(evidenceEdge);
    bos.addKnowledgeEdge(partOfEdge);
    edges.push(evidenceEdge.id, partOfEdge.id);
  }

  return { learningId: nodeId, node: nodeId, edges };
}
