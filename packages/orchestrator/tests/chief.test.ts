import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { ChiefOrchestrator } from '../src/chief.js';

const DNA_FIXTURE: DNA = {
  name: 'Chief Test DNA',
  version: '1.0.0',
  description: 'Minimal DNA for chief planner tests',
  personas: [
    {
      role: 'architect',
      name: 'Architect',
      authority: 'architect',
      skills: ['architecture', 'planning'],
    },
    {
      role: 'developer',
      name: 'Developer',
      authority: 'developer',
      skills: ['implement'],
    },
    {
      role: 'reviewer',
      name: 'Reviewer',
      authority: 'reviewer',
      skills: ['review'],
    },
    {
      role: 'auditor',
      name: 'Auditor',
      authority: 'auditor',
      skills: ['audit'],
    },
  ],
  governance: [],
  quality: [],
};

function planner(): ChiefOrchestrator {
  return new ChiefOrchestrator({ now: () => '2026-01-01T00:00:00.000Z' });
}

describe('ChiefOrchestrator', () => {
  it('plans a debate and an architecture decision for a design goal', () => {
    const plan = planner().plan({
      goal: 'Design the architecture for a multi-tenant billing service and compare approaches',
      dna: DNA_FIXTURE,
    });

    expect(plan.assessment.needsDebate).toBe(true);
    expect(plan.assessment.capabilities).toContain('architecture-decision');
    expect(plan.assessment.capabilities).toContain('brainstorm');
    expect(plan.decision.subject).toBe('architecture-approach');
    expect(plan.decision.chosen).toContain('service');
    expect(plan.decision.alternatives.length).toBeGreaterThan(1);
    expect(plan.debate).not.toBeNull();
    expect(plan.debate?.tools).toContain('bos_create_brainstorm');
    expect(plan.generatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('routes stack setup to docs-first CLI scaffolding, never hand-written generated code', () => {
    const plan = planner().plan({
      goal: 'Install and scaffold a new Next.js app with shadcn and a Postgres stack',
    });

    expect(plan.assessment.needsStackSetup).toBe(true);
    expect(plan.assessment.needsResearch).toBe(true);
    expect(plan.assessment.capabilities).toContain('stack-setup');
    expect(plan.decision.chosen).toContain('docs-first CLI');
    expect(plan.context).toContain('hand-writing generated code');
    expect(plan.phases.map((phase) => phase.id)).toContain('research');
  });

  it('assigns owners from the DNA personas, not from hard-coded names', () => {
    const plan = planner().plan({
      goal: 'Implement a small fix in the invoice parser',
      dna: DNA_FIXTURE,
    });

    const owners = plan.phases.map((phase) => phase.owner);
    expect(owners).toContain('persona:architect');
    expect(owners).toContain('persona:developer');
    expect(owners).toContain('persona:reviewer');
    expect(owners).toContain('persona:auditor');
    expect(plan.delegation.every((entry) => entry.agentId === entry.agentId.trim())).toBe(true);
  });

  it('keeps a simple bugfix direct: no debate, no conversation, but always verify and learn', () => {
    const plan = planner().plan({ goal: 'Fix the typo in the README quickstart' });

    expect(plan.assessment.needsDebate).toBe(false);
    expect(plan.assessment.needsConversation).toBe(false);
    expect(plan.debate).toBeNull();
    expect(plan.conversation).toBeNull();
    expect(plan.assessment.capabilities).toContain('verification');
    expect(plan.assessment.capabilities).toContain('audit');
    expect(plan.assessment.capabilities).toContain('learning');
    expect(plan.tasks[0]?.dependsOn).toEqual([]);
  });

  it('flags production/deploy goals as high risk and keeps the DNA gates', () => {
    const plan = planner().plan({
      goal: 'Deploy the new billing pipeline to production and migrate the schema',
      dna: DNA_FIXTURE,
    });

    expect(plan.assessment.risk).toBe('high');
    expect(plan.gates).toContain('typecheck-clean');
    expect(plan.context).toContain('escalate only when a DNA rule');
  });

  it('marks only build and learning tasks as mutating', () => {
    const plan = planner().plan({ goal: 'Refactor the parser and document the new boundaries' });

    for (const task of plan.tasks) {
      const expected = task.phase === 'build' || task.phase === 'learn';
      expect(task.mutating, `${task.phase} mutating flag`).toBe(expected);
    }
  });

  it('deduplicates participants and caps the debate roster at four', () => {
    const plan = planner().plan({
      goal: 'Architecture review with the team for the new platform',
      dna: DNA_FIXTURE,
    });

    const participants = plan.debate?.participants ?? [];
    expect(participants.length).toBeLessThanOrEqual(4);
    expect(new Set(participants).size).toBe(participants.length);
  });

  it('does not open a build collaboration for a long read-only review prompt', () => {
    const plan = planner().plan({
      goal:
        'Review the repository for correctness, security and regressions, then report the ' +
        'highest risk findings with file and line references. Do not change any files. ' +
        'Read the diff, the tests and the documentation, and explain where the evidence ' +
        'is incomplete so the operator can decide what to fix first in the next cycle.',
      dna: DNA_FIXTURE,
    });

    expect(plan.assessment.needsDebate).toBe(false);
    expect(plan.assessment.needsConversation).toBe(false);
    expect(plan.debate).toBeNull();
    expect(plan.conversation).toBeNull();
    expect(plan.assessment.rationale.join(' ')).toContain('read-only intent');
  });

  it('still opens a debate for a design review that asks for a decision', () => {
    const plan = planner().plan({
      goal: 'Review the architecture and compare approaches before we choose a platform',
      dna: DNA_FIXTURE,
    });

    expect(plan.assessment.needsDebate).toBe(true);
    expect(plan.debate).not.toBeNull();
  });
});
