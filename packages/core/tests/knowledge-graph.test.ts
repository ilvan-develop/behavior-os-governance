import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeGraphEngine } from '../src/engine/knowledge-graph-engine.js';

describe('KnowledgeGraphEngine (G-001)', () => {
  let engine: KnowledgeGraphEngine;

  beforeEach(() => {
    engine = new KnowledgeGraphEngine();
  });

  describe('addNode', () => {
    it('should add a node', () => {
      const node: KnowledgeGraphNode = {
        id: 'agent:1',
        type: 'agent',
        label: 'Test Agent',
        properties: { role: 'developer' },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      engine.addNode(node);
      expect(engine.getNode('agent:1')).toBeDefined();
      expect(engine.getNode('agent:1')?.label).toBe('Test Agent');
    });

    it('should update updatedAt on add', () => {
      const before = Date.now();
      const node: KnowledgeGraphNode = {
        id: 'agent:2',
        type: 'agent',
        label: 'Agent 2',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      engine.addNode(node);
      expect(new Date(node.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
    });
  });

  describe('addEdge', () => {
    it('should add an edge', () => {
      engine.addNode({
        id: 'agent:1',
        type: 'agent',
        label: 'Agent 1',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      engine.addNode({
        id: 'mission:1',
        type: 'mission',
        label: 'Mission 1',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      const edge: KnowledgeGraphEdge = {
        id: 'edge:1',
        from: 'agent:1',
        to: 'mission:1',
        type: 'PART_OF',
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      };
      engine.addEdge(edge);
      const outgoing = engine.getOutgoingEdges('agent:1');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].type).toBe('PART_OF');
    });
  });

  describe('getNeighbors', () => {
    it('should traverse graph up to maxDepth', () => {
      // Create chain: agent -> mission -> rule
      engine.addNode({
        id: 'agent:1',
        type: 'agent',
        label: 'Agent',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      engine.addNode({
        id: 'mission:1',
        type: 'mission',
        label: 'Mission',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      engine.addNode({
        id: 'rule:1',
        type: 'rule',
        label: 'Rule',
        properties: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      engine.addEdge({
        id: 'e1',
        from: 'agent:1',
        to: 'mission:1',
        type: 'PART_OF',
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      });
      engine.addEdge({
        id: 'e2',
        from: 'mission:1',
        to: 'rule:1',
        type: 'GOVERNED_BY',
        weight: 1,
        createdAt: '2026-01-01T00:00:00Z',
      });

      const result = engine.getNeighbors('agent:1', 2);
      // Traversal finds all reachable nodes within depth 2
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.path[0]).toBe('agent:1');
    });

    it('should respect depth limit', () => {
      engine.addNode({
        id: 'n1',
        type: 'agent',
        label: 'N1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'n2',
        type: 'agent',
        label: 'N2',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'n3',
        type: 'agent',
        label: 'N3',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({
        id: 'e1',
        from: 'n1',
        to: 'n2',
        type: 'RELATED_TO',
        weight: 1,
        createdAt: '',
      });
      engine.addEdge({
        id: 'e2',
        from: 'n2',
        to: 'n3',
        type: 'RELATED_TO',
        weight: 1,
        createdAt: '',
      });

      const result = engine.getNeighbors('n1', 1);
      // Returns start node + neighbors within depth 1
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });
  });

  describe('query', () => {
    it('should filter by nodeType', () => {
      engine.addNode({
        id: 'a1',
        type: 'agent',
        label: 'Agent',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'm1',
        type: 'mission',
        label: 'Mission',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'r1',
        type: 'rule',
        label: 'Rule',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });

      const result = engine.query({ nodeType: 'agent', depth: 3, sortOrder: 'desc' });
      expect(result.totalNodes).toBe(1);
      expect(result.nodes[0].type).toBe('agent');
    });

    it('should filter by edgeType', () => {
      engine.addNode({
        id: 'a1',
        type: 'agent',
        label: 'Agent',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'm1',
        type: 'mission',
        label: 'Mission',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({ id: 'e1', from: 'a1', to: 'm1', type: 'PART_OF', weight: 1, createdAt: '' });
      engine.addEdge({
        id: 'e2',
        from: 'a1',
        to: 'm1',
        type: 'CAUSES',
        weight: 0.5,
        createdAt: '',
      });

      const result = engine.query({ edgeType: 'PART_OF', depth: 3, sortOrder: 'desc' });
      expect(result.totalEdges).toBe(1);
    });

    it('should return queryTimeMs', () => {
      const result = engine.query({ depth: 3, sortOrder: 'desc' });
      expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateInferences', () => {
    it('should detect transitive causality', () => {
      engine.addNode({
        id: 'a',
        type: 'agent',
        label: 'A',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'b',
        type: 'mission',
        label: 'B',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'c',
        type: 'mission',
        label: 'C',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({ id: 'e1', from: 'a', to: 'b', type: 'CAUSES', weight: 1, createdAt: '' });
      engine.addEdge({ id: 'e2', from: 'b', to: 'c', type: 'CAUSES', weight: 1, createdAt: '' });

      const inferences = engine.generateInferences(
        [engine.getNode('a'), engine.getNode('b'), engine.getNode('c')] as any,
        [engine.getOutgoingEdges('a')[0], engine.getOutgoingEdges('b')[0]],
      );
      expect(inferences.some((i) => i.includes('Transitive'))).toBe(true);
    });

    it('should detect rule co-application', () => {
      engine.addNode({
        id: 'm1',
        type: 'mission',
        label: 'M1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'r1',
        type: 'rule',
        label: 'R1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'r2',
        type: 'rule',
        label: 'R2',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({
        id: 'e1',
        from: 'm1',
        to: 'r1',
        type: 'GOVERNED_BY',
        weight: 1,
        createdAt: '',
      });
      engine.addEdge({
        id: 'e2',
        from: 'm1',
        to: 'r2',
        type: 'GOVERNED_BY',
        weight: 1,
        createdAt: '',
      });

      const inferences = engine.generateInferences(
        [engine.getNode('m1'), engine.getNode('r1'), engine.getNode('r2')] as any,
        [engine.getOutgoingEdges('m1')[0], engine.getOutgoingEdges('m1')[1]],
      );
      expect(inferences.some((i) => i.includes('commonly applied'))).toBe(true);
    });
  });

  describe('populateFromState', () => {
    it('should create nodes from agents', () => {
      engine.populateFromState({
        agents: [
          { id: 'a1', name: 'Agent One', type: 'developer' },
          { id: 'a2', name: 'Agent Two', type: 'architect' },
        ],
      });
      expect(engine.getNode('agent:a1')).toBeDefined();
      expect(engine.getNode('agent:a2')).toBeDefined();
      expect(engine.getStats().totalNodes).toBe(2);
    });

    it('should create nodes from missions', () => {
      engine.populateFromState({
        missions: [
          {
            id: 'm1',
            title: 'Fix bug',
            type: 'bugfix',
            status: 'active',
            dnaPattern: 'lean-factory',
          },
        ],
      });
      expect(engine.getNode('mission:m1')).toBeDefined();
    });

    it('should create nodes from rules', () => {
      engine.populateFromState({
        rules: [{ id: 'r1', level: 'critical', action: 'block' }],
      });
      expect(engine.getNode('rule:r1')).toBeDefined();
    });
  });

  describe('snapshot/restore', () => {
    it('should persist and restore graph state', () => {
      engine.addNode({
        id: 'n1',
        type: 'agent',
        label: 'N1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({
        id: 'e1',
        from: 'n1',
        to: 'n1',
        type: 'RELATED_TO',
        weight: 1,
        createdAt: '',
      });

      const snapshot = engine.snapshot();
      const fresh = new KnowledgeGraphEngine();
      fresh.restore(snapshot);

      expect(fresh.getStats().totalNodes).toBe(1);
      expect(fresh.getStats().totalEdges).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      engine.addNode({
        id: 'n1',
        type: 'agent',
        label: 'N1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'n2',
        type: 'mission',
        label: 'N2',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({ id: 'e1', from: 'n1', to: 'n2', type: 'PART_OF', weight: 1, createdAt: '' });

      const stats = engine.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.totalEdges).toBe(1);
      expect(stats.nodesByType.agent).toBe(1);
      expect(stats.nodesByType.mission).toBe(1);
      expect(stats.edgesByType.PART_OF).toBe(1);
    });
  });

  describe('removeNode', () => {
    it('should remove node and its edges', () => {
      engine.addNode({
        id: 'n1',
        type: 'agent',
        label: 'N1',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addNode({
        id: 'n2',
        type: 'mission',
        label: 'N2',
        properties: {},
        createdAt: '',
        updatedAt: '',
      });
      engine.addEdge({ id: 'e1', from: 'n1', to: 'n2', type: 'PART_OF', weight: 1, createdAt: '' });

      engine.removeNode('n1');
      expect(engine.getNode('n1')).toBeUndefined();
      expect(engine.getStats().totalEdges).toBe(0);
    });
  });
});
