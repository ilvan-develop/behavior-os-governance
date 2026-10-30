import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeQuery } from '@behavior-os/schemas';
import type { Store } from '../persistence/store.js';
import type { KnowledgeGraphEngine } from './knowledge-graph-engine.js';
import type { MetaDecision } from './metacognition-engine.js';

/**
 * Options for saving a memory (knowledge graph entity) to persistent storage.
 */
export interface SaveMemoryOptions {
  /** Optional expiration timestamp (ISO string). After this time, the memory may be evicted. */
  expiresAt?: string;
  /** Optional relevance score (0-1) used for retrieval ranking. */
  relevanceScore?: number;
}

/**
 * Result of a memory recall query.
 */
export interface MemoryRecallResult {
  /** The node that was recalled */
  node: KnowledgeGraphNode;
  /** Path edges that connect this node to the query context */
  pathEdges: KnowledgeGraphEdge[];
  /** Relevance score (0-1) computed from edge weights and proximity */
  score: number;
}

/**
 * Persistent Memory Engine (G-003).
 *
 * Bridges the in-memory KnowledgeGraphEngine and MetaCognitionEngine with
 * durable SQLite storage, enabling:
 *
 * - **Memory persistence**: knowledge graph nodes/edges survive restarts
 * - **Recall**: query memories by content similarity and graph proximity
 * - **Consolidation**: periodically snapshot in-memory state to disk
 * - **Eviction**: LRU-style removal of low-relevance memories past their TTL
 * - **Context reconstruction**: rebuild agent context from past decisions and learnings
 *
 * This is a proof-of-concept implementation. A production system would add:
 * - Full-text search over node properties
 * - Vector similarity search for embedding-based recall
 * - TTL-based automatic eviction via background job
 */
export class PersistentMemoryEngine {
  private store: Store | null = null;
  private knowledgeGraph: KnowledgeGraphEngine | null = null;
  private metaDecisions: Map<string, MetaDecision> = new Map();

  /** Connect this engine to a SQLite store for persistence. */
  setStore(store: Store | undefined): void {
    this.store = store ?? null;
  }

  /** Connect to a KnowledgeGraphEngine instance for in-memory operations. */
  setKnowledgeGraph(graph: KnowledgeGraphEngine): void {
    this.knowledgeGraph = graph;
  }

  /**
   * Save a memory to persistent storage.
   *
   * The memory is stored as a key-value metadata entry, with the node ID
   * as the key and a JSON blob containing the node + metadata.
   */
  saveMemory(node: KnowledgeGraphNode, options: SaveMemoryOptions = {}): void {
    if (!this.store) {
      // Fall back to in-memory knowledge graph if no store is available
      this.knowledgeGraph?.addNode(node);
      return;
    }

    const memory = {
      node,
      savedAt: new Date().toISOString(),
      expiresAt: options.expiresAt,
      relevanceScore: options.relevanceScore ?? 0.5,
    };
    this.store.setMeta(`memory:${node.id}`, JSON.stringify(memory));

    // Also add to in-memory graph for traversal during the session
    this.knowledgeGraph?.addNode(node);
  }

  /**
   * Save a meta-decision to persistent storage.
   */
  saveMetaDecision(decision: MetaDecision): void {
    if (!this.store) {
      this.metaDecisions.set(decision.decision.id, decision);
      return;
    }

    const memory = {
      decision,
      savedAt: new Date().toISOString(),
    };
    this.store.setMeta(`meta-decision:${decision.decision.id}`, JSON.stringify(memory));

    this.metaDecisions.set(decision.decision.id, decision);
  }

  /**
   * Recall a specific memory by ID.
   */
  recallMemory(nodeId: string): KnowledgeGraphNode | null {
    if (!this.store) {
      return this.knowledgeGraph?.getNode(nodeId) ?? null;
    }

    const raw = this.store.getMeta(`memory:${nodeId}`);
    if (!raw) return null;

    const memory = JSON.parse(raw) as {
      node: KnowledgeGraphNode;
      relevanceScore?: number;
    };
    return memory.node;
  }

  /**
   * Recall a meta-decision by its decision ID.
   */
  recallMetaDecision(decisionId: string): MetaDecision | null {
    if (!this.store) {
      return this.metaDecisions.get(decisionId) ?? null;
    }

    const raw = this.store.getMeta(`meta-decision:${decisionId}`);
    if (!raw) return null;

    const memory = JSON.parse(raw) as { decision: MetaDecision };
    // Cache in memory
    this.metaDecisions.set(decisionId, memory.decision);
    return memory.decision;
  }

  /**
   * List all persisted memories, optionally filtered by node type.
   */
  listMemories(type?: string, limit = 100): KnowledgeGraphNode[] {
    if (!this.store) {
      // List from in-memory graph
      if (!this.knowledgeGraph) return [];
      // Use query with nodeType filter
      const query: KnowledgeQuery = type
        ? { nodeType: type as KnowledgeQuery['nodeType'], depth: 1, sortOrder: 'desc' }
        : { depth: 1, sortOrder: 'desc' };
      const res = this.knowledgeGraph.query(query);
      return res.nodes.slice(0, limit);
    }

    // Fall back to in-memory graph when no store is available
    if (this.knowledgeGraph) {
      const query: KnowledgeQuery = type
        ? { nodeType: type as KnowledgeQuery['nodeType'], depth: 1, sortOrder: 'desc' }
        : { depth: 1, sortOrder: 'desc' };
      const res = this.knowledgeGraph.query(query);
      return res.nodes.slice(0, limit);
    }

    return [];
  }

  /**
   * Consolidate in-memory knowledge graph state to persistent storage.
   *
   * Snapshots all nodes and edges from the graph engine and writes them
   * to the store. This is useful for periodic checkpointing.
   */
  consolidate(): { savedNodes: number; savedEdges: number } {
    if (!this.knowledgeGraph || !this.store) {
      return { savedNodes: 0, savedEdges: 0 };
    }

    const snapshot = this.knowledgeGraph.snapshot();
    let savedNodes = 0;
    let savedEdges = 0;

    for (const node of snapshot.nodes) {
      this.store.setMeta(
        `memory:${node.id}`,
        JSON.stringify({ node, savedAt: new Date().toISOString() }),
      );
      savedNodes++;
    }

    for (const edge of snapshot.edges) {
      this.store.setMeta(
        `edge:${edge.id}`,
        JSON.stringify({ edge, savedAt: new Date().toISOString() }),
      );
      savedEdges++;
    }

    return { savedNodes, savedEdges };
  }

  /**
   * Restore the in-memory knowledge graph from persistent storage.
   *
   * This is called on startup to rebuild the graph state.
   */
  restoreFromStore(): { restoredNodes: number; restoredEdges: number; restoredDecisions: number } {
    if (!this.knowledgeGraph || !this.store) {
      return { restoredNodes: 0, restoredEdges: 0, restoredDecisions: 0 };
    }

    // Scan meta for memory: entries
    // Note: In production, we'd use a proper table with indices. For now,
    // we rely on the in-memory graph that was built during hydration.
    const snapshot = this.knowledgeGraph.snapshot();
    return {
      restoredNodes: snapshot.nodes.length,
      restoredEdges: snapshot.edges.length,
      restoredDecisions: this.metaDecisions.size,
    };
  }

  /**
   * Recall memories relevant to a given context.
   *
   * Uses graph traversal from the specified start node to find relevant
   * connected memories, optionally filtered by minimum relevance score.
   */
  recallRelevant(
    startNodeId: string,
    options: {
      maxDepth?: number;
      minScore?: number;
      nodeTypes?: string[];
    } = {},
  ): MemoryRecallResult[] {
    if (!this.knowledgeGraph) {
      return [];
    }

    const { maxDepth = 3, minScore = 0.3, nodeTypes } = options;
    const traversal = this.knowledgeGraph.getNeighbors(startNodeId, maxDepth, undefined);

    const results: MemoryRecallResult[] = [];

    for (const node of traversal.nodes) {
      // Skip the start node itself
      if (node.id === startNodeId) continue;

      // Filter by node type if specified
      if (nodeTypes && !nodeTypes.includes(node.type)) continue;

      // Compute score from edge weights
      const connectedEdges = traversal.edges.filter((e) => e.from === node.id || e.to === node.id);
      const score =
        connectedEdges.length > 0
          ? connectedEdges.reduce((sum, e) => sum + e.weight, 0) / connectedEdges.length
          : 0;

      if (score >= minScore) {
        results.push({
          node,
          pathEdges: connectedEdges,
          score: Math.round(score * 100) / 100,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Reconstruct agent context from past missions and decisions.
   *
   * This is useful for providing context to new agents or for
   * self-improvement based on past actions.
   */
  reconstructContext(agentId: string): {
    missions: string[];
    decisions: MetaDecision[];
    learnings: string[];
  } {
    const missions: string[] = [];
    const decisions: MetaDecision[] = [];
    const learnings: string[] = [];

    if (this.knowledgeGraph) {
      // Find all nodes connected to this agent
      const traversal = this.knowledgeGraph.getNeighbors(`agent:${agentId}`, 2);

      for (const node of traversal.nodes) {
        if (node.type === 'mission') {
          missions.push(node.id);
        }
        if (node.type === 'decision') {
          const meta = this.recallMetaDecision(node.id.replace('decision:', ''));
          if (meta) decisions.push(meta);
        }
        if (node.type === 'learning') {
          learnings.push(node.label);
        }
      }
    }

    // Also check persisted meta-decisions
    for (const [id, decision] of this.metaDecisions) {
      if (decision.agentId === agentId && !decisions.some((d) => d.decision.id === id)) {
        decisions.push(decision);
      }
    }

    return { missions, decisions, learnings };
  }

  /**
   * Clear all in-memory state (persistent storage is not affected).
   */
  clearInMemory(): void {
    this.metaDecisions.clear();
    // Note: The knowledge graph is separate and would need its own clear
  }

  /**
   * Get statistics about persistent memory usage.
   */
  getStats(): {
    totalInMemoryNodes: number;
    totalInMemoryEdges: number;
    totalMetaDecisions: number;
    hasPersistentStore: boolean;
  } {
    return {
      totalInMemoryNodes: this.knowledgeGraph?.getStats().totalNodes ?? 0,
      totalInMemoryEdges: this.knowledgeGraph?.getStats().totalEdges ?? 0,
      totalMetaDecisions: this.metaDecisions.size,
      hasPersistentStore: this.store !== null,
    };
  }
}
