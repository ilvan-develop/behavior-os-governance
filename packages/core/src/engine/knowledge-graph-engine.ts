import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeQuery,
  KnowledgeResult,
} from '@behavior-os/schemas';

/**
 * In-memory knowledge graph for Behavior-OS.
 *
 * Provides structured relationships between entities (agents, missions, rules,
 * learnings, decisions) to enable:
 * - Traversal-based queries (find all missions governed by a rule)
 * - Pattern detection (detect recurring cause-effect chains)
 * - Inference (derive new relationships from existing ones)
 * - Explainability (trace decision reasoning paths)
 *
 * This is a proof-of-concept implementation (G-001). Production would use a
 * proper graph database (Neo4j, JanusGraph) or at minimum a SQLite-backed
 * adjacency list with full-text search.
 */
export class KnowledgeGraphEngine {
  private nodes = new Map<string, KnowledgeGraphNode>();
  private edges = new Map<string, KnowledgeGraphEdge>();

  /** Create a new node in the graph. */
  addNode(node: KnowledgeGraphNode): void {
    node.updatedAt = new Date().toISOString();
    this.nodes.set(node.id, node);
  }

  /** Remove a node and all its edges. */
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    // Remove edges connected to this node
    for (const [edgeId, edge] of this.edges) {
      if (edge.from === nodeId || edge.to === nodeId) {
        this.edges.delete(edgeId);
      }
    }
  }

  /** Create a new edge in the graph. */
  addEdge(edge: KnowledgeGraphEdge): void {
    this.edges.set(edge.id, edge);
    // Update node updatedAt timestamps
    const fromNode = this.nodes.get(edge.from);
    const toNode = this.nodes.get(edge.to);
    if (fromNode) fromNode.updatedAt = new Date().toISOString();
    if (toNode) toNode.updatedAt = new Date().toISOString();
  }

  /** Remove an edge. */
  removeEdge(edgeId: string): void {
    this.edges.delete(edgeId);
  }

  /** Get a node by ID. */
  getNode(nodeId: string): KnowledgeGraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  /** Get all edges from a node. */
  getOutgoingEdges(nodeId: string): KnowledgeGraphEdge[] {
    return [...this.edges.values()].filter((e) => e.from === nodeId);
  }

  /** Get all edges to a node. */
  getIncomingEdges(nodeId: string): KnowledgeGraphEdge[] {
    return [...this.edges.values()].filter((e) => e.to === nodeId);
  }

  /** Get all neighbors (incoming + outgoing) within specified depth. */
  getNeighbors(
    startNodeId: string,
    maxDepth = 3,
    edgeTypes?: string[],
  ): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[]; path: string[] } {
    const visitedNodes = new Set<string>();
    const visitedEdges = new Set<string>();
    const resultNodes: KnowledgeGraphNode[] = [];
    const resultEdges: KnowledgeGraphEdge[] = [];
    const path: string[] = [startNodeId];

    const queue: Array<{ nodeId: string; depth: number; path: string[] }> = [
      { nodeId: startNodeId, depth: 0, path: [startNodeId] },
    ];
    visitedNodes.add(startNodeId);

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { nodeId, depth, path: currentPath } = item;
      const node = this.nodes.get(nodeId);
      if (node) {
        resultNodes.push(node);
      }

      if (depth >= maxDepth) continue;

      // Get outgoing edges
      const outgoing = this.getOutgoingEdges(nodeId);
      for (const edge of outgoing) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);
        resultEdges.push(edge);

        const targetNode = this.nodes.get(edge.to);
        if (targetNode && !visitedNodes.has(edge.to)) {
          visitedNodes.add(edge.to);
          resultNodes.push(targetNode);
          queue.push({
            nodeId: edge.to,
            depth: depth + 1,
            path: [...currentPath, edge.to],
          });
        }
      }

      // Get incoming edges (reverse traversal)
      const incoming = this.getIncomingEdges(nodeId);
      for (const edge of incoming) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (visitedEdges.has(edge.id)) continue;
        visitedEdges.add(edge.id);
        resultEdges.push(edge);

        const sourceNode = this.nodes.get(edge.from);
        if (sourceNode && !visitedNodes.has(edge.from)) {
          visitedNodes.add(edge.from);
          resultNodes.push(sourceNode);
          queue.push({
            nodeId: edge.from,
            depth: depth + 1,
            path: [...currentPath, edge.from],
          });
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges, path };
  }

  /**
   * Execute a knowledge query against the graph.
   *
   * Supports:
   * - Node filtering by type and properties
   * - Edge filtering by type
   * - Depth-limited traversal
   * - Sorting by various criteria
   */
  query(query: KnowledgeQuery): KnowledgeResult {
    const startedAt = Date.now();

    let resultNodes: KnowledgeGraphNode[] = [];
    let resultEdges: KnowledgeGraphEdge[] = [];

    // If startNode specified, do traversal
    if (query.startNode) {
      const traversal = this.getNeighbors(
        query.startNode,
        query.depth,
        query.edgeType !== 'any' ? [query.edgeType as string] : undefined,
      );
      resultNodes = traversal.nodes;
      resultEdges = traversal.edges;
    } else {
      // Otherwise, filter all nodes
      for (const node of this.nodes.values()) {
        if (query.nodeType && query.nodeType !== 'any' && node.type !== query.nodeType) continue;
        if (query.properties) {
          let matches = true;
          for (const [key, value] of Object.entries(query.properties)) {
            if (node.properties[key] !== value) {
              matches = false;
              break;
            }
          }
          if (!matches) continue;
        }
        resultNodes.push(node);
      }

      // Filter edges based on node results
      const nodeIds = new Set(resultNodes.map((n) => n.id));
      resultEdges = [...this.edges.values()].filter(
        (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
      );
      if (query.edgeType && query.edgeType !== 'any') {
        resultEdges = resultEdges.filter((e) => e.type === query.edgeType);
      }
    }

    // Sort results
    if (query.sortBy) {
      resultNodes.sort((a, b) => {
        const aVal = a.createdAt > b.createdAt ? 1 : a.createdAt < b.createdAt ? -1 : 0;
        const multiplier = query.sortOrder === 'desc' ? -1 : 1;
        return multiplier * aVal;
      });
    }

    // Generate inferences
    const inferences = this.generateInferences(resultNodes, resultEdges);

    return {
      nodes: resultNodes,
      edges: resultEdges,
      inferences,
      totalNodes: resultNodes.length,
      totalEdges: resultEdges.length,
      queryTimeMs: Date.now() - startedAt,
    };
  }

  /**
   * Generate inferences from the graph.
   *
   * Rules:
   * - If A CAUSES B and B CAUSES C, infer A CAUSES C (transitivity)
   * - If A GOVERNED_BY R1 and A GOVERNED_BY R2, infer R1 SIMILAR_TO R2
   * - If multiple agents share the same mission, infer they COLLABORATE
   */
  generateInferences(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]): string[] {
    const inferences: string[] = [];

    // Build adjacency for transitivity check
    const causesMap = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.type === 'CAUSES') {
        const targets = causesMap.get(edge.from) ?? [];
        targets.push(edge.to);
        causesMap.set(edge.from, targets);
      }
    }

    // Transitive causality inference
    for (const [source, intermediate] of causesMap) {
      for (const mid of intermediate) {
        const furtherTargets = causesMap.get(mid) ?? [];
        for (const target of furtherTargets) {
          if (!intermediate.includes(target)) {
            inferences.push(`Transitive inference: ${source} → ${mid} → ${target}`);
          }
        }
      }
    }

    // Rule similarity inference
    const _ruleNodes = nodes.filter((n) => n.type === 'rule');
    const missionRuleMap = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.type === 'GOVERNED_BY') {
        const missions = missionRuleMap.get(edge.from) ?? [];
        missions.push(edge.to);
        missionRuleMap.set(edge.from, missions);
      }
    }
    for (const [, rules] of missionRuleMap) {
      if (rules.length > 1) {
        inferences.push(`Rules ${rules.slice(0, 3).join(', ')} are commonly applied together`);
      }
    }

    // Agent collaboration inference
    const agentMissionMap = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.type === 'PART_OF') {
        const missions = agentMissionMap.get(edge.from) ?? [];
        missions.push(edge.to);
        agentMissionMap.set(edge.from, missions);
      }
    }
    for (const [agentId, missions] of agentMissionMap) {
      if (missions.length > 2) {
        inferences.push(`Agent ${agentId} has participated in ${missions.length} missions`);
      }
    }

    return inferences;
  }

  /**
   * Build graph from existing Behavior-OS state.
   *
   * This is used for initialization/population from missions, learnings, etc.
   */
  populateFromState(options: {
    agents?: Array<{ id: string; name: string; type: string; dnaPattern?: string }>;
    missions?: Array<{
      id: string;
      title: string;
      type: string;
      status: string;
      dnaPattern?: string;
    }>;
    rules?: Array<{ id: string; level: string; action: string }>;
    learnings?: Array<{ id: string; type: string; source: string; content: string }>;
    decisions?: Array<{ id: string; subject: string; outcome: string }>;
  }): void {
    // Add agent nodes
    if (options.agents) {
      for (const agent of options.agents) {
        this.addNode({
          id: `agent:${agent.id}`,
          type: 'agent',
          label: agent.name,
          properties: { originalId: agent.id, agentType: agent.type },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Add mission nodes
    if (options.missions) {
      for (const mission of options.missions) {
        this.addNode({
          id: `mission:${mission.id}`,
          type: 'mission',
          label: mission.title,
          properties: { originalId: mission.id, missionType: mission.type, status: mission.status },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Add rule nodes
    if (options.rules) {
      for (const rule of options.rules) {
        this.addNode({
          id: `rule:${rule.id}`,
          type: 'rule',
          label: rule.id,
          properties: { level: rule.level, action: rule.action },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Add learning nodes
    if (options.learnings) {
      for (const learning of options.learnings) {
        this.addNode({
          id: `learning:${learning.id}`,
          type: 'learning',
          label: learning.type,
          properties: { source: learning.source },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Add decision nodes
    if (options.decisions) {
      for (const decision of options.decisions) {
        this.addNode({
          id: `decision:${decision.id}`,
          type: 'decision',
          label: decision.subject,
          properties: { outcome: decision.outcome },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  /** Snapshot all nodes and edges for persistence. */
  snapshot(): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  /** Restore graph from snapshot. */
  restore(data: { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }): void {
    this.nodes.clear();
    this.edges.clear();
    for (const node of data.nodes) {
      this.nodes.set(node.id, node);
    }
    for (const edge of data.edges) {
      this.edges.set(edge.id, edge);
    }
  }

  /** Get statistics about the graph. */
  getStats(): {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
    averageDegree: number;
  } {
    const nodesByType: Record<string, number> = {};
    const edgesByType: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    }
    for (const edge of this.edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    }

    // Calculate average degree
    const totalDegree = [...this.nodes.values()].reduce((sum, node) => {
      return sum + this.getOutgoingEdges(node.id).length + this.getIncomingEdges(node.id).length;
    }, 0);
    const averageDegree = this.nodes.size > 0 ? totalDegree / this.nodes.size : 0;

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      nodesByType,
      edgesByType,
      averageDegree,
    };
  }
}
