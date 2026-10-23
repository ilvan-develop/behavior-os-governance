import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareDnaSnapshots,
  compareStateToBaseline,
  isDnaSnapshot,
  isLegacyStateBaseline,
  loadDnaDirectory,
  runDriftCheck,
} from '../src/drift.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeDna(overrides: Partial<DNA> = {}): DNA {
  return {
    name: 'Test DNA',
    version: '2.0.0',
    description: 'A test pattern',
    personas: [{ role: 'operator', name: 'Operator', authority: 'operator', skills: [] }],
    governance: [
      {
        id: 'rule-1',
        level: 'high',
        action: 'block',
        conditions: [],
        description: 'A test rule',
      },
    ],
    quality: [{ id: 'gate-1', type: 'test_coverage', threshold: 80 }],
    ...overrides,
  };
}

function project(): { root: string; dnas: string; behavioros: string } {
  const root = mkdtempSync(join(tmpdir(), 'behavioros-drift-'));
  temporaryDirectories.push(root);
  const dnas = join(root, 'dnas');
  const behavioros = join(root, '.behavioros');
  mkdirSync(dnas, { recursive: true });
  mkdirSync(behavioros, { recursive: true });
  return { root, dnas, behavioros };
}

describe('DNA drift comparison', () => {
  it('reports no drift for identical snapshots', () => {
    const current = { sample: makeDna() };
    const baseline = { sample: makeDna() };

    const result = compareDnaSnapshots(current, baseline);

    expect(result.compared).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.hasDrift).toBe(false);
  });

  it('uses DriftEngine to report a changed rule body', () => {
    const baseline = { sample: makeDna() };
    const current = {
      sample: makeDna({
        governance: [
          {
            id: 'rule-1',
            level: 'high',
            action: 'warn',
            conditions: [],
            description: 'A test rule',
          },
        ],
      }),
    };

    const result = compareDnaSnapshots(current, baseline);

    expect(result.compared).toBe(1);
    expect(result.hasDrift).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('changed');
    expect(result.findings[0]?.pattern).toBe('sample');
    expect(result.findings[0]?.totalChanges).toBe(1);
    expect(result.findings[0]?.significant).toBe(false);
    expect(result.findings[0]?.summary).toContain('1 changed');
  });

  it('marks two or more changes as significant', () => {
    const baseline = { sample: makeDna() };
    const current = {
      sample: makeDna({
        governance: [
          {
            id: 'rule-1',
            level: 'high',
            action: 'warn',
            conditions: [],
            description: 'A test rule',
          },
        ],
        quality: [{ id: 'gate-1', type: 'test_coverage', threshold: 90 }],
      }),
    };

    const result = compareDnaSnapshots(current, baseline);

    expect(result.findings[0]?.totalChanges).toBe(2);
    expect(result.findings[0]?.significant).toBe(true);
  });

  it('reports added and removed patterns', () => {
    const current = { added: makeDna({ name: 'Added' }) };
    const baseline = { removed: makeDna({ name: 'Removed' }) };

    const result = compareDnaSnapshots(current, baseline);

    expect(result.compared).toBe(0);
    expect(result.findings.map((finding) => finding.kind).sort()).toEqual(['new', 'removed']);
    expect(result.hasDrift).toBe(true);
  });

  it('compares the legacy state baseline fields', () => {
    const drifts = compareStateToBaseline(
      { selectedDna: 'open-source', currentStep: 4 },
      { selectedDna: 'enterprise-governance', currentStep: 2 },
    );

    expect(drifts).toHaveLength(2);
    expect(drifts[0]).toContain('open-source');
    expect(drifts[1]).toContain('4');
  });

  it('recognizes DNA snapshots and legacy state baselines', () => {
    expect(isDnaSnapshot(makeDna())).toBe(true);
    expect(isDnaSnapshot({ name: 'not-a-dna' })).toBe(false);
    expect(isLegacyStateBaseline({ selectedDna: 'open-source' })).toBe(true);
    expect(isLegacyStateBaseline({ 'open-source': makeDna() })).toBe(false);
  });
});

describe('runDriftCheck', () => {
  it('compares dnas/*.yaml with a diff baseline end to end', async () => {
    const { root, dnas, behavioros } = project();
    const current = makeDna({
      governance: [
        {
          id: 'rule-1',
          level: 'high',
          action: 'warn',
          conditions: [],
          description: 'A test rule',
        },
      ],
    });
    writeFileSync(join(dnas, 'sample.yaml'), JSON.stringify(current, null, 2));
    writeFileSync(
      join(behavioros, 'baseline.json'),
      JSON.stringify({ sample: makeDna() }, null, 2),
    );

    const report = await runDriftCheck(root);

    expect(report.baselineFound).toBe(true);
    expect(report.dnasFound).toBe(true);
    expect(report.compared).toBe(1);
    expect(report.hasDrift).toBe(true);
    expect(report.findings[0]?.pattern).toBe('sample');
  });

  it('reports no drift when the YAML matches the baseline', async () => {
    const { root, dnas, behavioros } = project();
    const current = makeDna();
    writeFileSync(join(dnas, 'sample.yml'), JSON.stringify(current, null, 2));
    writeFileSync(join(behavioros, 'baseline.json'), JSON.stringify({ sample: current }, null, 2));

    const report = await runDriftCheck(root);

    expect(report.hasDrift).toBe(false);
    expect(report.compared).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it('supports a legacy state baseline and reports both fields', async () => {
    const { root, behavioros } = project();
    writeFileSync(
      join(behavioros, 'state.json'),
      JSON.stringify({ selectedDna: 'open-source', currentStep: 4 }),
    );
    writeFileSync(
      join(behavioros, 'baseline.json'),
      JSON.stringify({ selectedDna: 'enterprise-governance', currentStep: 2 }),
    );

    const report = await runDriftCheck(root);

    expect(report.baselineFound).toBe(true);
    expect(report.stateFound).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.stateDrifts).toHaveLength(2);
    expect(report.hasDrift).toBe(true);
  });

  it('returns baselineFound false when there is no baseline', async () => {
    const { root } = project();

    const report = await runDriftCheck(root);

    expect(report.baselineFound).toBe(false);
    expect(report.hasDrift).toBe(false);
  });

  it('reports a removed pattern when dnas/ is empty', async () => {
    const { root, behavioros } = project();
    writeFileSync(
      join(behavioros, 'baseline.json'),
      JSON.stringify({ sample: makeDna() }, null, 2),
    );

    const report = await runDriftCheck(root);

    expect(report.findings[0]?.kind).toBe('removed');
    expect(report.hasDrift).toBe(true);
  });

  it('rejects a baseline entry that is not a DNA snapshot', async () => {
    const { root, behavioros } = project();
    writeFileSync(join(behavioros, 'baseline.json'), JSON.stringify({ sample: { name: 'x' } }));

    await expect(runDriftCheck(root)).rejects.toThrow('not a DNA snapshot');
  });

  it('rejects a YAML document that is not a DNA snapshot', async () => {
    const { dnas } = project();
    writeFileSync(join(dnas, 'broken.yaml'), 'name: only-a-name\n');

    await expect(loadDnaDirectory(dnas)).rejects.toThrow('not a DNA snapshot');
  });
});
