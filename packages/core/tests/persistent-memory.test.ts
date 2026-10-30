import type { KnowledgeGraphNode } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeGraphEngine } from '../src/engine/knowledge-graph-engine.js';
import { PersistentMemoryEngine } from '../src/engine/persistent-memory-engine.js';

describe('PersistentMemoryEngine (G-003)', () => {
  let engine: PersistentMemoryEngine;
  let knowledgeGraph: KnowledgeGraphEngine;

  beforeEach(() => {
    engine = new PersistentMemoryEngine();
    knowledgeGraph = new KnowledgeGraphEngine();
    engine.setKnowledgeGraph(knowledgeGraph);
  });

  const makeNode = (
    id: string,
    type: KnowledgeGraphNode['type'] = 'agent',
  ): KnowledgeGraphNode => ({
    id,
    type,
    label: `Node ${id}`,
    properties: { foo: 'bar' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  describe('saveMemory / recallMemory (without store)', () => {
    it('should save and recall from in-memory knowledge graph', () => {
      const node = makeNode('test:1');
      engine.saveMemory(node);

      const recalled = engine.recallMemory('test:1');
      expect(recalled).toBeDefined();
      expect(recalled?.label).toBe('Node test:1');
    });

    it('should return null for non-existent memory', () => {
      expect(engine.recallMemory('nonexistent')).toBeNull();
    });
  });

  describe('saveMemory (with store)', () => {
    it('should save memory to store when available', () => {
      const fakeStore = {
        setMeta: () => {},
        getMeta: (key: string) => {
          if (key === 'memory:test:2') {
            return JSON.stringify({
              node: makeNode('test:2', 'mission'),
              relevanceScore: 0.8,
            });
          }
          return null;
        },
      };
      engine.setStore(fakeStore as any);

      const node = makeNode('test:2', 'mission');
      engine.saveMemory(node, { relevanceScore: 0.8 });

      const recalled = engine.recallMemory('test:2');
      expect(recalled).toBeDefined();
      expect(recalled?.type).toBe('mission');
    });
  });

  describe('saveMetaDecision / recallMetaDecision', () => {
    it('should save and recall meta-decisions in-memory', () => {
      const metaDecision = {
        decision: {
          id: 'dec:1',
          verdict: 'allow',
          action: 'test',
          agentId: 'a1',
          reason: 'ok',
          rulesEvaluated: [],
          firedRules: [],
        },
        reasoningPath: [],
        confidence: 0.9,
        biasDetection: [],
        selfCritique: 'Looks good',
        createdAt: '2026-01-01T00:00:00Z',
        agentId: 'a1',
      };
      engine.saveMetaDecision(metaDecision as any);

      const recalled = engine.recallMetaDecision('dec:1');
      expect(recalled).toBeDefined();
      expect(recalled?.confidence).toBe(0.9);
    });

    it('should return null for non-existent decision', () => {
      expect(engine.recallMetaDecision('nonexistent')).toBeNull();
    });
  });

  describe('recallRelevant', () => {
    it('should find relevant memories via graph traversal', () => {
      // Set up graph: agent -> mission -> rule
      knowledgeGraph.addNode(makeNode('agent:1', 'agent'));
      knowledgeGraph.addNode(makeNode('mission:1', 'mission'));
      knowledgeGraph.addNode(makeNode('rule:1', 'rule'));

      knowledgeGraph.addEdge({
        id: 'e1',
        from: 'agent:1',
        to: 'mission:1',
        type: 'PART_OF',
        weight: 1,
        createdAt: '',
      });
      knowledgeGraph.addEdge({
        id: 'e2',
        from: 'mission:1',
        to: 'rule:1',
        type: 'GOVERNED_BY',
        weight: 0.8,
        createdAt: '',
      });

      const results = engine.recallRelevant('agent:1', { maxDepth: 2 });
      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('should filter by node types', () => {
      knowledgeGraph.addNode(makeNode('a1', 'agent'));
      knowledgeGraph.addNode(makeNode('m1', 'mission'));
      knowledgeGraph.addNode(makeNode('r1', 'rule'));

      knowledgeGraph.addEdge({
        id: 'e1',
        from: 'a1',
        to: 'm1',
        type: 'PART_OF',
        weight: 1,
        createdAt: '',
      });
      knowledgeGraph.addEdge({
        id: 'e2',
        from: 'a1',
        to: 'r1',
        type: 'RELATED_TO',
        weight: 1,
        createdAt: '',
      });

      const results = engine.recallRelevant('a1', { nodeTypes: ['mission'] });
      expect(results.every((r) => r.node.type === 'mission')).toBe(true);
    });

    it('should return empty when no knowledge graph', () => {
      const fresh = new PersistentMemoryEngine();
      expect(fresh.recallRelevant('test')).toEqual([]);
    });
  });

  describe('reconstructContext', () => {
    it('should reconstruct context for an agent', () => {
      knowledgeGraph.addNode(makeNode('agent:1', 'agent'));
      knowledgeGraph.addNode(makeNode('mission:1', 'mission'));
      knowledgeGraph.addNode(makeNode('learning:1', 'learning'));

      knowledgeGraph.addEdge({
        id: 'e1',
        from: 'agent:1',
        to: 'mission:1',
        type: 'PART_OF',
        weight: 1,
        createdAt: '',
      });
      knowledgeGraph.addEdge({
        id: 'e2',
        from: 'agent:1',
        to: 'learning:1',
        type: 'OBSERVED_IN',
        weight: 1,
        createdAt: '',
      });

      const context = engine.reconstructContext('1');
      expect(context.missions.length).toBeGreaterThan(0);
      expect(context.learnings.length).toBeGreaterThan(0);
    });

    it('should return empty arrays for unknown agent', () => {
      const context = engine.reconstructContext('unknown');
      expect(context.missions).toEqual([]);
      expect(context.decisions).toEqual([]);
      expect(context.learnings).toEqual([]);
    });
  });

  describe('consolidate', () => {
    it('should save nodes and edges to store', () => {
      knowledgeGraph.addNode(makeNode('n1'));
      knowledgeGraph.addEdge({
        id: 'e1',
        from: 'n1',
        to: 'n1',
        type: 'RELATED_TO',
        weight: 1,
        createdAt: '',
      });

      const savedKeys: string[] = [];
      const fakeStore = {
        setMeta: (key: string) => {
          savedKeys.push(key);
        },
        getMeta: () => null,
      };
      engine.setStore(fakeStore as any);

      const result = engine.consolidate();
      expect(result.savedNodes).toBe(1);
      expect(result.savedEdges).toBe(1);
      expect(savedKeys.some((k) => k.startsWith('memory:'))).toBe(true);
      expect(savedKeys.some((k) => k.startsWith('edge:'))).toBe(true);
    });

    it('should return zeros when no knowledge graph', () => {
      const fresh = new PersistentMemoryEngine();
      expect(fresh.consolidate()).toEqual({ savedNodes: 0, savedEdges: 0 });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      knowledgeGraph.addNode(makeNode('n1'));
      knowledgeGraph.addNode(makeNode('n2', 'mission'));

      const stats = engine.getStats();
      expect(stats.totalInMemoryNodes).toBe(2);
      expect(stats.totalInMemoryEdges).toBe(0);
      expect(stats.totalMetaDecisions).toBe(0);
      expect(stats.hasPersistentStore).toBe(false);
    });

    it('should report hasPersistentStore when store is set', () => {
      engine.setStore({ setMeta: () => '', getMeta: () => null } as any);
      const stats = engine.getStats();
      expect(stats.hasPersistentStore).toBe(true);
    });
  });

  describe('clearInMemory', () => {
    it('should clear meta-decision cache', () => {
      engine.saveMetaDecision({
        decision: {
          id: 'd1',
          verdict: 'allow',
          action: 'test',
          agentId: 'a1',
          reason: 'ok',
          rulesEvaluated: [],
          firedRules: [],
        },
        reasoningPath: [],
        confidence: 0.9,
        biasDetection: [],
        selfCritique: 'ok',
        createdAt: '',
        agentId: 'a1',
      } as any);

      engine.clearInMemory();
      expect(engine.recallMetaDecision('d1')).toBeNull();
    });
  });
});
