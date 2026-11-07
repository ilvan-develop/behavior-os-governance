import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  enableGovernance,
  isGovernanceEnabled,
  readGovernanceConfig,
  resolveDnaSourceDirectory,
} from '../src/project-optin';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const temporaryProjects: string[] = [];

function temporaryProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'behavior-os-optin-'));
  temporaryProjects.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('project opt-in marker', () => {
  it('keeps governance disabled when no marker exists', () => {
    expect(isGovernanceEnabled(temporaryProject(), {})).toBe(false);
  });

  it('enables governance from .behavioros/config.json', () => {
    const project = temporaryProject();
    mkdirSync(path.join(project, '.behavioros'), { recursive: true });
    writeFileSync(
      path.join(project, '.behavioros', 'config.json'),
      JSON.stringify({ governance: { enabled: true } }),
    );

    expect(readGovernanceConfig(project)?.governance?.enabled).toBe(true);
    expect(isGovernanceEnabled(project, {})).toBe(true);
  });

  it('treats a malformed config as not opted in', () => {
    const project = temporaryProject();
    mkdirSync(path.join(project, '.behavioros'), { recursive: true });
    writeFileSync(path.join(project, '.behavioros', 'config.json'), '{ not json');

    expect(readGovernanceConfig(project)).toBeNull();
    expect(isGovernanceEnabled(project, {})).toBe(false);
  });

  it('accepts the legacy behavioros init state file', () => {
    const project = temporaryProject();
    mkdirSync(path.join(project, '.behavioros'), { recursive: true });
    writeFileSync(
      path.join(project, '.behavioros', 'state.json'),
      JSON.stringify({ currentStep: 1 }),
    );

    expect(isGovernanceEnabled(project, {})).toBe(true);
  });

  it('honours the explicit disable and force-enable overrides', () => {
    const enabled = temporaryProject();
    mkdirSync(path.join(enabled, '.behavioros'), { recursive: true });
    writeFileSync(
      path.join(enabled, '.behavioros', 'config.json'),
      JSON.stringify({ governance: { enabled: true } }),
    );

    expect(isGovernanceEnabled(enabled, { BEHAVIOROS_DISABLED: 'true' })).toBe(false);
    expect(isGovernanceEnabled(temporaryProject(), { BEHAVIOROS_FORCE_ENABLED: 'true' })).toBe(
      true,
    );
  });
});

describe('project opt-in bootstrap', () => {
  it('writes the marker and copies the DNA patterns idempotently', () => {
    const project = temporaryProject();
    const source = path.join(repoRoot, 'dnas');

    const first = enableGovernance(project, source);
    expect(first.copied.length).toBeGreaterThan(0);
    expect(first.skipped).toEqual([]);
    expect(existsSync(path.join(project, '.behavioros', 'config.json'))).toBe(true);
    expect(existsSync(path.join(project, 'dnas', 'enterprise-governance.yaml'))).toBe(true);
    expect(isGovernanceEnabled(project, {})).toBe(true);

    const marker = JSON.parse(
      readFileSync(path.join(project, '.behavioros', 'config.json'), 'utf-8'),
    ) as { governance?: { enabled?: boolean } };
    expect(marker.governance?.enabled).toBe(true);

    const second = enableGovernance(project, source);
    expect(second.copied).toEqual([]);
    expect(second.skipped.length).toBe(first.copied.length);
  });

  it('preserves unrelated keys already present in the config', () => {
    const project = temporaryProject();
    mkdirSync(path.join(project, '.behavioros'), { recursive: true });
    writeFileSync(
      path.join(project, '.behavioros', 'config.json'),
      JSON.stringify({ owner: 'team-a', governance: { enabled: false } }),
    );

    enableGovernance(project, path.join(repoRoot, 'dnas'));

    const marker = JSON.parse(
      readFileSync(path.join(project, '.behavioros', 'config.json'), 'utf-8'),
    ) as { owner?: string; governance?: { enabled?: boolean } };
    expect(marker.owner).toBe('team-a');
    expect(marker.governance?.enabled).toBe(true);
  });

  it('finds the repository DNA patterns for local development', () => {
    const source = resolveDnaSourceDirectory(temporaryProject());
    expect(source).toBe(path.join(repoRoot, 'dnas'));
  });
});
