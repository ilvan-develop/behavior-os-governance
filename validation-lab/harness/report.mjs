/**
 * Behavior OS — Intelligence Validation Lab
 * Renders EXPERIMENT_RESULTS.md from artifacts/evidence.json.
 *
 * The report is derived data: every number and every check below is read from
 * the evidence record produced by run.mjs. Nothing is authored by hand.
 *
 * RUN
 *   node validation-lab/harness/report.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, LAB_ROOT } from './lib.mjs';

const evidence = JSON.parse(readFileSync(join(ARTIFACTS, 'evidence.json'), 'utf8'));

const mark = (ok) => (ok ? 'PASS' : 'FAIL');
const cell = (value) => (value === undefined || value === null ? '—' : String(value));

const lines = [];
const push = (...parts) => lines.push(...parts);

const { meta, summary, labs, experiments, unverified, verdict } = evidence;

push(
  '# EXPERIMENT_RESULTS',
  '',
  '> Generated from `validation-lab/artifacts/evidence.json` by `harness/report.mjs`.',
  '> Do not edit by hand: rerun `node validation-lab/harness/run.mjs` then this script.',
  '',
  '## Environment fingerprint',
  '',
  '| Field | Value |',
  '| --- | --- |',
  `| Generated at | ${meta.generatedAt} |`,
  `| Branch / HEAD | ${meta.git.branch} / \`${meta.git.head.slice(0, 8)}\` (${meta.git.headSubject}) |`,
  `| Dirty working tree | ${meta.git.dirtyCount} entries |`,
  `| Node / pnpm / graphify | ${meta.runtime.node} / ${meta.runtime.pnpm} / ${meta.runtime.graphify} |`,
  `| core dist tree SHA-256 | \`${meta.build.coreDistTreeSha256.slice(0, 16)}…\` |`,
  `| orchestrator dist tree SHA-256 | \`${meta.build.orchestratorDistTreeSha256.slice(0, 16)}…\` |`,
  '',
  `**Caveat:** ${meta.caveat}`,
  '',
  '## Summary',
  '',
  `- Labs: **${summary.total}** — PASS ${summary.counts.PASS}, FAIL ${summary.counts.FAIL}, ERROR ${summary.counts.ERROR}, NOT_VERIFIED ${summary.counts.NOT_VERIFIED}`,
  `- Assertions: **${summary.passedChecks}/${summary.checks}** passed, ${summary.failedChecks} failed`,
  `- Verdict: **${verdict.value}**`,
  '',
);
for (const reason of verdict.rationale) push(`  - ${reason}`);
push('');

push('| Lab | Name | Status | Score | Checks | Failed |', '| --- | --- | --- | --- | --- | --- |');
for (const lab of labs) {
  const exp = experiments.filter((e) => lab.experiments.includes(e.id));
  const checks = exp.reduce((n, e) => n + e.checks.length, 0);
  const failed = exp.reduce((n, e) => n + e.checks.filter((c) => !c.ok).length, 0);
  push(`| ${lab.id} | ${lab.name} | ${lab.status} | ${cell(lab.score)} | ${checks} | ${failed} |`);
}
push('');

push('### Dimension scores (audit judgement backed by the checks below)', '');
push(
  '| Lab | Functional 25% | Behavioral 20% | Learning 20% | Governance 15% | Reliability 10% | Evidence 10% |',
  '| --- | --- | --- | --- | --- | --- | --- |',
);
for (const lab of labs) {
  push(
    `| ${lab.id} | ${cell(lab.dims?.functional)} | ${cell(lab.dims?.behavioral)} | ${cell(lab.dims?.learning)} | ${cell(lab.dims?.governance)} | ${cell(lab.dims?.reliability)} | ${cell(lab.dims?.evidence)} |`,
  );
}
push('');

push('## Experiments', '');
for (const exp of experiments) {
  push(
    `### ${exp.id} — ${exp.title}`,
    '',
    `- **Lab:** ${exp.lab}`,
    `- **Status:** ${exp.status}${exp.error ? ` (${exp.error})` : ''}`,
    `- **Duration:** ${exp.durationMs} ms`,
    `- **Hypothesis:** ${exp.hypothesis}`,
    '',
  );
  if (exp.passCriteria.length > 0) {
    push('**Pass criteria**', '');
    for (const c of exp.passCriteria) push(`- ${c}`);
    push('');
  }
  if (exp.failCriteria.length > 0) {
    push('**Fail criteria**', '');
    for (const c of exp.failCriteria) push(`- ${c}`);
    push('');
  }
  if (Object.keys(exp.metrics).length > 0) {
    push('**Metrics**', '');
    push('| Metric | Value |', '| --- | --- |');
    for (const [k, v] of Object.entries(exp.metrics)) push(`| ${k} | ${cell(v)} |`);
    push('');
  }
  push('**Checks**', '');
  push('| Result | Check | Details |', '| --- | --- | --- |');
  for (const check of exp.checks) {
    const { name, ok, ...details } = check;
    const rendered =
      Object.keys(details).length > 0
        ? Object.entries(details)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join('; ')
            .replace(/\|/g, '\\|')
        : '';
    push(`| ${mark(ok)} | ${name.replace(/\|/g, '\\|')} | ${rendered} |`);
  }
  push('');
  if (exp.notes.length > 0) {
    push('**Notes**', '');
    for (const n of exp.notes) push(`- ${n}`);
    push('');
  }
  if (exp.artifacts.length > 0) {
    push('**Artifacts**', '');
    for (const a of exp.artifacts) push(`- \`${a}\``);
    push('');
  }
}

push('## Not verified', '');
for (const lab of unverified) {
  push(
    `### ${lab.id} — ${lab.name}`,
    '',
    `- **Status:** NOT_VERIFIED`,
    `- **Hypothesis:** ${lab.hypothesis}`,
    `- **Why it cannot be verified deterministically:** ${lab.reason}`,
    `- **Protocol to verify:** ${lab.nextStep}`,
    '',
  );
}

push(
  '## Scoring rule',
  '',
  'A lab is scored 0–100 only from executed checks across functional correctness (25%),',
  'behavioral consistency (20%), learning and adaptability (20%), governance and security',
  '(15%), reliability and recovery (10%) and evidence and reproducibility (10%).',
  'Missing evidence is NOT_VERIFIED, never PASS. A failed governance or security',
  'assertion cannot be compensated by a high weighted average.',
  '',
);

const out = join(LAB_ROOT, 'EXPERIMENT_RESULTS.md');
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote ${out}`);
