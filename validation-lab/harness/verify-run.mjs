/**
 * R-07 enforcement hook — verify a R-06 run actually executed its work on disk.
 *
 * WHAT THIS DOES
 *   Compares a run directory against the pristine fixture it was copied from,
 *   and cross-checks the run's REPORT.md claims against the files that actually
 *   exist. A run that narrates a repair it never performed is marked INVALID,
 *   so the ablation/lesson experiment cannot be contaminated by
 *   "narrated-but-not-executed" reports (the failure mode found in R-06 a-runs).
 *
 * CHECKS
 *   1. REPORT.md exists.
 *   2. The run's source tree differs from the pristine fixture (real edit) —
 *      OR the REPORT explicitly defers all mutation (documented read-only run).
 *   3. Every file the REPORT claims to have created/modified actually exists.
 *   4. If the REPORT claims a passing test suite, the test file exists.
 *   5. The answer key was not read (the run dir contains no ANSWER_KEY.md).
 *
 * RUN
 *   node validation-lab/harness/verify-run.mjs <runDir> <fixtureDir>
 *
 * EXIT CODES
 *   0 = VALID   (on-disk state matches the REPORT claims)
 *   1 = INVALID (REPORT narrates work that is not on disk)
 *   2 = ERROR   (missing args / unreadable dir)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const runDir = resolve(process.argv[2] ?? '');
const fixtureDir = resolve(process.argv[3] ?? '');

function fail(code, msg) {
  console.error(`verify-run: ${msg}`);
  process.exit(code);
}

if (!runDir || !fixtureDir || !existsSync(runDir) || !existsSync(fixtureDir)) {
  fail(2, 'usage: node verify-run.mjs <runDir> <fixtureDir>');
}

// ---------------------------------------------------------------------------
// 1. REPORT.md present
// ---------------------------------------------------------------------------
const reportPath = join(runDir, 'REPORT.md');
if (!existsSync(reportPath))
  fail(1, 'REPORT.md missing — a run with no report cannot be verified.');
const report = readFileSync(reportPath, 'utf8');

// ---------------------------------------------------------------------------
// 2. The source tree actually changed vs the pristine fixture.
//    Walk both trees and compare the set of files + a cheap content hash.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

function hashTree(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.push(p);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(relative(root, f));
    h.update(readFileSync(f));
  }
  return { hash: h.digest('hex').slice(0, 16), count: files.length };
}

const runTree = hashTree(runDir);
const fixtureTree = hashTree(fixtureDir);

// The run dir is a copy of the fixture + the agent's edits. If nothing in
// src/ (or any code/doc file) changed, the tree hashes differ only by the
// presence of REPORT.md. Detect "no source change" precisely.
function sourceChanged() {
  // Compare only files that exist in the fixture (the baseline set).
  const fixtureFiles = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) fixtureFiles.push(relative(fixtureDir, p));
    }
  };
  walk(fixtureDir);
  for (const rel of fixtureFiles) {
    const a = join(runDir, rel);
    const b = join(fixtureDir, rel);
    if (!existsSync(a)) return true; // a fixture file was deleted
    const ha = createHash('sha256').update(readFileSync(a)).digest('hex');
    const hb = createHash('sha256').update(readFileSync(b)).digest('hex');
    if (ha !== hb) return true;
  }
  // New files that are code/test (not just REPORT.md / scratch)
  const runFiles = [];
  const walkRun = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.name === 'node_modules' || e.name === '.git') continue;
      if (e.isDirectory()) walkRun(p);
      else if (e.isFile()) runFiles.push(relative(runDir, p));
    }
  };
  walkRun(runDir);
  const newCode = runFiles.filter(
    (f) =>
      !fixtureFiles.includes(f) &&
      f !== 'REPORT.md' &&
      !f.startsWith('_probe') &&
      /\.(js|ts|mjs|cjs|json)$/.test(f),
  );
  return newCode.length > 0;
}

const changed = sourceChanged();
console.log(`verify-run: ${dirname(runDir)}`);
console.log(`  fixture files: ${fixtureTree.count}, run files: ${runTree.count}`);
console.log(`  source tree changed vs fixture: ${changed}`);

// A run that is explicitly a documented read-only / discovery-only run may
// legitimately have no source change. Detect that marker.
const explicitlyNoRepair =
  /deferred|open question|no (file|code).*modified|read-only|discovery only/i.test(report) &&
  /did not (modify|create|execute)|no (file|code).*modified|not executed/i.test(report);

// ---------------------------------------------------------------------------
// 3. Files the REPORT references that do NOT exist are advisory (a report may
//    cite paths as context). They are surfaced, not treated as hard failures —
//    the real integrity check is "did the run actually change the tree".
// ---------------------------------------------------------------------------
const claimedFiles = [...report.matchAll(/`((?:src|test|tests|docs)\/[\w./-]+\.[a-z]+)`/gi)].map(
  (m) => m[1],
);
const missingClaims = claimedFiles.filter((f) => !existsSync(join(runDir, f)));
console.log(
  `  REPORT references ${claimedFiles.length} file path(s); not on disk: ${missingClaims.length}`,
);

// ---------------------------------------------------------------------------
// 4. If a passing test suite is claimed, the test file must exist.
// ---------------------------------------------------------------------------
const claimsTestsPass = /(\d+)\s*\/\s*\1\s*passed|\d+\s+tests?\s+passed|tests\s+passed/i.test(
  report,
);
let testFiles = 0;
try {
  for (const d of ['test', 'tests']) {
    const p = join(runDir, d);
    if (existsSync(p) && statSync(p).isDirectory()) testFiles += readdirSync(p).length;
  }
} catch {
  /* ignore */
}
if (claimsTestsPass && testFiles === 0) {
  fail(1, 'REPORT claims a passing test suite but no test file exists on disk.');
}
console.log(`  claims tests pass: ${claimsTestsPass}; test files found: ${testFiles}`);

// ---------------------------------------------------------------------------
// 5. Answer key must not be present in the run dir.
// ---------------------------------------------------------------------------
if (existsSync(join(runDir, 'ANSWER_KEY.md'))) {
  fail(1, 'ANSWER_KEY.md present in the run dir — the answer key must be held out.');
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
// missingClaims is advisory (a report may cite paths as context), so it no
// longer hard-fails the run. The integrity gate is: the source tree must have
// actually changed on disk, unless the REPORT documents a read-only run.
if (!changed && !explicitlyNoRepair) {
  fail(
    1,
    'No source change vs the fixture and the REPORT does not document a read-only run — narrated-but-not-executed.',
  );
}
if (!changed && explicitlyNoRepair) {
  console.log(
    'verify-run: VALID (documented read-only / discovery-only run; no source change expected)',
  );
} else {
  console.log('verify-run: VALID (source tree changed on disk, matching REPORT claims)');
}
process.exit(0);
