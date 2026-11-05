import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { BehaviorOS, type BehaviorOSSnapshot } from '../src/engine/behavior-os.js';
import {
  POLICY_APPROVAL_KEY_ENV,
  type PolicyActor,
  policyApprovalPayload,
} from '../src/engine/learning-engine.js';

const HUMAN: PolicyActor = { id: 'human:alice', kind: 'human' };
const LLM: PolicyActor = { id: 'deepseek-v4', kind: 'llm' };
const AGENT: PolicyActor = { id: 'agent-audit', kind: 'agent' };

const ENFORCEMENT_DNA: DNA = {
  name: 'Policy Enforcement DNA',
  version: '1.0.0',
  description: 'Minimal DNA used to prove active-policy enforcement',
  personas: [{ role: 'operator', name: 'Operator', authority: 'operator', skills: ['execute'] }],
  governance: [],
  quality: [],
};

function candidate(
  bos: BehaviorOS,
  policyId = 'policy:test-one',
  content = 'Never deploy on Friday.',
) {
  const result = bos.createPolicyCandidate({
    policyId,
    content,
    source: 'test',
    actor: AGENT,
    reason: 'observed repeated Friday incidents',
  });
  if (!result.ok) throw new Error(result.message);
  return result.version;
}

function activatedPolicy(bos: BehaviorOS, policyId = 'policy:test-one') {
  const version = candidate(bos, policyId);
  const validation = bos.validatePolicyVersion(policyId, version.versionId, { actor: AGENT });
  if (!validation.ok) throw new Error(validation.message);
  const approval = bos.approvePolicyVersion(policyId, version.versionId, {
    actor: HUMAN,
    rationale: 'Reviewed the evidence and accept the rule.',
  });
  if (!approval.ok) throw new Error(approval.message);
  const activation = bos.activatePolicyVersion(policyId, version.versionId, {
    actor: HUMAN,
    reason: 'Approved for production rollout',
  });
  if (!activation.ok) throw new Error(activation.message);
  return version;
}

function promoteToPolicy(bos: BehaviorOS) {
  const record = bos.createLearningRecord({
    title: 'Friday deployments correlate with incidents',
    content: 'Three Friday deploys caused rollbacks; freeze the window.',
    source: 'mission:s2-test',
    impact: 'high',
  });
  const evidence = ['incident-1', 'incident-2'];
  bos.advanceLearningRecord(record.id, 'lesson', {});
  bos.advanceLearningRecord(record.id, 'candidate', {});
  bos.advanceLearningRecord(record.id, 'validated', { evidence });
  bos.advanceLearningRecord(record.id, 'policy', { evidence });
  return record;
}

describe('Governed policy versioning (Sprint 2)', () => {
  const tempDirs: string[] = [];
  const persisted: BehaviorOS[] = [];
  afterEach(() => {
    for (const bos of persisted.splice(0)) bos.closeStore();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates an immutable, hash-addressed candidate version', () => {
    const bos = new BehaviorOS();
    const first = candidate(bos);
    expect(first.version).toBe(1);
    expect(first.versionId).toBe('policy:test-one@1');
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.provenance.actor).toBe(AGENT.id);
    expect(first.provenance.source).toBe('test');

    const second = candidate(bos, 'policy:test-one', 'Never deploy on Friday or Monday.');
    expect(second.version).toBe(2);
    const history = bos.getPolicyVersions('policy:test-one');
    expect(history).toHaveLength(2);
    // Version 1 is untouched by version 2.
    expect(history[0]).toEqual(first);
  });

  it('rejects candidates without a stable identity or content', () => {
    const bos = new BehaviorOS();
    expect(bos.createPolicyCandidate({ content: 'rule', actor: AGENT }).ok).toBe(false);
    expect(bos.createPolicyCandidate({ policyId: 'p', content: '   ', actor: AGENT }).ok).toBe(
      false,
    );
    expect(
      bos.createPolicyCandidate({
        policyId: 'p',
        learningId: 'missing',
        content: 'rule',
        actor: AGENT,
      }).ok,
    ).toBe(false);
  });

  it('binds validation to the exact version content hash', () => {
    const bos = new BehaviorOS();
    const version = candidate(bos);
    const validation = bos.validatePolicyVersion('policy:test-one', version.versionId, {
      actor: AGENT,
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.validation.valid).toBe(true);
      expect(validation.validation.contentHash).toBe(version.contentHash);
    }
  });

  it('detects a tampered version through the content hash', () => {
    const bos = new BehaviorOS();
    const version = candidate(bos);
    const snapshot = bos.exportState() as BehaviorOSSnapshot;
    const ledger = snapshot.policyLedger;
    if (!ledger) throw new Error('expected a policy ledger');
    ledger.versions[0].content = 'Tampered content';

    const target = new BehaviorOS();
    expect(target.importState(snapshot)).toBe(true);
    const validation = target.validatePolicyVersion('policy:test-one', version.versionId, {
      actor: AGENT,
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.validation.valid).toBe(false);
      expect(validation.validation.issues.join(' ')).toContain('Content hash mismatch');
    }
    // A failed validation can never unlock approval.
    expect(
      target.approvePolicyVersion('policy:test-one', version.versionId, {
        actor: HUMAN,
        rationale: 'Trying to approve a tampered version.',
      }).ok,
    ).toBe(false);
  });

  it('refuses approval without a passing validation', () => {
    const bos = new BehaviorOS();
    const version = candidate(bos);
    const approval = bos.approvePolicyVersion('policy:test-one', version.versionId, {
      actor: HUMAN,
      rationale: 'Looks good to me, approved.',
    });
    expect(approval.ok).toBe(false);
    if (!approval.ok) expect(approval.code).toBe('VALIDATION_REQUIRED');
    expect(bos.getPolicyApproval(version.versionId)).toBeUndefined();
  });

  it('never lets an LLM or an agent approve a version', () => {
    const bos = new BehaviorOS();
    const version = candidate(bos);
    bos.validatePolicyVersion('policy:test-one', version.versionId, { actor: AGENT });

    for (const actor of [LLM, AGENT]) {
      const approval = bos.approvePolicyVersion('policy:test-one', version.versionId, {
        actor,
        rationale: 'Automated approval attempt.',
      });
      expect(approval.ok).toBe(false);
      if (!approval.ok) expect(approval.code).toBe('HUMAN_APPROVAL_REQUIRED');
    }
    expect(bos.getPolicyApproval(version.versionId)).toBeUndefined();
    expect(
      bos
        .getGovernanceLog(50)
        .some((event) => event.action === 'policy:approval-rejected' && event.outcome === 'deny'),
    ).toBe(true);
  });

  it('never lets an LLM activate and requires human approval', () => {
    const bos = new BehaviorOS();
    const version = candidate(bos);
    bos.validatePolicyVersion('policy:test-one', version.versionId, { actor: AGENT });

    const llmActivation = bos.activatePolicyVersion('policy:test-one', version.versionId, {
      actor: LLM,
    });
    expect(llmActivation.ok).toBe(false);
    if (!llmActivation.ok) expect(llmActivation.code).toBe('HUMAN_APPROVAL_REQUIRED');

    const missingApproval = bos.activatePolicyVersion('policy:test-one', version.versionId, {
      actor: HUMAN,
    });
    expect(missingApproval.ok).toBe(false);
    if (!missingApproval.ok) expect(missingApproval.code).toBe('APPROVAL_REQUIRED');
    expect(bos.getActivePolicyVersion('policy:test-one')).toBeUndefined();
  });

  it('activates only a validated and human-approved version', () => {
    const bos = new BehaviorOS();
    const version = activatedPolicy(bos);

    expect(bos.getActivePolicyVersion('policy:test-one')).toEqual(version);
    expect(bos.getPolicyStatus('policy:test-one', version.versionId)).toBe('active');
    const activations = bos.getPolicyActivations('policy:test-one');
    expect(activations).toHaveLength(1);
    expect(activations[0].action).toBe('activated');
    expect(activations[0].basis).toBe('governed');
    expect(bos.getGovernanceLog(50).some((event) => event.action === 'policy:activated')).toBe(
      true,
    );
  });

  it('deactivates without deleting history and requires a human', () => {
    const bos = new BehaviorOS();
    const version = activatedPolicy(bos);

    expect(
      bos.deactivatePolicy('policy:test-one', { actor: AGENT, reason: 'automated attempt' }).ok,
    ).toBe(false);
    expect(bos.deactivatePolicy('policy:test-one', { actor: HUMAN, reason: 'short' }).ok).toBe(
      false,
    );

    const result = bos.deactivatePolicy('policy:test-one', {
      actor: HUMAN,
      reason: 'Freeze lifted after review',
    });
    expect(result.ok).toBe(true);
    expect(bos.getActivePolicyVersion('policy:test-one')).toBeUndefined();
    expect(bos.getPolicyVersions('policy:test-one')).toHaveLength(1);
    expect(bos.getPolicyVersion('policy:test-one', version.versionId)).toBeDefined();
    expect(bos.getPolicyStatus('policy:test-one', version.versionId)).toBe('retired');
  });

  it('rolls back to a previously approved version with an audit trail', () => {
    const bos = new BehaviorOS();
    const v1 = activatedPolicy(bos);
    const v2 = candidate(bos, 'policy:test-one', 'Never deploy on Friday, Monday or holidays.');
    bos.validatePolicyVersion('policy:test-one', v2.versionId, { actor: AGENT });
    bos.approvePolicyVersion('policy:test-one', v2.versionId, {
      actor: HUMAN,
      rationale: 'Expanded freeze window approved.',
    });
    bos.activatePolicyVersion('policy:test-one', v2.versionId, { actor: HUMAN });
    expect(bos.getActivePolicyVersion('policy:test-one')?.versionId).toBe(v2.versionId);

    const rollback = bos.rollbackPolicy('policy:test-one', v1.versionId, {
      actor: HUMAN,
      reason: 'Reverting the expanded window after review',
    });
    expect(rollback.ok).toBe(true);
    expect(bos.getActivePolicyVersion('policy:test-one')?.versionId).toBe(v1.versionId);

    const activations = bos.getPolicyActivations('policy:test-one');
    const last = activations[activations.length - 1];
    expect(last.action).toBe('rolled-back');
    expect(last.fromVersionId).toBe(v2.versionId);
    expect(last.reason).toContain('Reverting');
    // Both versions remain in the immutable history.
    expect(bos.getPolicyVersions('policy:test-one')).toHaveLength(2);
  });

  it('refuses a rollback target without a passing validation', () => {
    const bos = new BehaviorOS();
    activatedPolicy(bos);
    const unvalidated = candidate(bos, 'policy:test-one', 'A second, unvalidated rule.');
    const rollback = bos.rollbackPolicy('policy:test-one', unvalidated.versionId, {
      actor: HUMAN,
      reason: 'Trying to roll back to an unvalidated rule',
    });
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.code).toBe('VALIDATION_REQUIRED');
  });

  it('monitors only the active version', () => {
    const bos = new BehaviorOS();
    expect(bos.monitorPolicy('policy:test-one', { actor: AGENT, success: true }).ok).toBe(false);

    activatedPolicy(bos);
    const ok = bos.monitorPolicy('policy:test-one', {
      actor: AGENT,
      success: true,
      detail: 'no violations observed',
    });
    expect(ok.ok).toBe(true);
    const failed = bos.monitorPolicy('policy:test-one', {
      actor: AGENT,
      success: false,
      detail: 'one violation observed',
    });
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.monitoring.checks).toBe(2);
      expect(failed.monitoring.failures).toBe(1);
    }
    expect(bos.getPolicyLedgerEvents('policy:test-one').map((event) => event.type)).toContain(
      'monitor-failed',
    );
  });

  it('round-trips the ledger through exportState/importState', () => {
    const bos = new BehaviorOS();
    const version = activatedPolicy(bos);
    const snapshot = bos.exportState();
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow();

    const restored = new BehaviorOS();
    expect(restored.importState(snapshot)).toBe(true);
    expect(restored.getActivePolicyVersion('policy:test-one')?.versionId).toBe(version.versionId);
    expect(restored.getPolicyVersions('policy:test-one')).toHaveLength(1);
    expect(restored.getPolicyStatus('policy:test-one', version.versionId)).toBe('active');
    expect(restored.getPolicyLedgerEvents('policy:test-one').map((event) => event.type)).toEqual(
      bos.getPolicyLedgerEvents('policy:test-one').map((event) => event.type),
    );
  });

  it('auto-creates an inactive candidate when a record enters the policy stage', () => {
    const bos = new BehaviorOS();
    const record = promoteToPolicy(bos);
    const policyId = `policy:${record.id}`;
    const versions = bos.getPolicyVersions(policyId);
    expect(versions).toHaveLength(1);
    expect(versions[0].learningId).toBe(record.id);
    expect(bos.getActivePolicyVersion(policyId)).toBeUndefined();
    expect(bos.getPolicyStatus(policyId, versions[0].versionId)).toBe('candidate');
  });

  it('imports legacy policy-stage records as an active baseline version', () => {
    const bos = new BehaviorOS();
    const record = promoteToPolicy(bos);
    const snapshot = bos.exportState() as BehaviorOSSnapshot;
    const legacySnapshot: BehaviorOSSnapshot = { ...snapshot };
    delete legacySnapshot.policyLedger;

    const legacy = new BehaviorOS();
    expect(legacy.importState(legacySnapshot)).toBe(true);
    const policyId = `policy:${record.id}`;
    const active = legacy.getActivePolicyVersion(policyId);
    expect(active).toBeDefined();
    const activations = legacy.getPolicyActivations(policyId);
    expect(activations[0].basis).toBe('legacy-import');
    expect(
      legacy.getPolicyLedgerEvents(policyId).some((event) => event.type === 'legacy-imported'),
    ).toBe(true);
  });

  it('persists the ledger in the existing meta table across a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-policy-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'policy.sqlite');

    const first = new BehaviorOS({ persistence: { path: dbPath } });
    persisted.push(first);
    const version = activatedPolicy(first);

    const second = new BehaviorOS({ persistence: { path: dbPath } });
    persisted.push(second);
    expect(second.getActivePolicyVersion('policy:test-one')?.versionId).toBe(version.versionId);
    expect(second.getPolicyStatus('policy:test-one', version.versionId)).toBe('active');
    expect(second.getPolicyVersions('policy:test-one')).toHaveLength(1);
    expect(second.getPolicyApproval(version.versionId)?.approvedBy).toBe(HUMAN.id);
  });

  it('enforces only an active, human-approved policy at the governance choke point', async () => {
    const bos = new BehaviorOS();
    await bos.loadDNA(ENFORCEMENT_DNA);
    const version = bos.createPolicyCandidate({
      policyId: 'policy:no-friday-deploy',
      content: 'Deployments must not start on Friday after 12:00 UTC.',
      actor: AGENT,
      enforcement: {
        action: 'block',
        match: 'deploy',
        severity: 'critical',
        description: 'Friday deploy freeze is active',
      },
    });
    if (!version.ok) throw new Error(version.message);

    // A candidate is documentation only; it cannot influence a decision.
    expect(bos.evaluateGovernance('deploy production', { agent: AGENT.id }).verdict).not.toBe(
      'deny',
    );

    bos.validatePolicyVersion('policy:no-friday-deploy', version.version.versionId, {
      actor: AGENT,
    });
    bos.approvePolicyVersion('policy:no-friday-deploy', version.version.versionId, {
      actor: HUMAN,
      rationale: 'Freeze approved after the incident review.',
    });

    // Approved but inactive still has no enforcement power.
    expect(bos.evaluateGovernance('deploy production', { agent: AGENT.id }).verdict).not.toBe(
      'deny',
    );

    const activation = bos.activatePolicyVersion(
      'policy:no-friday-deploy',
      version.version.versionId,
      { actor: HUMAN, reason: 'Rolling out the freeze for the quarter' },
    );
    expect(activation.ok).toBe(true);

    const blocked = bos.evaluateGovernance('deploy production', { agent: AGENT.id });
    expect(blocked.verdict).toBe('deny');
    expect(blocked.reason).toContain('Active policy');
    expect(blocked.reason).toContain('Friday deploy freeze is active');
    expect(blocked.rulesEvaluated).toContain(`policy:${version.version.versionId}`);
    expect(blocked.firedRules).toContain(`policy:${version.version.versionId}`);

    // Non-matching actions are untouched.
    expect(bos.evaluateGovernance('read the audit log', { agent: AGENT.id }).verdict).toBe('allow');

    // The status surface exposes the active policy to every host.
    expect(bos.getStatus().policies).toEqual({
      active: 1,
      ids: [version.version.versionId],
      enforced: 1,
    });

    // Deactivation removes the effect while keeping the immutable history.
    expect(
      bos.deactivatePolicy('policy:no-friday-deploy', {
        actor: HUMAN,
        reason: 'Freeze lifted after the quarter ended',
      }).ok,
    ).toBe(true);
    expect(bos.evaluateGovernance('deploy production', { agent: AGENT.id }).verdict).not.toBe(
      'deny',
    );
    expect(bos.getStatus().policies).toEqual({ active: 0, ids: [], enforced: 0 });
  });

  it('requires an HMAC approval token when an approval key is configured', () => {
    const key = 'test-approval-key-2026';
    const previous = process.env[POLICY_APPROVAL_KEY_ENV];
    process.env[POLICY_APPROVAL_KEY_ENV] = key;
    try {
      const bos = new BehaviorOS();
      const version = candidate(bos);
      bos.validatePolicyVersion('policy:test-one', version.versionId, { actor: AGENT });
      const rationale = 'Reviewed the ledger and accept this rule.';

      const missing = bos.approvePolicyVersion('policy:test-one', version.versionId, {
        actor: HUMAN,
        rationale,
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('APPROVAL_TOKEN_REQUIRED');

      const invalid = bos.approvePolicyVersion('policy:test-one', version.versionId, {
        actor: HUMAN,
        rationale,
        approvalToken: 'not-the-right-token',
      });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.code).toBe('APPROVAL_TOKEN_INVALID');

      const token = createHmac('sha256', key)
        .update(policyApprovalPayload(version, rationale))
        .digest('hex');
      const approved = bos.approvePolicyVersion('policy:test-one', version.versionId, {
        actor: HUMAN,
        rationale,
        approvalToken: token,
      });
      expect(approved.ok).toBe(true);
      if (approved.ok) expect(approved.approval.verification).toBe('hmac');
      expect(bos.getPolicyApproval(version.versionId)?.verification).toBe('hmac');
    } finally {
      if (previous === undefined) delete process.env[POLICY_APPROVAL_KEY_ENV];
      else process.env[POLICY_APPROVAL_KEY_ENV] = previous;
    }
  });
});
