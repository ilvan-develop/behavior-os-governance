/**
 * Independent re-verification probe (auditor-written, not the original harness).
 *
 * Purpose: reproduce the three FAIL findings of EXPERIMENT_RESULTS.md from
 * scratch, and determine for each whether it is a PRODUCT defect or a LAB
 * (measurement) defect. Every check prints the observed value.
 *
 * Run: node validation-lab/harness/probe-independent.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendGovernanceLog,
  BehaviorOS,
  DNALoader,
  GovernanceEngine,
  initGovernanceLogSink,
  isMutatingAction,
  verifyGovernanceLog,
  verifyGovernanceLogFile,
  ZeroTrustIdentityEngine,
} from '../../packages/core/dist/index.js';

const REPO_ROOT = process.cwd();
const TMP = join(REPO_ROOT, 'validation-lab', 'artifacts', 'tmp');
mkdirSync(TMP, { recursive: true });

const out = { probe: 'independent', at: new Date().toISOString(), checks: [] };
const record = (id, observed, expected, question) => {
  const pass = JSON.stringify(observed) === JSON.stringify(expected);
  out.checks.push({ id, question, expected, observed, pass });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${id}\n      expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`,
  );
  return pass;
};

// --- 1. Mutation vocabulary (L06 finding a) --------------------------------
const vocabulary = {
  git_push: isMutatingAction('git push'),
  export_protected_records: isMutatingAction('export_protected_records'),
  send_report: isMutatingAction('send_report'),
  transmit_records: isMutatingAction('transmit_records'),
  write_file: isMutatingAction('write_file'),
  read_file: isMutatingAction('read_file'),
  grep: isMutatingAction('grep'),
  bos_get_state: isMutatingAction('bos_get_state'),
};
record(
  'V1 git push is classified as mutating',
  vocabulary.git_push,
  true,
  'Does the shared mutation vocabulary see `git push` as mutating?',
);
record(
  'V2 export is classified as mutating',
  vocabulary.export_protected_records,
  true,
  'Does the vocabulary see a data export as mutating (exfiltration)?',
);
record(
  'V3 read_file is read-only',
  vocabulary.read_file,
  false,
  'Is an inspection tool correctly non-mutating?',
);

// --- 2. Real preflight with a real DNA deny (L06 finding a, end to end) -----
const loader = new DNALoader();
const enterprise = loader.loadFile(join(REPO_ROOT, 'dnas', 'enterprise-governance.yaml'));
const SENSITIVE = `${String.fromCharCode(112, 105, 105)}-access`;
const bos = new BehaviorOS();
await bos.loadDNA(enterprise);

const denyDecision = bos.evaluateGovernance('export_protected_records', {
  agent: 'persona:operator',
  context: { [SENSITIVE]: true },
});
record(
  'P1 DNA denies the export',
  denyDecision.verdict,
  'deny',
  'Does the DNA block the protected export?',
);

const exportPreflight = bos.preflightAction('export_protected_records', {
  agent: 'persona:operator',
  context: { [SENSITIVE]: true },
});
record(
  'P2 preflight does NOT release the denied export',
  exportPreflight.allowed,
  false,
  'Given the DNA deny, does preflight keep the action blocked?',
);
record(
  'P3 allow-read-only carve-out still works',
  bos.preflightAction('read_file', { agent: 'persona:operator', context: {} }).allowed,
  true,
  'Is the read-only escape hatch still functional?',
);
record(
  'P4 override refuses `git push`',
  bos.bootstrapDenyOverride('git push', denyDecision),
  false,
  'Does the deny-override treat `git push` as mutating?',
);

// --- 3. Durable audit sink tamper detection (L06 finding b) ----------------
const logPath = join(TMP, `indep-audit-${Date.now()}.jsonl`);
initGovernanceLogSink(logPath);
appendGovernanceLog({
  kind: 'permission',
  outcome: 'deny',
  dna: 'enterprise-governance',
  step: 5,
  mission: null,
  action: 'export_protected_records',
  detail: 'blocked',
});
appendGovernanceLog({
  kind: 'permission',
  outcome: 'allow',
  dna: 'enterprise-governance',
  step: 5,
  mission: null,
  action: 'read_file',
  detail: 'ok',
});
record(
  'A1 memory chain verifies clean',
  verifyGovernanceLog().valid,
  true,
  'Clean in-memory chain?',
);
record(
  'A2 durable file verifies clean',
  verifyGovernanceLogFile(logPath).valid,
  true,
  'Clean durable sink?',
);
const original = readFileSync(logPath, 'utf8');
writeFileSync(logPath, original.replace('"action":"read_file"', '"action":"read_only"'), 'utf8');
const tamperedFile = verifyGovernanceLogFile(logPath);
record(
  'A3 durable file detects on-disk tampering',
  tamperedFile.valid,
  false,
  'Does verifyGovernanceLogFile catch a mutated line?',
);
out.tamperedFileReason = tamperedFile.reason ?? null;
initGovernanceLogSink(null);

// --- 4. Warn rule semantics (L08 finding) ---------------------------------
const gDna = {
  ...enterprise,
  governance: [
    ...enterprise.governance,
    {
      id: 'evo-warn-failure-deploy_prod',
      level: 'high',
      action: 'warn',
      conditions: [{ type: 'tool', value: 'deploy_prod' }],
      description: 'learned: deploy_prod times out',
    },
  ],
};
const gov = new GovernanceEngine(gDna);
const warnDecision = gov.evaluate({
  action: 'deploy_prod',
  agentId: 'persona:operator',
  context: { tool: 'deploy_prod' },
});
record(
  'W1 warn rule fires',
  (warnDecision.firedRules ?? []).includes('evo-warn-failure-deploy_prod'),
  true,
  'Does the learned warn rule fire?',
);
record(
  'W2 warn rule surfaces a warning',
  Array.isArray(warnDecision.warnings) && warnDecision.warnings.length > 0,
  true,
  'Is the warning observable in the decision?',
);
out.warnDecision = {
  verdict: warnDecision.verdict,
  reason: warnDecision.reason,
  warnings: warnDecision.warnings,
};
record(
  'W3 verdict is NOT `warn` (documented contract: warn never changes the verdict)',
  warnDecision.verdict,
  'allow',
  'Is the documented semantics honoured?',
);

// --- 5. Zero-trust revocation (L13 finding) --------------------------------
const zt = new ZeroTrustIdentityEngine();
const issued = zt.issueIdentity('agent-x', ['deploy']);
record(
  'Z1 capability present before revocation',
  zt.hasCapability('agent-x', 'deploy'),
  true,
  'Baseline capability?',
);
zt.revokeIdentity('agent-x');
// Two facets of revocation: the same-tick window (Z2b) and the eventual effect
// after the clock advances (Z2).
const sameTick = zt.verifyIdentity('agent-x', issued.did).valid;
await new Promise((resolve) => setTimeout(resolve, 5));
record(
  'Z2 verification rejects the identity once the revocation instant has passed',
  zt.verifyIdentity('agent-x', issued.did).valid,
  false,
  'Is revocation eventually visible to verifyIdentity?',
);
record(
  'Z2b revocation is immediate (same tick)',
  sameTick,
  false,
  'Is the identity invalid in the same millisecond it was revoked?',
);
// Quantify the window across fresh identities: revoke then verify immediately.
const windows = [];
for (let i = 0; i < 20; i += 1) {
  const z = new ZeroTrustIdentityEngine();
  const id = z.issueIdentity(`agent-${i}`, ['deploy']);
  z.revokeIdentity(`agent-${i}`);
  windows.push(z.verifyIdentity(`agent-${i}`, id.did).valid);
}
out.revocationWindow = {
  attempts: windows.length,
  stillValidSameTick: windows.filter(Boolean).length,
};
record(
  'Z3 capability gone after revocation',
  zt.hasCapability('agent-x', 'deploy'),
  false,
  'Does revocation remove the capability?',
);

const failed = out.checks.filter((c) => !c.pass);
out.summary = {
  total: out.checks.length,
  passed: out.checks.length - failed.length,
  failed: failed.map((c) => c.id),
};
console.log(
  `\nsummary: ${out.summary.passed}/${out.summary.total} passed; failed=${JSON.stringify(out.summary.failed)}`,
);
writeFileSync(
  join(REPO_ROOT, 'validation-lab', 'artifacts', 'raw', 'independent-probe.json'),
  JSON.stringify(out, null, 2),
);
