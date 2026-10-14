import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import plugin, { PROTOCOL_STEPS } from '../src/index';

// These assertions read the real plugin export and the real dnas/ directory.
// The previous version of this file asserted hand-written literals, so it
// "passed" even when the plugin disagreed with them.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('OpenCode plugin', () => {
  it('registers the behavior-os plugin with a setup hook', () => {
    expect(plugin.id).toBe('behavior-os');
    expect(typeof plugin.setup).toBe('function');
  });

  it('declares the 7 protocol steps with the core tool mapping', () => {
    expect(PROTOCOL_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PROTOCOL_STEPS.map((step) => step.tool)).toEqual([
      'bos_select_dna',
      'bos_list_dna',
      'bos_get_state',
      'bos_create_mission',
      'bos_start_mission',
      'bos_run_audit',
      'bos_record_learning',
    ]);
    expect(PROTOCOL_STEPS.every((step) => step.name.length > 0)).toBe(true);
  });

  it('ships the DNA patterns that exist in dnas/', () => {
    const patterns = readdirSync(resolve(repoRoot, 'dnas'))
      .filter((file) => file.endsWith('.yaml'))
      .map((file) => file.replace(/\.yaml$/, ''))
      .sort();

    expect(patterns.length).toBe(21);
    expect(patterns).toContain('enterprise-governance');
    expect(patterns).toContain('lean-factory');
  });
});
