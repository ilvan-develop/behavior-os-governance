/**
 * Behavior OS — Intelligence Validation Lab
 * Shared harness helpers.
 *
 * Design rules:
 *  - Every experiment declares a hypothesis and explicit pass/fail checks
 *    BEFORE it runs. A check that is not asserted is not evidence.
 *  - Any thrown error becomes an ERROR result, never a pass.
 *  - Evidence is written to validation-lab/artifacts/evidence.json, and raw
 *    command output to validation-lab/artifacts/raw/.
 *  - Nothing here writes to packages/, dnas/, docs/ or any production path.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(LAB_ROOT, '..');
export const ARTIFACTS = join(LAB_ROOT, 'artifacts');
export const RAW = join(ARTIFACTS, 'raw');
export const TMP = join(ARTIFACTS, 'tmp');

export function ensureDirs() {
  for (const dir of [ARTIFACTS, RAW, TMP]) mkdirSync(dir, { recursive: true });
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeRaw(name, content) {
  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, name), content, 'utf8');
  return `artifacts/raw/${name}`;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Deterministic SHA-256 over every file in a directory tree.
 *
 * The single-file fingerprint used in lab v1 hashed only `dist/index.js`, which
 * did not change when the fixed `dist/engine/*.js` files did. Hashing the whole
 * tree (sorted by relative path) binds evidence to the real build.
 */
export function treeSha256(dir) {
  const hash = createHash('sha256');
  const walk = (abs, rel) => {
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const entryAbs = join(abs, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryAbs, entryRel);
      } else if (entry.isFile()) {
        hash.update(entryRel);
        hash.update(readFileSync(entryAbs));
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

export function exists(file) {
  return existsSync(file);
}

/** A single experiment. `body(ctx)` receives the recorder. */
export async function experiment(def, body) {
  const started = Date.now();
  const record = {
    id: def.id,
    lab: def.lab,
    title: def.title,
    hypothesis: def.hypothesis,
    passCriteria: def.passCriteria ?? [],
    failCriteria: def.failCriteria ?? [],
    status: 'ERROR',
    checks: [],
    metrics: {},
    artifacts: [],
    notes: [],
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    error: null,
  };

  const ctx = {
    record,
    check(name, ok, details = {}) {
      record.checks.push({ name, ok: Boolean(ok), ...details });
      return Boolean(ok);
    },
    equal(name, actual, expected) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      record.checks.push({ name, ok, expected, actual });
      return ok;
    },
    metric(name, value) {
      record.metrics[name] = value;
    },
    raw(name, content) {
      const path = writeRaw(`${def.id}-${name}`, content);
      record.artifacts.push(path);
      return path;
    },
    note(message) {
      record.notes.push(message);
    },
  };

  try {
    await body(ctx);
    const failed = record.checks.filter((c) => !c.ok);
    if (record.checks.length === 0) {
      record.status = 'ERROR';
      record.error = 'no checks asserted — an experiment without assertions is not evidence';
    } else if (failed.length > 0) {
      record.status = 'FAIL';
    } else {
      record.status = 'PASS';
    }
  } catch (error) {
    record.status = 'ERROR';
    record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (error instanceof Error && error.stack)
      record.notes.push(error.stack.split('\n').slice(0, 6).join('\n'));
  }

  record.durationMs = Date.now() - started;
  return record;
}

/** A lab with no executable deterministic surface yet: explicitly NOT VERIFIED. */
export function unverifiedLab(def) {
  return {
    id: def.id,
    lab: def.lab,
    title: def.title,
    hypothesis: def.hypothesis,
    passCriteria: def.passCriteria ?? [],
    failCriteria: def.failCriteria ?? [],
    status: 'NOT_VERIFIED',
    checks: [],
    metrics: {},
    artifacts: [],
    notes: def.notes ?? [],
    startedAt: new Date().toISOString(),
    durationMs: 0,
    error: null,
    reason: def.reason,
    nextStep: def.nextStep,
  };
}

export function summarize(labs) {
  const counts = { PASS: 0, FAIL: 0, ERROR: 0, NOT_VERIFIED: 0 };
  let checks = 0;
  let passed = 0;
  for (const lab of labs) {
    counts[lab.status] = (counts[lab.status] ?? 0) + 1;
    for (const c of lab.checks) {
      checks += 1;
      if (c.ok) passed += 1;
    }
  }
  return {
    counts,
    checks,
    passedChecks: passed,
    failedChecks: checks - passed,
    total: labs.length,
  };
}
