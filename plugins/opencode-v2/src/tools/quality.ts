/**
 * Quality + learning domain: `bos_check_quality`, `bos_evaluate_fairness`,
 * `bos_get_insights` and `bos_record_learning` (with its lifecycle-promotion
 * path under the lock).
 *
 * Extracted from `setup()`. The `withLifecycleLock` seam is passed in because
 * the lock queue lives in `index.ts` (it serialises *all* lifecycle
 * mutations, not just these tools).
 */

import type { FairnessInput } from '@behavior-os/core';
import type { LearningStage } from '@behavior-os/schemas';
import { recordLearningInGraph } from '../learning-graph.js';
import type { ToolRegistrarContext } from './tool-surface.js';

/** A task queued under the shared lifecycle lock (see `withLifecycleLock`). */
export type LifecycleTask = () => Promise<{ content: string }>;

export interface QualityContext extends ToolRegistrarContext {
  /** Run a mutation window under the shared lifecycle lock. */
  withLifecycleLock: <T>(task: () => Promise<T>) => Promise<T>;
}

export function registerQualityTools(ctx: QualityContext): void {
  const { bos, addTool, recordLog, persistState, persistLifecycle, withLifecycleLock } = ctx;

  // Tool 8: bos_check_quality
  addTool({
    name: 'bos_check_quality',
    description: 'Check quality metrics against governance gates',
    input: {
      type: 'object',
      properties: {
        metrics: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['metrics'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { metrics: Record<string, number> };
      const result = bos.checkQuality(params.metrics);
      return {
        content: JSON.stringify(result, null, 2),
      };
    },
  });

  // Tool 8b: bos_evaluate_fairness
  addTool({
    name: 'bos_evaluate_fairness',
    description:
      'Evaluate group outcomes for fairness (demographic parity, disparate impact, equal opportunity), plus data provenance and human oversight',
    input: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string' },
              total: { type: 'number' },
              positive: { type: 'number' },
              actualPositive: { type: 'number' },
              truePositive: { type: 'number' },
            },
            required: ['group', 'total', 'positive'],
          },
        },
        provenance: {
          type: 'object',
          properties: {
            datasetId: { type: 'string' },
            source: { type: 'string' },
            collectedAt: { type: 'string' },
            consentBasis: { type: 'string' },
            transformations: { type: 'array', items: { type: 'string' } },
            lineage: { type: 'array', items: { type: 'string' } },
          },
          required: ['datasetId', 'source', 'collectedAt', 'consentBasis'],
        },
        oversight: {
          type: 'object',
          properties: {
            required: { type: 'boolean' },
            approved: { type: 'boolean' },
            reviewerId: { type: 'string' },
            reviewedAt: { type: 'string' },
            rationale: { type: 'string' },
          },
          required: ['required', 'approved'],
        },
        thresholds: {
          type: 'object',
          properties: {
            maxParityDifference: { type: 'number' },
            minDisparateImpactRatio: { type: 'number' },
            maxEqualOpportunityDifference: { type: 'number' },
          },
        },
      },
      required: ['groups'],
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as FairnessInput;
      const result = bos.evaluateFairness(params);
      return { content: JSON.stringify(result, null, 2) };
    },
  });

  // Tool 9: bos_get_insights
  addTool({
    name: 'bos_get_insights',
    description: 'Get high-impact insights from learning engine',
    input: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as { limit?: number };
      const insights = bos.getInsights(params.limit ?? 10);
      return {
        content: JSON.stringify(insights, null, 2),
      };
    },
  });

  // Tool 10: bos_record_learning
  addTool({
    name: 'bos_record_learning',
    description:
      'Record a learning event, or promote an existing learning record one lifecycle stage (observation → lesson → candidate → validated → policy → monitored). Promotion to validated requires evidence.',
    input: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['insight', 'pattern', 'fix', 'failure', 'optimization'],
        },
        source: { type: 'string' },
        content: { type: 'string' },
        impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        relatedMission: { type: 'string' },
        learningId: {
          type: 'string',
          description: 'Existing learning record to promote (instead of recording a new event)',
        },
        stage: {
          type: 'string',
          enum: ['observation', 'lesson', 'candidate', 'validated', 'policy', 'monitored'],
          description: 'Target stage; must be exactly one step after the current stage',
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: 'Evidence for the promotion; required to reach validated',
        },
        reason: { type: 'string' },
      },
    },
    execute: async (input: unknown): Promise<{ content: string }> => {
      const params = input as {
        type: string;
        source: string;
        content: string;
        impact: string;
        relatedMission?: string;
        learningId?: string;
        stage?: string;
        evidence?: string[];
        reason?: string;
      };

      // Promotion path: move an existing record exactly one stage forward.
      if (params.learningId) {
        if (!params.stage) {
          return {
            content:
              'Learning promotion refused [INVALID_INPUT]: provide the target `stage` for `learningId`.',
          };
        }
        return withLifecycleLock(async () => {
          if (typeof bos.advanceLearningRecord !== 'function') {
            return {
              content:
                'Learning promotion unavailable [STALE_HOST]: this session loaded an older @behavior-os/core. Restart the session after building to load the lifecycle API.',
            };
          }
          const before = bos.exportState();
          const advanced = bos.advanceLearningRecord(
            params.learningId as string,
            params.stage as LearningStage,
            {
              actor: bos.resolveAgentIdentity().agentId,
              ...(params.reason ? { reason: params.reason } : {}),
              ...(params.evidence ? { evidence: params.evidence } : {}),
            },
          );
          if (!advanced.ok) {
            return {
              content: `Learning promotion refused [${advanced.code}]: ${advanced.message}`,
            };
          }
          const persisted = await persistLifecycle(before);
          if (!persisted.ok) {
            return {
              content: `Learning promotion failed [PERSISTENCE_FAILED]: ${persisted.error ?? 'unknown storage error'}`,
            };
          }
          recordLog(
            'learning',
            'info',
            'bos_record_learning',
            `Advanced learning ${advanced.record.id} to ${advanced.record.stage}`,
          );
          return {
            content: `Learning advanced: ${advanced.record.id} -> ${advanced.record.stage}`,
          };
        });
      }

      const missing = (['type', 'source', 'content', 'impact'] as const).filter(
        (field) => !params[field],
      );
      if (missing.length > 0) {
        return {
          content: `Learning not recorded [INVALID_INPUT]: missing ${missing.join(', ')} (required when no learningId is given).`,
        };
      }

      const record =
        typeof bos.createLearningRecord === 'function'
          ? bos.createLearningRecord({
              title: params.content.slice(0, 80),
              content: params.content,
              source: params.source,
              impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
              ...(params.relatedMission ? { relatedMission: params.relatedMission } : {}),
              ...(params.evidence ? { evidence: params.evidence } : {}),
            })
          : null;
      const event = bos.recordLearning({
        type: params.type as 'insight' | 'pattern' | 'fix' | 'failure' | 'optimization',
        source: params.source,
        content: params.content,
        impact: params.impact as 'low' | 'medium' | 'high' | 'critical',
        relatedMission: params.relatedMission,
      });
      // Option C: the learning is now a node in the knowledge graph (G-001),
      // connected to its mission with EVIDENCE_FOR + PART_OF edges. This is
      // what makes the orchestrator's "contextual memory" actually usable —
      // a learning is no longer siloed in the learning engine.
      try {
        const graph = recordLearningInGraph(bos, event.id, {
          label: params.content.slice(0, 80),
          type: params.type,
          impact: params.impact,
          source: params.source,
          relatedMission: params.relatedMission,
        });
        await persistState();
        return {
          content: record
            ? `Learning recorded: ${event.id} (record ${record.id} at observation; promote it with learningId + stage). Graph: node ${graph.node}, ${graph.edges.length} edge(s).`
            : `Learning recorded: ${event.id} (lifecycle record unavailable [STALE_HOST]: restart the session to load the rebuilt core). Graph: node ${graph.node}.`,
        };
      } catch {
        // Graph registration is best-effort: a learning must still be
        // recorded even if the knowledge graph is unavailable.
        await persistState();
        return {
          content: record
            ? `Learning recorded: ${event.id} (record ${record.id} at observation; promote it with learningId + stage)`
            : `Learning recorded: ${event.id} (lifecycle record unavailable [STALE_HOST]: restart the session to load the rebuilt core)`,
        };
      }
    },
  });
}
