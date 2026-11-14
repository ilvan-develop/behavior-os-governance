import { z } from 'zod';

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
  /**
   * Id of the governed agent acting in this session. Never a model name: it is
   * either an explicitly registered agent id, or a DNA persona identity such as
   * `persona:architect`, or `null` when no DNA/agent has been selected yet.
   */
  agentId: z.string().nullable().default(null),
  /** Persona name/role selected from the active DNA, if any. */
  persona: z.string().nullable().default(null),
  activeMission: z.string().nullable(),
  stepHistory: z.array(z.record(z.string(), z.unknown())),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================================
// MCP Schemas
// ============================================================

export const McpToolSchema = z.object({
  name: z.string().max(64),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export const McpResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

// ============================================================
// Type exports
// ============================================================

export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type McpTool = z.infer<typeof McpToolSchema>;
export type McpResource = z.infer<typeof McpResourceSchema>;
