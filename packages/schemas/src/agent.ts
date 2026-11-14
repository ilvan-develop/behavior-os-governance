import { z } from 'zod';

// ============================================================
// Agent Schemas
// ============================================================

export const AgentTypeSchema = z.enum([
  'orchestrator',
  'developer',
  'architect',
  'reviewer',
  'operator',
  'analyst',
]);

export const AgentStatusSchema = z.enum(['idle', 'busy', 'offline', 'error']);

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AgentTypeSchema,
  status: AgentStatusSchema,
  dnaPattern: z.string(),
  capabilities: z.array(z.string()),
  currentMission: z.string().nullable(),
  metrics: z.object({
    tasksCompleted: z.number(),
    tasksFailed: z.number(),
    avgResponseTime: z.number(),
    governanceViolations: z.number(),
  }),
});

// ============================================================
// Type exports
// ============================================================

export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
