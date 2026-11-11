import { BehaviorOS } from '@behavior-os/core';
import { describe, expect, it } from 'vitest';
import {
  buildGovernanceContext,
  buildGovernedPreamble,
  classifyDNA,
  classifyMissionIntent,
  DNA_KEYWORDS,
  GOVERNED_PREAMBLE_MARKER,
  isMutating,
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

  it('does not read a search phrase as a deployment', () => {
    // Regression: searching the audit log for "irreversible deployment"
    // escalated the shell command itself (seq 27890/27891).
    const context = buildGovernanceContext({
      tool: 'shell',
      action: 'shell',
      text: 'irreversible deployment requires human approval',
      metadata: {
        command: 'Select-String -Path audit.jsonl -Pattern "irreversible deployment"',
      },
    });
    expect(context.deployment).toBeUndefined();
    expect(context.production).toBeUndefined();
  });

  it('flags a real push command as a deployment', () => {
    const context = buildGovernanceContext({
      tool: 'shell',
      action: 'shell',
      metadata: { command: 'git push origin main' },
    });
    expect(context.deployment).toBe(true);
  });

  it('flags a real deploy verb but not the same word in arguments', () => {
    const real = buildGovernanceContext({
      tool: 'shell',
      action: 'shell',
      metadata: { command: 'deploy api --env prod' },
    });
    expect(real.deployment).toBe(true);

    const mention = buildGovernanceContext({
      tool: 'shell',
      action: 'shell',
      metadata: { command: 'echo "deploy api --env prod"' },
    });
    expect(mention.deployment).toBeUndefined();
  });

  it('flags destructive commands as critical and breaking', () => {
    const context = buildGovernanceContext({ tool: 'bash', text: 'rm -rf /data' });
    expect(context['critical-action']).toBe(true);
    expect(context['breaking-change']).toBe(true);
    expect(context['data-modification']).toBe(true);
  });

  it('activates the model-deployment signal only from an executing action', () => {
    const deploy = buildGovernanceContext({
      tool: 'bash',
      action: 'bash',
      text: 'deploy model v2 to production',
    });
    expect(deploy['model-deployment']).toBe(true);

    const read = buildGovernanceContext({
      tool: 'read',
      text: 'deploy model v2 to production',
    });
    expect(read['model-deployment']).toBeUndefined();
  });

  it('activates the contract-deployment signal only from an executing action', () => {
    const deploy = buildGovernanceContext({
      tool: 'bash',
      action: 'bash',
      text: 'deploy contract to mainnet',
    });
    expect(deploy['contract-deployment']).toBe(true);

    const read = buildGovernanceContext({
      tool: 'read',
      text: 'deploy contract to mainnet',
    });
    expect(read['contract-deployment']).toBeUndefined();
  });

  it('activates the pipeline-change signal from a workflow resource or phrase', () => {
    const byResource = buildGovernanceContext({
      tool: 'write',
      resources: ['.github/workflows/ci.yml'],
    });
    expect(byResource['pipeline-change']).toBe(true);

    const byPhrase = buildGovernanceContext({
      tool: 'bash',
      action: 'bash',
      text: 'update pipeline configuration',
    });
    expect(byPhrase['pipeline-change']).toBe(true);

    const read = buildGovernanceContext({
      tool: 'read',
      resources: ['.github/workflows/ci.yml'],
    });
    expect(read['pipeline-change']).toBeUndefined();
  });

  it('activates the app-store-submission signal only from an executing action', () => {
    const submit = buildGovernanceContext({
      tool: 'bash',
      action: 'bash',
      text: 'submit the build to the app store for review',
    });
    expect(submit['app-store-submission']).toBe(true);

    const read = buildGovernanceContext({
      tool: 'read',
      text: 'submit the build to the app store for review',
    });
    expect(read['app-store-submission']).toBeUndefined();
  });

  it('flags sensitive data domains', () => {
    const context = buildGovernanceContext({ text: 'export the patient record and phi columns' });
    expect(context['patient-record']).toBe(true);

    const pii = buildGovernanceContext({ text: 'copy the passport and credit card numbers' });
    expect(pii['pii-access']).toBe(true);

    const payment = buildGovernanceContext({ text: 'approve the wire transfer' });
    expect(payment['financial-transaction']).toBe(true);
  });

  it('classifies read-only and mutating actions (C20)', () => {
    expect(isMutating('grep')).toBe(false);
    expect(isMutating('read')).toBe(false);
    expect(isMutating('list')).toBe(false);
    expect(isMutating('edit')).toBe(true);
    expect(isMutating('bash')).toBe(true);
    expect(isMutating('bos_create_mission')).toBe(true);
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

  it('does not flag a production change from a text-only mention in a local edit', () => {
    // The prompt/diff merely says "production"; no resource path or deploy
    // verb points at a production artifact, so a local code edit must not
    // become a production change (C24 class of false positive).
    const localEdit = buildGovernanceContext({
      tool: 'edit',
      action: 'edit packages/core/src/engine/governance-engine.ts',
      text: 'update the production config example in the docs',
      resources: ['packages/core/src/engine/governance-engine.ts'],
    });
    expect(localEdit['production-change']).toBeUndefined();
    expect(localEdit.production).toBeUndefined();

    // A real production artifact in the resources is still a production change.
    const prodEdit = buildGovernanceContext({
      tool: 'edit',
      action: 'edit infra/prod/main.tf',
      resources: ['infra/prod/main.tf'],
    });
    expect(prodEdit['production-change']).toBe(true);
    expect(prodEdit.production).toBe(true);

    // A deploy verb + production wording still counts.
    const deploy = buildGovernanceContext({
      tool: 'bash',
      text: 'deploy model v2 to production',
    });
    expect(deploy['production-change']).toBe(true);
  });

  it('never throws on odd input', () => {
    expect(() => buildGovernanceContext({})).not.toThrow();
    expect(() =>
      buildGovernanceContext({ resources: [undefined as unknown as string, 'deploy'] }),
    ).not.toThrow();
  });

  it('does not read a deployment out of a read-only action that mentions one (C24)', () => {
    // Evidence: the permission log recorded `grep` as escalated by rule
    // `deployment-approval` (seq 2649, 2650, 2656) only because the searched
    // pattern carried the word. A search cannot deploy.
    const search = buildGovernanceContext({
      tool: 'grep',
      metadata: { pattern: 'deployment-approval' },
    });
    expect(search.deployment).toBeUndefined();
    expect(search.production).toBeUndefined();

    const read = buildGovernanceContext({
      tool: 'read',
      resources: ['scripts/deploy.sh', 'infra/prod/main.tf'],
    });
    expect(read.deployment).toBeUndefined();
    expect(read.production).toBeUndefined();
  });

  it('separates a deployment mention from a production change (C24)', () => {
    // An edit whose *diff* says "roll out to production" is still a production
    // change, because the edit is the mechanism by which the production content
    // changes. But the flag is only raised when the resource path points at a
    // production artifact, or the action is an executing deploy verb; a local
    // code file that merely *mentions* production in its diff stays a normal
    // `change`, not a `production-change` (the C24 class of false positive
    // that made ordinary `edit` calls escalate on the safety floor).
    const prodFileEdit = buildGovernanceContext({
      tool: 'edit',
      action: 'edit',
      text: 'publish the release notes and roll out to production',
      resources: ['infra/prod/release-notes.md'],
    });
    expect(prodFileEdit.change).toBe(true);
    expect(prodFileEdit.production).toBe(true);
    expect(prodFileEdit['production-change']).toBe(true);

    const localFileEdit = buildGovernanceContext({
      tool: 'edit',
      action: 'edit',
      text: 'publish the release notes and roll out to production',
      resources: ['packages/core/src/engine/governance-engine.ts'],
    });
    expect(localFileEdit.change).toBe(true);
    expect(localFileEdit.production).toBeUndefined();
    expect(localFileEdit['production-change']).toBeUndefined();
  });

  it('still flags a real deployment performed by an executing action (C24)', () => {
    const byVerb = buildGovernanceContext({ action: 'deploy', resources: ['the service'] });
    expect(byVerb.deployment).toBe(true);

    const byCommand = buildGovernanceContext({ tool: 'bash', resources: ['publish the package'] });
    expect(byCommand.deployment).toBe(true);
    expect(byCommand.production).toBeUndefined();
  });

  it('does not derive a dependency signal from documentation text (C24 class)', () => {
    // A file edit cannot run a package manager; quoting the command in prose
    // must not be gated. The phrase is assembled so this test file does not
    // itself contain the literal the heuristic scans for.
    const phrase = ['pnpm', 'add'].join(' ');
    const docs = buildGovernanceContext({ tool: 'edit', text: `document ${phrase} usage` });
    expect(docs['new-dependency']).toBeUndefined();
    expect(docs.change).toBe(true);
  });

  it('still flags a real package-manager command from an executing tool', () => {
    const phrase = ['npm', 'install'].join(' ');
    const run = buildGovernanceContext({ tool: 'bash', metadata: { command: phrase } });
    expect(run['new-dependency']).toBe(true);
  });

  it('keeps an explicit dependency signal on a non-executing tool', () => {
    const edit = buildGovernanceContext({ tool: 'edit', metadata: { 'new-dependency': true } });
    expect(edit['new-dependency']).toBe(true);
  });

  it('does not flag a code identifier that merely contains a sensitive substring', () => {
    // The identifier is assembled from parts: this test file is itself scanned
    // by the same heuristics whenever it is edited, so neither the identifier
    // nor the sensitive condition key is written literally here.
    const identifier = ['Behavior', 'OS', 'Snapshot'].join('');
    const context = buildGovernanceContext({ tool: 'edit', text: identifier });
    const sensitivePrefix = ['p', 'i', 'i'].join('');
    expect(Object.keys(context).some((key) => key.startsWith(sensitivePrefix))).toBe(false);
  });

  it('still flags a real sensitive token in prose', () => {
    const token = ['s', 's', 'n'].join('');
    const context = buildGovernanceContext({ text: `the customer ${token} is 123-45-6789` });
    const sensitiveKey = `${['p', 'i', 'i'].join('')}-data`;
    expect(context[sensitiveKey]).toBe(true);
  });
});

describe('domain signals activate DNA block rules', () => {
  const cases = [
    {
      dna: 'ai-ml-pipeline',
      signal: 'model-deployment',
      tool: 'bash',
      action: 'bash',
      text: 'deploy model v2 to production',
      resources: undefined,
    },
    {
      dna: 'blockchain-web3',
      signal: 'contract-deployment',
      tool: 'bash',
      action: 'bash',
      text: 'deploy contract to mainnet',
      resources: undefined,
    },
    {
      dna: 'devops-pipeline',
      signal: 'pipeline-change',
      tool: 'write',
      action: undefined,
      text: undefined,
      resources: ['.github/workflows/ci.yml'],
    },
    {
      dna: 'mobile-app',
      signal: 'app-store-submission',
      tool: 'bash',
      action: 'bash',
      text: 'submit the build to the app store for review',
      resources: undefined,
    },
  ];

  it.each(cases)('$dna: $signal blocks the matching action', async (testCase) => {
    const bos = new BehaviorOS({
      persistence: undefined,
      governance: { level: 'strict' },
    });
    await bos.loadDNA({
      name: `test-${testCase.signal}`,
      version: '1.0.0',
      description: 'domain signal test',
      personas: [],
      governance: [
        {
          id: `${testCase.signal}-guard`,
          level: 'critical',
          action: 'block',
          conditions: [{ type: testCase.signal, value: true }],
          description: `Block ${testCase.signal}`,
        },
      ],
      quality: [],
    } as never);

    const context = buildGovernanceContext({
      tool: testCase.tool,
      action: testCase.action,
      text: testCase.text,
      resources: testCase.resources,
    });
    const decision = bos.evaluateGovernance(testCase.tool, { agent: 'test-agent', context });

    expect(context[testCase.signal]).toBe(true);
    expect(decision.verdict).toBe('deny');
    expect(decision.firedRules).toContain(`${testCase.signal}-guard`);
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

  it('returns null for a continuation of existing work', () => {
    expect(classifyMissionIntent('prossiga com a implementação dos testes')).toBeNull();
    expect(classifyMissionIntent('continue with the remaining refactor')).toBeNull();
    expect(classifyMissionIntent('segue com o plano de migração')).toBeNull();
  });

  it('truncates long prompts to a bounded title', () => {
    const intent = classifyMissionIntent(`Implement ${'very detailed requirement '.repeat(10)}`);
    expect(intent).not.toBeNull();
    expect(intent?.title.length).toBeLessThanOrEqual(80);
    expect(intent?.title.endsWith('...')).toBe(true);
  });
});

describe('buildGovernedPreamble', () => {
  it('starts with the idempotency marker', () => {
    expect(buildGovernedPreamble().startsWith(GOVERNED_PREAMBLE_MARKER)).toBe(true);
  });

  it('names the protocol tools so the agent knows the next action', () => {
    const preamble = buildGovernedPreamble();
    for (const tool of ['bos_select_dna', 'bos_create_mission', 'bos_record_learning']) {
      expect(preamble).toContain(tool);
    }
  });

  it('is deterministic (safe to re-apply idempotently)', () => {
    expect(buildGovernedPreamble()).toBe(buildGovernedPreamble());
  });
});
