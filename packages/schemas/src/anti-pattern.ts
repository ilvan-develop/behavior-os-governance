import { z } from 'zod';

// ============================================================
// Anti-Pattern Schemas
// ============================================================

export const AntiPatternTypeSchema = z.enum([
  'typescript-error',
  'lint-violation',
  'security-vulnerability',
  'performance-issue',
  'architecture-violation',
  'code-smell',
  'test-gap',
  'documentation-gap',
  'governance-bypass',
  'pattern-debt',
]);

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

export const AntiPatternSchema = z.object({
  id: z.string(),
  type: AntiPatternTypeSchema,
  severity: SeveritySchema,
  pattern: z.string(),
  description: z.string(),
  location: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  evidence: z.array(z.string()),
  recommendation: z.string(),
  detectedAt: z.string(),
  resolved: z.boolean().default(false),
  resolvedAt: z.string().optional(),
  resolvedBy: z.string().optional(),
});

export const ConversationTurnSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  role: z.enum(['system', 'user', 'agent', 'expert']),
  content: z.string(),
  timestamp: z.string(),
});

export const PragmaticConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  problem: z.string(),
  status: z.enum(['open', 'in-progress', 'resolved', 'closed', 'cancelled']),
  participants: z.array(z.string()),
  turns: z.array(ConversationTurnSchema),
  antiPatterns: z.array(z.string()),
  solution: z.string().optional(),
  resolvedBy: z.string().optional(),
  lessonsLearned: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  condition: z.string(),
  action: z.enum(['require', 'warn', 'block', 'auto-fix']),
  severity: SeveritySchema,
  appliesTo: z.array(z.enum(['persona', 'role', 'agent', 'project'])).optional(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().optional(),
});

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  responsibilities: z.array(z.string()),
  policies: z.array(z.string()).optional(),
  canAudit: z.boolean().default(false),
  canEnforce: z.boolean().default(false),
  canTeach: z.boolean().default(false),
});

// ============================================================
// Type exports
// ============================================================

export type AntiPatternType = z.infer<typeof AntiPatternTypeSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type AntiPattern = z.infer<typeof AntiPatternSchema>;
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export type PragmaticConversation = z.infer<typeof PragmaticConversationSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type Role = z.infer<typeof RoleSchema>;
