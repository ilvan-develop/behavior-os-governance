import { z } from 'zod';
// ============================================================
// DNA Pattern Schemas
// ============================================================
export const GovernanceActionSchema = z.enum(['block', 'escalate', 'warn', 'log']);
export const ConditionSchema = z.object({
  type: z.string(),
  value: z.any(),
});
export const GovernanceRuleSchema = z.object({
  id: z.string(),
  level: z.enum(['critical', 'high', 'medium', 'low']),
  action: GovernanceActionSchema,
  conditions: z.array(ConditionSchema),
  description: z.string().optional(),
});
export const QualityGateSchema = z.object({
  id: z.string(),
  type: z.enum(['test_coverage', 'lint', 'typecheck', 'security', 'performance', 'access_control']),
  threshold: z.number(),
  operator: z.enum(['gte', 'lte', 'eq', 'neq']).optional(),
});
export const PersonaBoundarySchema = z.object({
  id: z.string(),
  type: z.enum(['max_modules', 'max_files', 'max_lines', 'max_time', 'max_actions']),
  value: z.number(),
});
export const PersonaSchema = z.object({
  role: z.string(),
  name: z.string(),
  authority: z.enum(['admin', 'architect', 'developer', 'reviewer', 'operator']),
  boundaries: z.array(PersonaBoundarySchema).optional(),
  skills: z.array(z.string()),
  description: z.string().optional(),
});
export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  required: z.boolean().default(true),
  approvalRequired: z.boolean().default(false),
  timeoutSeconds: z.number().optional(),
});
export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(WorkflowStepSchema),
});
export const DNASchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  personas: z.array(PersonaSchema),
  governance: z.array(GovernanceRuleSchema),
  quality: z.array(QualityGateSchema),
  workflows: z.array(WorkflowSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
// ============================================================
// Mission Schemas
// ============================================================
export const MissionTypeSchema = z.enum([
  'feature',
  'bugfix',
  'deployment',
  'research',
  'refactor',
  'audit',
  'incident',
]);
export const MissionPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const MissionStatusSchema = z.enum([
  'pending',
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);
export const MissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  type: MissionTypeSchema,
  priority: MissionPrioritySchema,
  status: MissionStatusSchema,
  dnaPattern: z.string(),
  createdBy: z.string(),
  assignedTo: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: z.number().min(0).max(100).default(0),
  tags: z.array(z.string()).optional(),
});
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
// Governance Schemas
// ============================================================
export const GovernanceVerdictSchema = z.enum(['allow', 'deny', 'escalate', 'transform']);
export const GovernanceDecisionSchema = z.object({
  id: z.string(),
  action: z.string(),
  verdict: GovernanceVerdictSchema,
  reason: z.string(),
  rulesEvaluated: z.array(z.string()),
  timestamp: z.string(),
  agentId: z.string(),
  missionId: z.string().optional(),
});
// ============================================================
// Audit Schemas
// ============================================================
export const AuditStageSchema = z.enum([
  'lint',
  'typecheck',
  'security',
  'coverage',
  'performance',
  'governance',
]);
export const AuditResultSchema = z.object({
  id: z.string(),
  stage: AuditStageSchema,
  status: z.enum(['passed', 'failed', 'warning', 'skipped']),
  details: z.record(z.string(), z.any()),
  timestamp: z.string(),
});
export const AuditReportSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  agentId: z.string(),
  stages: z.array(AuditResultSchema),
  overall: z.enum(['pass', 'fail', 'warning']),
  summary: z.string(),
  timestamp: z.string(),
});
// ============================================================
// Learning Schemas
// ============================================================
export const LearningTypeSchema = z.enum(['insight', 'pattern', 'fix', 'failure', 'optimization']);
export const LearningImpactSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const LearningEventSchema = z.object({
  id: z.string(),
  type: LearningTypeSchema,
  source: z.string(),
  content: z.string(),
  impact: LearningImpactSchema,
  relatedMission: z.string().optional(),
  relatedPattern: z.string().optional(),
  timestamp: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});
// ============================================================
// Protocol Schemas
// ============================================================
export const ProtocolStepSchema = z.object({
  number: z.number(),
  name: z.string(),
  description: z.string(),
  tool: z.string(),
  required: z.boolean().default(true),
});
export const AgentStateSchema = z.object({
  currentStep: z.number().default(0),
  selectedDna: z.string().nullable(),
  activeMission: z.string().nullable(),
  stepHistory: z.array(z.record(z.string(), z.any())),
  createdAt: z.string(),
  updatedAt: z.string(),
});
// ============================================================
// MCP Schemas
// ============================================================
export const McpToolSchema = z.object({
  name: z.string().max(64),
  description: z.string(),
  inputSchema: z.record(z.string(), z.any()),
});
export const McpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
//# sourceMappingURL=index.js.map
