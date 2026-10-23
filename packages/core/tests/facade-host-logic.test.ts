import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA, GovernanceRule } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isControlPlaneAction, isMutatingAction } from '../src/action-classification.js';
import { BehaviorOS } from '../src/engine/behavior-os.js';

function dna(name: string): DNA {
  return {
    name,
    version: '1.0.0',
    description: 'fixture',
    personas: [{ role: 'engineer', name: 'Eng', authority: 'architect', skills: ['ts'] }],
    governance: [],
    quality: [],
  };
}

describe('facade mission filters', () => {
  let bos: BehaviorOS;

  beforeEach(async () => {
    bos = new BehaviorOS();
    await bos.loadDNA(dna('m-dna'));
  });

  it('applies filters before the limit (semantics owned by the facade)', async () => {
    const a1 = bos.createMission({ title: 'a1', type: 'bugfix', priority: 'high' });
    bos.createMission({ title: 'a2', type: 'feature', priority: 'low' });
    bos.createMission({ title: 'a3', type: 'bugfix', priority: 'high' });
    bos.startMission(a1.id);
    bos.cancelMission(a1.id);

    expect(
      bos
        .listMissions(1, { status: 'pending', type: 'bugfix', priority: 'high' })
        .map((m) => m.title),
    ).toEqual(['a3']);
    expect(bos.listMissions(50, { type: 'bugfix' })).toHaveLength(2);
    expect(
      bos.listMissions(1, { status: 'pending', type: 'bugfix', priority: 'high' }).length,
    ).toBeLessThanOrEqual(1);
    expect(bos.listMissions(50)).toHaveLength(3);
  });
});

describe('facade DNA directory loading', () => {
  let dir: string;
  const dirs: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bos-dna-dir-'));
    dirs.push(dir);
  });

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('validates patterns through the DNALoader and reports errors instead of casting', async () => {
    const valid = `name: Dir DNA
version: 1.0.0
description: valid
personas: []
governance: []
quality: []
`;
    // Invalid schema: agents is not a schema field the loader accepts, and the
    // file is valid YAML — the failure comes from validation, not parsing.
    const invalid = 'name: Broken\nagents: false\n';
    const empty = 'not-a-dna: true\n';
    writeFileSync(join(dir, 'dir-dna.yaml'), valid);
    writeFileSync(join(dir, 'broken.yml'), invalid);
    writeFileSync(join(dir, 'empty.yaml'), empty);

    const { patterns, errors } = await new BehaviorOS().loadDNAFromDirectory(dir);
    expect(patterns.has('dir-dna')).toBe(true);
    expect(patterns.get('dir-dna')?.name).toBe('Dir DNA');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.startsWith('broken.yml'))).toBe(true);
    expect(errors.some((e) => e.startsWith('empty.yaml'))).toBe(true);
    expect(patterns.has('broken')).toBe(false);
    expect(patterns.has('empty')).toBe(false);
  });

  it('ignores non-YAML files', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'README.md'), 'hello');
    const { patterns, errors } = await new BehaviorOS().loadDNAFromDirectory(dir);
    expect(patterns.size).toBe(0);
    expect(errors).toEqual([]);
  });
});

describe('action classification and the bootstrap deny-override policy', () => {
  let bos: BehaviorOS;
  const rule: GovernanceRule = {
    id: 'deny-all',
    level: 'critical',
    action: 'block',
    conditions: [{ type: '*', value: true }],
    description: 'blanket deny',
  };

  beforeEach(async () => {
    bos = new BehaviorOS();
    await bos.loadDNA({
      ...dna('lockdown'),
      governance: [rule],
    });
  });

  it('never lets a DNA deny lock the control plane or read-only tools', async () => {
    const mutating = bos.evaluateGovernance('bash', { agent: 'a', context: { '*': true } });
    expect(mutating.verdict).toBe('deny');
    expect(bos.bootstrapDenyOverride('bash', mutating)).toBe(false);

    const controlPlane = bos.evaluateGovernance('bos_list_dna', {
      agent: 'a',
      context: { '*': true },
    });
    expect(controlPlane.verdict).toBe('deny');
    expect(bos.bootstrapDenyOverride('bos_list_dna', controlPlane)).toBe(true);

    const readOnly = bos.evaluateGovernance('grep', { agent: 'a', context: { '*': true } });
    expect(readOnly.verdict).toBe('deny');
    expect(bos.bootstrapDenyOverride('grep', readOnly)).toBe(true);
  });

  it('classifies actions deterministically', () => {
    expect(isControlPlaneAction('bos_select_dna')).toBe(true);
    expect(isControlPlaneAction('bash')).toBe(false);
    expect(isMutatingAction('write')).toBe(true);
    expect(isMutatingAction('grep')).toBe(false);
    expect(isMutatingAction(undefined)).toBe(false);
  });
});
