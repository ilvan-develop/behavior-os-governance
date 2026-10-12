import { describe, expect, it } from 'vitest';
import { buildGovernanceContext, classifyDNA, DNA_KEYWORDS } from '../src/governance';

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
