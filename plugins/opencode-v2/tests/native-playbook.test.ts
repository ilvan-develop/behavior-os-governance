import { describe, expect, it } from 'vitest';
import {
  buildOperatingContract,
  classifyCapabilities,
  NATIVE_COLLAB_REUSE_MS,
  renderCapabilityHints,
  shouldReuseCollaboration,
} from '../src/native-playbook.js';

describe('native operating contract', () => {
  it('maps a fairness/model prompt to the fairness capability', () => {
    const intents = classifyCapabilities(
      'Evaluate the training dataset and model for bias and fairness before the ranking ships',
    );
    const ids = intents.map((intent) => intent.id);

    expect(ids).toContain('fairness');
    expect(ids).toContain('data-assessment');
    expect(intents.find((intent) => intent.id === 'fairness')?.tools).toContain(
      'bos_evaluate_fairness',
    );
  });

  it('maps stack setup to both the CLI scaffold and docs research', () => {
    const ids = classifyCapabilities(
      'Install and scaffold a new Next.js app with shadcn and Postgres',
    ).map((intent) => intent.id);

    expect(ids).toContain('stack-setup');
    expect(ids).toContain('research');
  });

  it('maps architecture prompts to a recorded decision and a brainstorm', () => {
    const ids = classifyCapabilities(
      'Design the architecture and compare two approaches for the billing service',
    ).map((intent) => intent.id);

    expect(ids).toContain('architecture');
    expect(ids).toContain('brainstorm');
  });

  it('does not invent capabilities for a social message', () => {
    expect(classifyCapabilities('hello, thanks')).toEqual([]);
    expect(renderCapabilityHints([])).toBe('');
  });

  it('renders concrete tools for the strongest intents only', () => {
    const intents = classifyCapabilities(
      'Deploy to production with a secret rotation and run the compliance audit',
    );
    const hint = renderCapabilityHints(intents);

    expect(hint).toContain('[Behavior-OS:native]');
    expect(hint).toContain('risk');
    expect(hint).toContain('audit');
    expect(hint.length).toBeLessThan(1200);
  });

  it('states the non-negotiable behaviors in the contract', () => {
    const contract = buildOperatingContract();

    expect(contract).toContain('governed teammate');
    expect(contract).toContain('bos_create_brainstorm');
    expect(contract).toContain('bos_evaluate_fairness');
    expect(contract).toContain('never hand-write generated code');
    expect(contract).toContain('bos_run_audit');
    expect(contract).toContain('bos_record_learning');
  });
});

describe('collaboration reuse policy', () => {
  const now = 1_800_000_000_000;
  const previous = { at: now - 60_000, goalKey: 'design a billing service' };

  it('reuses an artifact for the same normalized intent, even after the short window', () => {
    expect(shouldReuseCollaboration(previous, 'design a billing service', now + 10 * 60_000)).toBe(
      true,
    );
  });

  it('reuses a different intent only inside the short window', () => {
    expect(shouldReuseCollaboration(previous, 'design a search index', now)).toBe(true);
    expect(
      shouldReuseCollaboration(previous, 'design a search index', now + NATIVE_COLLAB_REUSE_MS + 1),
    ).toBe(false);
  });

  it('never reuses a plan older than its TTL or from the future', () => {
    expect(shouldReuseCollaboration(undefined, 'x', now)).toBe(false);
    expect(shouldReuseCollaboration({ at: now - 31 * 60_000, goalKey: 'x' }, 'x', now)).toBe(false);
    expect(shouldReuseCollaboration({ at: now + 60_000, goalKey: 'x' }, 'x', now)).toBe(false);
  });
});
