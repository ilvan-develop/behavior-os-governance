import { z } from 'zod';

// ============================================================
// Knowledge Graph Schemas (G-001)
// ============================================================

/**
 * Node types in the knowledge graph.
 * Each node represents a real entity in the Behavior-OS system.
 */
export const KnowledgeGraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'agent',
    'mission',
    'rule',
    'learning',
    'decision',
    'pattern',
    'dna',
    'audit',
    'task',
  ]),
  /** Human-readable label */
  label: z.string(),
  /** Structured properties (type-safe) */
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Edge types representing relationships between nodes.
 */
export const KnowledgeGraphEdgeSchema = z.object({
  id: z.string(),
  /** ID of the source node */
  from: z.string(),
  /** ID of the target node */
  to: z.string(),
  /** Relationship type */
  type: z.enum([
    'GOVERNED_BY',
    'PART_OF',
    'CAUSES',
    'RELATED_TO',
    'TRIGGERED',
    'EVIDENCE_FOR',
    'TRANSFORMS',
    'SIMILAR_TO',
    'OBSERVED_IN',
    'IMPLEMENTS',
  ]),
  /** Weight/score of the relationship (0-1) */
  weight: z.number().min(0).max(1).default(1),
  properties: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
});

/**
 * A query language for traversing the knowledge graph.
 */
export const KnowledgeQuerySchema = z.object({
  /** Starting node ID or wildcard '*' */
  startNode: z.string().optional(),
  /** Node type filter */
  nodeType: z
    .enum([
      'agent',
      'mission',
      'rule',
      'learning',
      'decision',
      'pattern',
      'dna',
      'audit',
      'task',
      'any',
    ])
    .optional(),
  /** Edge type filter */
  edgeType: z
    .enum([
      'GOVERNED_BY',
      'PART_OF',
      'CAUSES',
      'RELATED_TO',
      'TRIGGERED',
      'EVIDENCE_FOR',
      'TRANSFORMS',
      'SIMILAR_TO',
      'OBSERVED_IN',
      'IMPLEMENTS',
      'any',
    ])
    .optional(),
  /** Maximum depth to traverse */
  depth: z.number().int().min(1).max(10).default(3),
  /** Filter by property key/value */
  properties: z.record(z.string(), z.unknown()).optional(),
  /** Sort results */
  sortBy: z.enum(['createdAt', 'weight', 'label']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const KnowledgeResultSchema = z.object({
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
  /** Path taken to reach results */
  path: z.array(z.string()).optional(),
  /** Inference results */
  inferences: z.array(z.string()).optional(),
  totalNodes: z.number(),
  totalEdges: z.number(),
  queryTimeMs: z.number(),
});

export type KnowledgeGraphNode = z.infer<typeof KnowledgeGraphNodeSchema>;
export type KnowledgeGraphEdge = z.infer<typeof KnowledgeGraphEdgeSchema>;
export type KnowledgeQuery = z.infer<typeof KnowledgeQuerySchema>;
export type KnowledgeResult = z.infer<typeof KnowledgeResultSchema>;
