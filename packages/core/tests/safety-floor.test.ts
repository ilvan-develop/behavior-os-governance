import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import {
  classifyIrreversibleAction,
  classifyIrreversibleCommand,
  GovernanceEngine,
} from '../src/engine/governance-engine.js';

const createDNA = (rules: unknown[] = []): DNA => ({
  name: 'Safety Floor Test DNA',
  version: '1.0.0',
  description: 'DNA-relative rules with no deployment guard',
  personas: [],
  governance: rules as DNA['governance'],
  quality: [],
});

describe('classifyIrreversibleAction', () => {
  it('classifies a deploy verb without reading its arguments', () => {
    expect(classifyIrreversibleAction('deploy to production', {})).toBe('deployment');
    expect(classifyIrreversibleAction('publish', {})).toBe('deployment');
    expect(classifyIrreversibleAction('git push origin main', {})).toBe('deployment');
    expect(classifyIrreversibleAction('kubectl apply -f app.yaml', {})).toBe('deployment');
  });

  it('classifies destructive and secret operations', () => {
    expect(classifyIrreversibleAction('delete bucket', {})).toBe('destructive');
    expect(classifyIrreversibleAction('terraform destroy', {})).toBe('deployment');
    expect(classifyIrreversibleAction('secrets export', {})).toBe('secret-exposure');
  });

  it('honours explicit context flags from the host', () => {
    expect(classifyIrreversibleAction('bash', { deployment: true })).toBe('deployment');
    expect(classifyIrreversibleAction('bash', { 'production-change': true })).toBe(
      'production-change',
    );
  });

  it('a production-change flag alone never escalates a read-only tool (C24)', () => {
    // The host derives `production-change: true` from any non-read-only action
    // whose *text* mentions "production". A read-only tool that merely
    // mentions "production" in its arguments must not become a production
    // change.
    expect(classifyIrreversibleAction('grep', { 'production-change': true })).toBeNull();
    expect(classifyIrreversibleAction('read-file', { production: true })).toBeNull();
    expect(classifyIrreversibleAction('inspect', { 'production-change': true })).toBeNull();
    // A write action with the flag is still a production change.
    expect(classifyIrreversibleAction('edit', { 'production-change': true })).toBe(
      'production-change',
    );
  });

  it('does not read an irreversible intent out of a read-only action (C24)', () => {
    expect(classifyIrreversibleAction('grep', {})).toBeNull();
    expect(classifyIrreversibleAction('read-file', {})).toBeNull();
    expect(classifyIrreversibleAction('edit', {})).toBeNull();
  });
});

describe('GovernanceEngine safety floor', () => {
  it('escalates an irreversible action even when the DNA has no rule at all', () => {
    const engine = new GovernanceEngine(createDNA());

    const decision = engine.evaluate({
      action: 'deploy to production',
      agentId: 'agent-1',
      context: {},
    });

    expect(decision.verdict).toBe('escalate');
    expect(decision.reason).toContain('safety floor');
    expect(decision.rulesEvaluated).toContain('safety-floor');
    expect(decision.firedRules).toContain('safety-floor');
  });

  it('lets a DNA deny win over the floor', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'sterile-field',
          level: 'critical',
          action: 'block',
          conditions: [{ type: 'production', value: true }],
        },
      ]),
    );

    const decision = engine.evaluate({
      action: 'deploy to production',
      agentId: 'agent-1',
      context: { production: true },
    });

    expect(decision.verdict).toBe('deny');
    expect(decision.reason).toContain('sterile-field');
  });

  it('does not downgrade or relabel an existing DNA escalation', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'change-control',
          level: 'high',
          action: 'escalate',
          conditions: [{ type: 'production-change', value: true }],
        },
      ]),
    );

    const decision = engine.evaluate({
      action: 'deploy to production',
      agentId: 'agent-1',
      context: { 'production-change': true },
    });

    expect(decision.verdict).toBe('escalate');
    expect(decision.reason).toContain('change-control');
    expect(decision.rulesEvaluated).not.toContain('safety-floor');
  });

  it('leaves read-only actions that merely mention deployment alone', () => {
    const engine = new GovernanceEngine(createDNA());

    const decision = engine.evaluate({
      action: 'grep',
      agentId: 'agent-1',
      context: {},
    });

    expect(decision.verdict).toBe('allow');
    expect(decision.rulesEvaluated).not.toContain('safety-floor');
  });

  it('escalates a shell action the host flagged as a deployment', () => {
    const engine = new GovernanceEngine(createDNA());

    const decision = engine.evaluate({
      action: 'bash',
      agentId: 'agent-1',
      context: { deployment: true },
    });

    expect(decision.verdict).toBe('escalate');
    expect(decision.reason).toContain('deployment');
  });

  it('degrades to a warning when the active DNA opts out with a `warn` rule', () => {
    const engine = new GovernanceEngine(
      createDNA([
        {
          id: 'git-release-warn',
          level: 'high',
          action: 'warn',
          conditions: [{ type: 'tool', value: 'shell' }],
        },
      ]),
    );

    const decision = engine.evaluate({
      action: 'git push origin main',
      agentId: 'agent-1',
      context: { tool: 'shell' },
    });

    // The floor still registers as a fired rule and adds its warning, but the
    // DNA's `warn` opt-out keeps the verdict at `allow` instead of `escalate`.
    expect(decision.verdict).toBe('allow');
    expect(decision.firedRules).toContain('safety-floor');
    expect(decision.firedRules).toContain('git-release-warn');
    expect(decision.warnings?.join(' ')).toContain('opts out of escalation');
  });

  it('keeps the floor on cached decisions', () => {
    const engine = new GovernanceEngine(createDNA());
    const request = {
      action: 'publish',
      agentId: 'agent-1',
      context: {},
    };

    expect(engine.evaluate(request).verdict).toBe('escalate');
    expect(engine.evaluate(request).verdict).toBe('escalate');
  });
});

describe('classifyIrreversibleCommand', () => {
  it('finds irreversible operations at the command position', () => {
    expect(classifyIrreversibleCommand('git push origin main')).toBe('deployment');
    expect(classifyIrreversibleCommand('sudo kubectl delete pod api')).toBe('destructive');
    expect(classifyIrreversibleCommand('npm run build && pnpm publish --access public')).toBe(
      'deployment',
    );
    expect(classifyIrreversibleCommand('terraform destroy -auto-approve')).toBe('destructive');
    expect(classifyIrreversibleCommand('docker system prune -af')).toBe('destructive');
  });

  it('does not read an operation out of an argument or a search', () => {
    expect(classifyIrreversibleCommand('grep -r "git push" docs/')).toBeNull();
    expect(classifyIrreversibleCommand('echo "deploy"')).toBeNull();
    expect(classifyIrreversibleCommand('git log --grep=deploy')).toBeNull();
  });

  it('scans an execution-tool command but never read-only arguments', () => {
    expect(
      classifyIrreversibleAction('bash', { tool: 'bash', command: 'git push origin main' }),
    ).toBe('deployment');
    expect(classifyIrreversibleAction('grep', { args: ['git push origin main'] })).toBeNull();
  });

  it('escalates through the engine when the operation is embedded in a shell command', () => {
    const engine = new GovernanceEngine(createDNA());

    const decision = engine.evaluate({
      action: 'bash',
      agentId: 'agent-1',
      context: { tool: 'bash', command: 'kubectl delete deployment api' },
    });

    expect(decision.verdict).toBe('escalate');
    expect(decision.rulesEvaluated).toContain('safety-floor');
  });

  it('classifies nested interpreter payloads', () => {
    expect(classifyIrreversibleCommand('bash -c "git push origin main"')).toBe('deployment');
    expect(classifyIrreversibleCommand("sh -c 'kubectl delete pod api'")).toBe('destructive');
    expect(classifyIrreversibleCommand('cmd /c "del C:\\\\data"')).toBe('destructive');
    expect(classifyIrreversibleCommand('pwsh -Command "Remove-Item ./dist -Recurse"')).toBe(
      'destructive',
    );
    expect(classifyIrreversibleCommand('eval "terraform apply -auto-approve"')).toBe('deployment');
  });

  it('keeps a nested read-only payload read-only and bounds recursion', () => {
    expect(classifyIrreversibleCommand('bash -c "grep -r deploy docs"')).toBeNull();

    let nested = 'git push';
    for (let i = 0; i < 5; i += 1) nested = `bash -c "${nested}"`;
    expect(classifyIrreversibleCommand(nested)).toBeNull();
  });
});
