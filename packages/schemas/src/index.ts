// ============================================================
// @behavior-os/schemas — Aggregating index
//
// This file is now a thin re-export layer. All domain-specific
// schemas live in dedicated submodule files. The public API is
// unchanged: every consumer that imports from
// `@behavior-os/schemas` continues to work.
//
// Submodules:
//   dna.ts           — DNA Pattern, Construction Pipeline, Governance Rule
//   mission.ts       — Mission, Evidence, Transition
//   task.ts          — Task Orchestration
//   agent.ts         — Agent
//   governance.ts    — Governance, Audit, Pipeline
//   decision.ts      — Decision, Consensus, Prediction
//   learning.ts      — DNA Evolution, Learning
//   protocol.ts      — Protocol, MCP
//   code-edit.ts     — CodeFix, CodeEdit, RankedRecommendation, DriftInfo
//   anti-pattern.ts  — AntiPattern, Severity, PolicyRule, Role
//   knowledge-graph.ts — Knowledge Graph (G-001)
//   responsible-ai.ts — G-004..G-020, Fairness, Provenance, Oversight
// ============================================================

export * from './agent.js';
export * from './anti-pattern.js';
export * from './code-edit.js';
export * from './decision.js';
export * from './dna.js';
export * from './governance.js';
export * from './knowledge-graph.js';
export * from './learning.js';
export * from './mission.js';
export * from './protocol.js';
export * from './responsible-ai.js';
export * from './task.js';
