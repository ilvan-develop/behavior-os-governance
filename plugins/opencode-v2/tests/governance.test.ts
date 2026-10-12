import { describe, expect, it } from 'vitest';
import {
  buildGovernanceContext,
  classifyDNA,
  classifyMissionIntent,
  DNA_KEYWORDS,
} from '../src/governance';

describe('classifyDNA', () => {
  it('maps healthcare language to healthcare-hipaa', () => {
    expect(classifyDNA('Update the patient record handling for HIPAA')).toBe('healthcare-hipaa');
  });

  it('maps deployment language to devops-pipeline', () => {
    expect(classifyDNA('Set up a CI/CD pipeline and rollout process')).toBe('devops-pipeline');
  });

  it('maps trading language to fintech-trading', () => {
    expect(classifyDNA('Reduce latency in the order book matching engine')).toBe('fintech-trading');
  });

  it('returns null for unrelated text', () => {
    expect(classifyDNA('hello there')).toBeNull();
  });

  it('respects the available set of patterns', () => {
    // "patient" would match healthcare-hipaa, but only open-source is allowed.
    expect(classifyDNA('patient data', ['open-source'])).toBeNull();
    expect(classifyDNA('patient data', ['healthcare-hipaa'])).toBe('healthcare-hipaa');
  });

  it('every keyword entry maps to a non-empty list', () => {
    for (const [key, keywords] of Object.entries(DNA_KEYWORDS)) {
      expect(key.length, 'pattern key must not be empty').toBeGreaterThan(0);
      expect(keywords.length, `${key} must have keywords`).toBeGreaterThan(0);
    }
  });
});

describe('buildGovernanceContext', () => {
  it('flags mutating tools as a change', () => {
    const context = buildGovernanceContext({ tool: 'write' });
    expect(context.change).toBe(true);
  });

  it('flags deployment and production from a command', () => {
    const context = buildGovernanceContext({
      tool: 'bash',
      resources: ['deploy to production'],
    });
    expect(context.deployment).toBe(true);
    expect(context.production).toBe(true);
    expect(context['production-change']).toBe(true);
  });

  it('flags destructive commands as critical and breaking', () => {
    const context = buildGovernanceContext({ tool: 'bash', text: 'rm -rf /data' });
    expect(context['critical-action']).toBe(true);
    expect(context['breaking-change']).toBe(true);
    expect(context['data-modification']).toBe(true);
  });

  it('flags sensitive data domains', () => {
    const context = buildGovernanceContext({ text: 'export the patient record and phi columns' });
    expect(context['patient-record']).toBe(true);

    const pii = buildGovernanceContext({ text: 'copy the passport and credit card numbers' });
    expect(pii['pii-access']).toBe(true);

    const payment = buildGovernanceContext({ text: 'approve the wire transfer' });
    expect(payment['financial-transaction']).toBe(true);
  });

  it('carries the action and tool through unchanged', () => {
    const context = buildGovernanceContext({ tool: 'bash', action: 'shell' });
    expect(context.action).toBe('shell');
    expect(context.tool).toBe('bash');
  });

  it('merges metadata without overriding derived signals', () => {
    const context = buildGovernanceContext({
      tool: 'bash',
      metadata: { production: false, custom: 'kept' },
    });
    // Metadata is merged first...
    expect(context.custom).toBe('kept');
    // ...but keyword-derived signals do not override explicit metadata keys.
    expect(context.production).toBe(false);
  });

  it('never throws on odd input', () => {
    expect(() => buildGovernanceContext({})).not.toThrow();
    expect(() =>
      buildGovernanceContext({ resources: [undefined as unknown as string, 'deploy'] }),
    ).not.toThrow();
  });
});

describe('classifyMissionIntent', () => {
  it('classifies an outage as a critical incident', () => {
    const intent = classifyMissionIntent('Investigate the production outage right now');
    expect(intent).not.toBeNull();
    expect(intent?.type).toBe('incident');
    expect(intent?.priority).toBe('critical');
  });

  it('classifies a crash fix as a high-priority bugfix', () => {
    const intent = classifyMissionIntent('Fix the crash in the payment service');
    expect(intent?.type).toBe('bugfix');
    expect(intent?.priority).toBe('high');
  });

  it('classifies a rollout as a deployment', () => {
    const intent = classifyMissionIntent('Rollout the new service to the staging environment');
    expect(intent?.type).toBe('deployment');
  });

  it('classifies an investigation as research', () => {
    const intent = classifyMissionIntent('Investigate how the matching engine behaves under load');
    expect(intent?.type).toBe('research');
  });

  it('defaults substantive prose to a medium feature mission', () => {
    const intent = classifyMissionIntent('We should think carefully about the onboarding journey');
    expect(intent).toMatchObject({ type: 'feature', priority: 'medium' });
  });

  it('returns null for greetings and acknowledgements', () => {
    expect(classifyMissionIntent('hi')).toBeNull();
    expect(classifyMissionIntent('thanks')).toBeNull();
    expect(classifyMissionIntent('ok')).toBeNull();
  });

  it('returns null for short, non-descriptive input', () => {
    expect(classifyMissionIntent('do it')).toBeNull();
    expect(classifyMissionIntent('hey there')).toBeNull();
  });

  it('truncates long prompts to a bounded title', () => {
    const intent = classifyMissionIntent(`Implement ${'very detailed requirement '.repeat(10)}`);
    expect(intent).not.toBeNull();
    expect(intent?.title.length).toBeLessThanOrEqual(80);
    expect(intent?.title.endsWith('...')).toBe(true);
  });
});
