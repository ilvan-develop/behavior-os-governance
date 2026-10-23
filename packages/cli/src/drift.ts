import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DriftEngine } from '@behavior-os/core';
import type { DNA } from '@behavior-os/schemas';
import { load } from 'js-yaml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A baseline written by `diff` maps a file stem to a parsed DNA document.
 * Requiring at least one DNA collection keeps a malformed baseline from being
 * silently compared as if it were a DNA map.
 */
export function isDnaSnapshot(value: unknown): value is DNA {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (Array.isArray(value.personas) ||
      Array.isArray(value.governance) ||
      Array.isArray(value.quality))
  );
}

/** Legacy baselines only carried the two state fields. */
export function isLegacyStateBaseline(
  value: unknown,
): value is { selectedDna?: unknown; currentStep?: unknown } {
  return isRecord(value) && ('selectedDna' in value || 'currentStep' in value);
}

/** Load every `dnas/*.yaml|yml` document, keyed by file stem. */
export async function loadDnaDirectory(dnasDir: string): Promise<Record<string, DNA>> {
  const files = await readdir(dnasDir);
  const snapshots: Record<string, DNA> = {};

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const content = await readFile(join(dnasDir, file), 'utf8');
    const parsed: unknown = load(content);
    if (!isDnaSnapshot(parsed)) {
      throw new Error(`${file}: parsed document is not a DNA snapshot`);
    }
    snapshots[file.replace(/\.(yaml|yml)$/, '')] = parsed;
  }

  return snapshots;
}

export type DriftFindingKind = 'new' | 'removed' | 'changed';

export interface DriftFinding {
  pattern: string;
  kind: DriftFindingKind;
  summary: string;
  totalChanges: number;
  significant: boolean;
}

export interface DriftComparison {
  compared: number;
  findings: DriftFinding[];
  hasDrift: boolean;
}

/**
 * Compare current DNA snapshots with a baseline using `DriftEngine`.
 *
 * `DriftEngine` is the source of truth for governance-rule and quality-gate
 * drift; this wrapper only adds the repository-level cases the engine cannot
 * see (a pattern added or removed since the baseline).
 */
export function compareDnaSnapshots(
  current: Record<string, DNA>,
  baseline: Record<string, DNA>,
  engine: DriftEngine = new DriftEngine(),
): DriftComparison {
  const findings: DriftFinding[] = [];
  let compared = 0;

  for (const [pattern, dna] of Object.entries(current)) {
    const previous = baseline[pattern];
    if (!previous) {
      findings.push({
        pattern,
        kind: 'new',
        summary: `New DNA pattern: ${pattern}`,
        totalChanges: 0,
        significant: true,
      });
      continue;
    }

    compared += 1;
    const drift = engine.compare(previous, dna);
    if (drift.totalChanges > 0) {
      findings.push({
        pattern,
        kind: 'changed',
        summary: drift.summary,
        totalChanges: drift.totalChanges,
        significant: drift.significant,
      });
    }
  }

  for (const pattern of Object.keys(baseline)) {
    if (!(pattern in current)) {
      findings.push({
        pattern,
        kind: 'removed',
        summary: `Removed DNA pattern: ${pattern}`,
        totalChanges: 0,
        significant: true,
      });
    }
  }

  return { compared, findings, hasDrift: findings.length > 0 };
}

/** Compare the legacy state baseline fields, if present. */
export function compareStateToBaseline(state: unknown, baseline: unknown): string[] {
  if (!isRecord(state) || !isRecord(baseline)) return [];

  const drifts: string[] = [];
  if ('selectedDna' in baseline && state.selectedDna !== baseline.selectedDna) {
    drifts.push(
      `DNA pattern changed: ${String(baseline.selectedDna)} → ${String(state.selectedDna)}`,
    );
  }
  if ('currentStep' in baseline && state.currentStep !== baseline.currentStep) {
    drifts.push(
      `Protocol step changed: ${String(baseline.currentStep)} → ${String(state.currentStep)}`,
    );
  }
  return drifts;
}

export interface DriftCheckReport {
  baselineFound: boolean;
  dnasFound: boolean;
  stateFound: boolean;
  compared: number;
  findings: DriftFinding[];
  stateDrifts: string[];
  hasDrift: boolean;
}

/**
 * Run a drift check against a project directory.
 *
 * A baseline from `diff` is a DNA snapshot map. Older/state-only baselines are
 * still accepted so existing projects keep working. Invalid JSON or a
 * malformed DNA entry throws; the CLI turns that into exit code 1 instead of
 * pretending the check passed.
 */
export async function runDriftCheck(directory: string): Promise<DriftCheckReport> {
  const dnasDir = join(directory, 'dnas');
  const baselinePath = join(directory, '.behavioros', 'baseline.json');
  const statePath = join(directory, '.behavioros', 'state.json');
  const dnasFound = existsSync(dnasDir);
  const stateFound = existsSync(statePath);

  if (!existsSync(baselinePath)) {
    return {
      baselineFound: false,
      dnasFound,
      stateFound,
      compared: 0,
      findings: [],
      stateDrifts: [],
      hasDrift: false,
    };
  }

  const baseline: unknown = JSON.parse(readFileSync(baselinePath, 'utf8'));

  if (isLegacyStateBaseline(baseline)) {
    if (!stateFound) {
      return {
        baselineFound: true,
        dnasFound,
        stateFound: false,
        compared: 0,
        findings: [],
        stateDrifts: [],
        hasDrift: false,
      };
    }
    const state: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
    const stateDrifts = compareStateToBaseline(state, baseline);
    return {
      baselineFound: true,
      dnasFound,
      stateFound: true,
      compared: 0,
      findings: [],
      stateDrifts,
      hasDrift: stateDrifts.length > 0,
    };
  }

  if (!isRecord(baseline)) {
    throw new Error('baseline.json must be a DNA map or a state baseline object');
  }

  const baselineDnas: Record<string, DNA> = {};
  for (const [pattern, value] of Object.entries(baseline)) {
    if (!isDnaSnapshot(value)) {
      throw new Error(`baseline entry "${pattern}" is not a DNA snapshot`);
    }
    baselineDnas[pattern] = value;
  }

  const current = dnasFound ? await loadDnaDirectory(dnasDir) : {};
  const comparison = compareDnaSnapshots(current, baselineDnas);

  return {
    baselineFound: true,
    dnasFound,
    stateFound,
    compared: comparison.compared,
    findings: comparison.findings,
    stateDrifts: [],
    hasDrift: comparison.hasDrift,
  };
}
