import { z } from 'zod';
export declare const GovernanceActionSchema: z.ZodEnum<{
  block: 'block';
  escalate: 'escalate';
  warn: 'warn';
  log: 'log';
  transform: 'transform';
}>;
export declare const ConditionSchema: z.ZodObject<
  {
    type: z.ZodString;
    value: z.ZodAny;
  },
  z.core.$strip
>;
export declare const GovernanceRuleSchema: z.ZodObject<
  {
    id: z.ZodString;
    level: z.ZodEnum<{
      critical: 'critical';
      high: 'high';
      medium: 'medium';
      low: 'low';
    }>;
    action: z.ZodEnum<{
      block: 'block';
      escalate: 'escalate';
      warn: 'warn';
      log: 'log';
      transform: 'transform';
    }>;
    conditions: z.ZodArray<
      z.ZodObject<
        {
          type: z.ZodString;
          value: z.ZodAny;
        },
        z.core.$strip
      >
    >;
    description: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const QualityGateSchema: z.ZodObject<
  {
    id: z.ZodString;
    type: z.ZodEnum<{
      test_coverage: 'test_coverage';
      lint: 'lint';
      typecheck: 'typecheck';
      security: 'security';
      performance: 'performance';
      access_control: 'access_control';
    }>;
    threshold: z.ZodNumber;
    operator: z.ZodOptional<
      z.ZodEnum<{
        gte: 'gte';
        lte: 'lte';
        eq: 'eq';
        neq: 'neq';
      }>
    >;
  },
  z.core.$strip
>;
export declare const PersonaBoundarySchema: z.ZodObject<
  {
    id: z.ZodString;
    type: z.ZodEnum<{
      max_modules: 'max_modules';
      max_files: 'max_files';
      max_lines: 'max_lines';
      max_time: 'max_time';
      max_actions: 'max_actions';
    }>;
    value: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const PersonaSchema: z.ZodObject<
  {
    role: z.ZodString;
    name: z.ZodString;
    authority: z.ZodEnum<{
      operator: 'operator';
      admin: 'admin';
      architect: 'architect';
      developer: 'developer';
      reviewer: 'reviewer';
    }>;
    boundaries: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            type: z.ZodEnum<{
              max_modules: 'max_modules';
              max_files: 'max_files';
              max_lines: 'max_lines';
              max_time: 'max_time';
              max_actions: 'max_actions';
            }>;
            value: z.ZodNumber;
          },
          z.core.$strip
        >
      >
    >;
    skills: z.ZodArray<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const WorkflowStepSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    required: z.ZodDefault<z.ZodBoolean>;
    approvalRequired: z.ZodDefault<z.ZodBoolean>;
    timeoutSeconds: z.ZodOptional<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const WorkflowSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    steps: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          name: z.ZodString;
          required: z.ZodDefault<z.ZodBoolean>;
          approvalRequired: z.ZodDefault<z.ZodBoolean>;
          timeoutSeconds: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const DNASchema: z.ZodObject<
  {
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    personas: z.ZodArray<
      z.ZodObject<
        {
          role: z.ZodString;
          name: z.ZodString;
          authority: z.ZodEnum<{
            operator: 'operator';
            admin: 'admin';
            architect: 'architect';
            developer: 'developer';
            reviewer: 'reviewer';
          }>;
          boundaries: z.ZodOptional<
            z.ZodArray<
              z.ZodObject<
                {
                  id: z.ZodString;
                  type: z.ZodEnum<{
                    max_modules: 'max_modules';
                    max_files: 'max_files';
                    max_lines: 'max_lines';
                    max_time: 'max_time';
                    max_actions: 'max_actions';
                  }>;
                  value: z.ZodNumber;
                },
                z.core.$strip
              >
            >
          >;
          skills: z.ZodArray<z.ZodString>;
          description: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    governance: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          level: z.ZodEnum<{
            critical: 'critical';
            high: 'high';
            medium: 'medium';
            low: 'low';
          }>;
          action: z.ZodEnum<{
            block: 'block';
            escalate: 'escalate';
            warn: 'warn';
            log: 'log';
            transform: 'transform';
          }>;
          conditions: z.ZodArray<
            z.ZodObject<
              {
                type: z.ZodString;
                value: z.ZodAny;
              },
              z.core.$strip
            >
          >;
          description: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    quality: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          type: z.ZodEnum<{
            test_coverage: 'test_coverage';
            lint: 'lint';
            typecheck: 'typecheck';
            security: 'security';
            performance: 'performance';
            access_control: 'access_control';
          }>;
          threshold: z.ZodNumber;
          operator: z.ZodOptional<
            z.ZodEnum<{
              gte: 'gte';
              lte: 'lte';
              eq: 'eq';
              neq: 'neq';
            }>
          >;
        },
        z.core.$strip
      >
    >;
    workflows: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodString;
            steps: z.ZodArray<
              z.ZodObject<
                {
                  id: z.ZodString;
                  name: z.ZodString;
                  required: z.ZodDefault<z.ZodBoolean>;
                  approvalRequired: z.ZodDefault<z.ZodBoolean>;
                  timeoutSeconds: z.ZodOptional<z.ZodNumber>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >
      >
    >;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
  },
  z.core.$strip
>;
export declare const MissionTypeSchema: z.ZodEnum<{
  feature: 'feature';
  bugfix: 'bugfix';
  deployment: 'deployment';
  research: 'research';
  refactor: 'refactor';
  audit: 'audit';
  incident: 'incident';
}>;
export declare const MissionPrioritySchema: z.ZodEnum<{
  critical: 'critical';
  high: 'high';
  medium: 'medium';
  low: 'low';
}>;
export declare const MissionStatusSchema: z.ZodEnum<{
  pending: 'pending';
  active: 'active';
  paused: 'paused';
  completed: 'completed';
  failed: 'failed';
  cancelled: 'cancelled';
}>;
export declare const MissionSchema: z.ZodObject<
  {
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
      feature: 'feature';
      bugfix: 'bugfix';
      deployment: 'deployment';
      research: 'research';
      refactor: 'refactor';
      audit: 'audit';
      incident: 'incident';
    }>;
    priority: z.ZodEnum<{
      critical: 'critical';
      high: 'high';
      medium: 'medium';
      low: 'low';
    }>;
    status: z.ZodEnum<{
      pending: 'pending';
      active: 'active';
      paused: 'paused';
      completed: 'completed';
      failed: 'failed';
      cancelled: 'cancelled';
    }>;
    dnaPattern: z.ZodString;
    createdBy: z.ZodString;
    assignedTo: z.ZodOptional<z.ZodArray<z.ZodString>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    progress: z.ZodDefault<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const AgentTypeSchema: z.ZodEnum<{
  operator: 'operator';
  architect: 'architect';
  developer: 'developer';
  reviewer: 'reviewer';
  orchestrator: 'orchestrator';
  analyst: 'analyst';
}>;
export declare const AgentStatusSchema: z.ZodEnum<{
  error: 'error';
  idle: 'idle';
  busy: 'busy';
  offline: 'offline';
}>;
export declare const AgentSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<{
      operator: 'operator';
      architect: 'architect';
      developer: 'developer';
      reviewer: 'reviewer';
      orchestrator: 'orchestrator';
      analyst: 'analyst';
    }>;
    status: z.ZodEnum<{
      error: 'error';
      idle: 'idle';
      busy: 'busy';
      offline: 'offline';
    }>;
    dnaPattern: z.ZodString;
    capabilities: z.ZodArray<z.ZodString>;
    currentMission: z.ZodNullable<z.ZodString>;
    metrics: z.ZodObject<
      {
        tasksCompleted: z.ZodNumber;
        tasksFailed: z.ZodNumber;
        avgResponseTime: z.ZodNumber;
        governanceViolations: z.ZodNumber;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export declare const GovernanceVerdictSchema: z.ZodEnum<{
  escalate: 'escalate';
  transform: 'transform';
  allow: 'allow';
  deny: 'deny';
}>;
export declare const GovernanceDecisionSchema: z.ZodObject<
  {
    id: z.ZodString;
    action: z.ZodString;
    verdict: z.ZodEnum<{
      escalate: 'escalate';
      transform: 'transform';
      allow: 'allow';
      deny: 'deny';
    }>;
    reason: z.ZodString;
    rulesEvaluated: z.ZodArray<z.ZodString>;
    timestamp: z.ZodString;
    agentId: z.ZodString;
    missionId: z.ZodOptional<z.ZodString>;
    transformed: z.ZodOptional<z.ZodBoolean>;
    warnings: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const AuditStageSchema: z.ZodEnum<{
  lint: 'lint';
  typecheck: 'typecheck';
  security: 'security';
  performance: 'performance';
  governance: 'governance';
  coverage: 'coverage';
}>;
export declare const AuditResultSchema: z.ZodObject<
  {
    id: z.ZodString;
    stage: z.ZodEnum<{
      lint: 'lint';
      typecheck: 'typecheck';
      security: 'security';
      performance: 'performance';
      governance: 'governance';
      coverage: 'coverage';
    }>;
    status: z.ZodEnum<{
      failed: 'failed';
      passed: 'passed';
      warning: 'warning';
      skipped: 'skipped';
    }>;
    details: z.ZodRecord<z.ZodString, z.ZodAny>;
    timestamp: z.ZodString;
  },
  z.core.$strip
>;
export declare const AuditReportSchema: z.ZodObject<
  {
    id: z.ZodString;
    missionId: z.ZodString;
    agentId: z.ZodString;
    stages: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          stage: z.ZodEnum<{
            lint: 'lint';
            typecheck: 'typecheck';
            security: 'security';
            performance: 'performance';
            governance: 'governance';
            coverage: 'coverage';
          }>;
          status: z.ZodEnum<{
            failed: 'failed';
            passed: 'passed';
            warning: 'warning';
            skipped: 'skipped';
          }>;
          details: z.ZodRecord<z.ZodString, z.ZodAny>;
          timestamp: z.ZodString;
        },
        z.core.$strip
      >
    >;
    overall: z.ZodEnum<{
      warning: 'warning';
      pass: 'pass';
      fail: 'fail';
    }>;
    summary: z.ZodString;
    timestamp: z.ZodString;
  },
  z.core.$strip
>;
export declare const LearningTypeSchema: z.ZodEnum<{
  insight: 'insight';
  pattern: 'pattern';
  fix: 'fix';
  failure: 'failure';
  optimization: 'optimization';
}>;
export declare const LearningImpactSchema: z.ZodEnum<{
  critical: 'critical';
  high: 'high';
  medium: 'medium';
  low: 'low';
}>;
export declare const LearningEventSchema: z.ZodObject<
  {
    id: z.ZodString;
    type: z.ZodEnum<{
      insight: 'insight';
      pattern: 'pattern';
      fix: 'fix';
      failure: 'failure';
      optimization: 'optimization';
    }>;
    source: z.ZodString;
    content: z.ZodString;
    impact: z.ZodEnum<{
      critical: 'critical';
      high: 'high';
      medium: 'medium';
      low: 'low';
    }>;
    relatedMission: z.ZodOptional<z.ZodString>;
    relatedPattern: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
  },
  z.core.$strip
>;
export declare const ProtocolStepSchema: z.ZodObject<
  {
    number: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodString;
    tool: z.ZodString;
    required: z.ZodDefault<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const AgentStateSchema: z.ZodObject<
  {
    currentStep: z.ZodDefault<z.ZodNumber>;
    selectedDna: z.ZodNullable<z.ZodString>;
    activeMission: z.ZodNullable<z.ZodString>;
    stepHistory: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodAny>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
  },
  z.core.$strip
>;
export declare const McpToolSchema: z.ZodObject<
  {
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodRecord<z.ZodString, z.ZodAny>;
  },
  z.core.$strip
>;
export declare const McpResourceSchema: z.ZodObject<
  {
    uri: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    mimeType: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type GovernanceAction = z.infer<typeof GovernanceActionSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type GovernanceRule = z.infer<typeof GovernanceRuleSchema>;
export type QualityGate = z.infer<typeof QualityGateSchema>;
export type PersonaBoundary = z.infer<typeof PersonaBoundarySchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type DNA = z.infer<typeof DNASchema>;
export type MissionType = z.infer<typeof MissionTypeSchema>;
export type MissionPriority = z.infer<typeof MissionPrioritySchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type GovernanceVerdict = z.infer<typeof GovernanceVerdictSchema>;
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema> & {
  warnings?: string[];
};
export type AuditStage = z.infer<typeof AuditStageSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type LearningType = z.infer<typeof LearningTypeSchema>;
export type LearningImpact = z.infer<typeof LearningImpactSchema>;
export type LearningEvent = z.infer<typeof LearningEventSchema>;
export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type McpTool = z.infer<typeof McpToolSchema>;
export type McpResource = z.infer<typeof McpResourceSchema>;
//# sourceMappingURL=index.d.ts.map
