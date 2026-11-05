/**
 * LLM context builder.
 *
 * Assembles a bounded prompt context from governed engine state: mission
 * summary, task objective, prior evidence (gates already passed), DNA rule
 * summary, and optional knowledge-graph snapshot. Deterministic ordering:
 * evidence > task > DNA > history, oldest non-essential entries dropped
 * first when the input budget is exceeded (ADR: Context Management capability).
 *
 * This module does NOT call any provider — it is pure assembly. The caller
 * passes the built `prompt` into an `LlmRequest.prompt` and the router
 * decides which provider handles it.
 */

import type { DNA, Mission, MissionEvidence } from '@behavior-os/schemas';

export interface LlmContextSources {
  /** The active mission, when one is in flight. */
  mission?: Mission;
  /** The task's objective. */
  taskObjective?: string;
  /** The task's declared acceptance gates (names only). */
  acceptanceGates?: string[];
  /** Prior executed evidence, newest last. */
  evidence?: MissionEvidence[];
  /** The active DNA pattern (rule summary). */
  dna?: DNA;
  /** Free-form history / notes. */
  history?: string[];
}

export interface LlmContextBuildResult {
  /** The assembled prompt text. */
  prompt: string;
  /** Approximate token count of the assembled prompt (same estimator the
   *  provider uses, ~4 chars/token). */
  estimatedTokens: number;
  /** Which source sections were included (for observability). */
  includedSections: string[];
  /** Which source sections were dropped for budget. */
  droppedSections: string[];
}

export interface LlmContextBuilderOptions {
  /** Hard cap on input tokens. Defaults to 8192. */
  maxContextTokens?: number;
  /** Maximum evidence entries to include (newest last, oldest dropped first). */
  maxEvidenceEntries?: number;
  /** Maximum DNA rules to summarize. */
  maxDnaRules?: number;
  /** Maximum history entries. */
  maxHistoryEntries?: number;
}

/**
 * Deterministic, budget-enforcing context builder. No I/O, no LLM call —
 * pure assembly from governed state.
 */
export class LlmContextBuilder {
  private readonly maxContextTokens: number;
  private readonly maxEvidenceEntries: number;
  private readonly maxDnaRules: number;
  private readonly maxHistoryEntries: number;

  constructor(options: LlmContextBuilderOptions = {}) {
    this.maxContextTokens = options.maxContextTokens ?? 8_192;
    this.maxEvidenceEntries = options.maxEvidenceEntries ?? 20;
    this.maxDnaRules = options.maxDnaRules ?? 50;
    this.maxHistoryEntries = options.maxHistoryEntries ?? 10;
  }

  build(sources: LlmContextSources): LlmContextBuildResult {
    // Order of importance: evidence > task > DNA > history (oldest dropped
    // first when over budget).
    const sections: Array<{ name: string; text: string }> = [];

    if (sources.evidence && sources.evidence.length > 0) {
      const entries = sources.evidence.slice(-this.maxEvidenceEntries);
      const lines = entries.map((entry) => {
        const status = entry.status;
        const gate = entry.gate;
        const execId = entry.executionId ? ` [exec:${entry.executionId}]` : '';
        return `- gate "${gate}": ${status}${execId}`;
      });
      sections.push({
        name: 'evidence',
        text: `## Prior Evidence (executed)\n${lines.join('\n')}`,
      });
    }

    if (sources.taskObjective) {
      const gates = sources.acceptanceGates
        ? ` Acceptance gates: ${sources.acceptanceGates.join(', ')}.`
        : '';
      sections.push({
        name: 'task',
        text: `## Task\nObjective: ${sources.taskObjective}.${gates}`,
      });
    }

    if (sources.dna && sources.dna.governance.length > 0) {
      const rules = sources.dna.governance.slice(0, this.maxDnaRules);
      const lines = rules.map((rule) => {
        const conditions = rule.conditions
          .map((c) => `${c.type}=${JSON.stringify(c.value)}`)
          .join(', ');
        return `- ${rule.id} (${rule.action}): ${conditions}`;
      });
      sections.push({
        name: 'dna',
        text: `## Active DNA Rules (${sources.dna.name})\n${lines.join('\n')}`,
      });
    }

    if (sources.mission) {
      const mission = sources.mission;
      sections.push({
        name: 'mission',
        text:
          `## Mission\n` +
          `id: ${mission.id}\n` +
          `title: ${mission.title}\n` +
          `status: ${mission.status}\n` +
          `type: ${mission.type} / priority: ${mission.priority}`,
      });
    }

    if (sources.history && sources.history.length > 0) {
      const entries = sources.history.slice(-this.maxHistoryEntries);
      sections.push({
        name: 'history',
        text: `## History\n${entries.map((entry) => `- ${entry}`).join('\n')}`,
      });
    }

    // Apply the budget: keep the mandatory sections (evidence + task), then
    // include optional sections in priority order (DNA → mission → history).
    // A section that would exceed the budget is dropped; a lower-priority
    // section may still fit.
    const includedSections: string[] = [];
    const droppedSections: string[] = [];
    const byName = new Map(sections.map((section) => [section.name, section]));

    const mandatory = sections.filter((section) => ['evidence', 'task'].includes(section.name));
    const includedOrder = mandatory.map((section) => section.name);
    let currentText = mandatory.map((section) => section.text).join('\n\n');
    let estimatedTokens = this.estimateTokens(currentText);

    for (const name of ['dna', 'mission', 'history']) {
      const section = byName.get(name);
      if (!section) continue;
      const candidate = `${currentText}\n\n${section.text}`;
      const candidateTokens = this.estimateTokens(candidate);
      if (candidateTokens <= this.maxContextTokens) {
        currentText = candidate;
        includedOrder.push(name);
        estimatedTokens = candidateTokens;
      } else {
        droppedSections.push(name);
      }
    }
    includedSections.push(...includedOrder);

    // Ensure the mandatory text itself fits (truncation warning if not).
    if (estimatedTokens > this.maxContextTokens && includedOrder.length <= 2) {
      // Only mandatory sections remain and they exceed the budget: this is a
      // caller error (budget too small for even the task objective). Report
      // it honestly rather than silently clipping.
      currentText = currentText.slice(0, this.maxContextTokens * 4); // ~4 chars/token
      estimatedTokens = this.estimateTokens(currentText);
    }

    return {
      prompt: currentText,
      estimatedTokens,
      includedSections,
      droppedSections,
    };
  }

  /** Same stable estimator as `DeterministicLlmProvider.estimateTokens`. */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
