import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import {
  AuditEngine,
  detectLinter,
  findCoverageReport,
  findProjectRoot,
  resolveAuditRoot,
} from '../src/engine/audit-engine';
import { BehaviorOS } from '../src/engine/behavior-os';

describe('AuditEngine - Real Mode', () => {
  const _dna: DNA = {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Test',
    personas: [],
    governance: [],
    quality: [],
  };

  it('should run in simulate mode by default', async () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'feature', priority: 'medium' });

    const report = await bos.runAudit({ missionId: mission.id, agentId: 'test-agent' });

    expect(report.overall).toBeDefined();
    expect(report.stages.length).toBeGreaterThan(0);
    // Simulate mode may have random results
    expect(report.summary).toContain('passed');
  });

  it('should accept explicit simulate option', async () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'bugfix', priority: 'high' });

    const report = await bos.runAudit({
      missionId: mission.id,
      agentId: 'agent-1',
      simulate: true,
    });

    expect(report).toBeDefined();
    expect(report.missionId).toBe(mission.id);
    expect(report.agentId).toBe('agent-1');
  });

  it('should store multiple reports', async () => {
    const bos = new BehaviorOS();
    const m1 = bos.createMission({ title: 'M1', type: 'feature', priority: 'low' });
    const m2 = bos.createMission({ title: 'M2', type: 'refactor', priority: 'medium' });

    const r1 = await bos.runAudit({ missionId: m1.id, agentId: 'a1' });
    // Ensure unique IDs by waiting for next millisecond
    await new Promise((r) => setTimeout(r, 10));
    const r2 = await bos.runAudit({ missionId: m2.id, agentId: 'a2' });

    expect(r1.id).not.toBe(r2.id);
    expect(r1.missionId).toBe(m1.id);
    expect(r2.missionId).toBe(m2.id);
  });

  it('should allow custom stages', async () => {
    const bos = new BehaviorOS();
    const mission = bos.createMission({ title: 'test', type: 'audit', priority: 'critical' });

    const report = await bos.runAudit({
      missionId: mission.id,
      agentId: 'a1',
      simulate: true,
    });

    expect(report.stages.length).toBeGreaterThan(0);
  });
});

describe('AuditEngine - Integration with BehaviorOS', () => {
  it('should produce valid audit report after mission lifecycle', async () => {
    const bos = new BehaviorOS();

    const mission = bos.createMission({
      title: 'Full lifecycle',
      type: 'deployment',
      priority: 'critical',
    });
    bos.startMission(mission.id);

    const report = await bos.runAudit({ missionId: mission.id, agentId: 'deployer' });

    expect(report.overall).toBeDefined();
    expect(report.stages.length).toBeGreaterThan(0);
    expect(report.timestamp).toBeDefined();
  });
});

// G-017: the real lint stage only recognised eslint/oxlint, so it reported
// `skipped` in a Biome repository.
describe('AuditEngine - linter detection (G-017)', () => {
  it('detects a linter from its config file and nothing from an empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-lint-'));
    try {
      expect(detectLinter(dir)).toBeNull();

      writeFileSync(join(dir, 'biome.json'), '{}');
      expect(detectLinter(dir)).toBe('biome');

      rmSync(join(dir, 'biome.json'));
      writeFileSync(join(dir, 'eslint.config.js'), 'export default [];');
      expect(detectLinter(dir)).toBe('eslint');

      rmSync(join(dir, 'eslint.config.js'));
      writeFileSync(join(dir, '.oxlintrc.json'), '{}');
      expect(detectLinter(dir)).toBe('oxlint');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves the workspace root above a package directory', () => {
    const root = findProjectRoot();
    expect(root).not.toBeNull();
    if (!root) return;
    // The repository linter is Biome, configured at the workspace root.
    expect(detectLinter(root)).toBe('biome');
  });

  it('reports the real lint stage as passed (not skipped) in this repository', async () => {
    const engine = new AuditEngine();
    const report = await engine.runReal({
      missionId: 'mission-lint-probe',
      agentId: 'persona:architect',
      stages: ['lint'],
    });

    const lint = report.stages[0];
    expect(lint?.stage).toBe('lint');
    expect(lint?.status).toBe('passed');
    expect(lint?.details).toMatchObject({ checked: true, linter: 'biome' });
  }, 120_000);
});

// The plugin host's cwd can be its config directory, not the repository. Only
// the lint stage used to pin a cwd; typecheck/security/coverage ran where the
// host happened to be and failed with "no script" on a green project.
describe('AuditEngine - real stages use the workspace root', () => {
  it('runs typecheck from the workspace root when the process cwd is .opencode', async () => {
    const root = findProjectRoot();
    expect(root).not.toBeNull();
    if (!root) return;

    const previous = process.cwd();
    try {
      process.chdir(join(root, '.opencode'));

      const report = await new AuditEngine().runReal({
        missionId: 'mission-cwd-probe',
        agentId: 'persona:architect',
        stages: ['typecheck'],
      });

      const typecheck = report.stages[0];
      expect(typecheck?.stage).toBe('typecheck');
      expect(typecheck?.status).toBe('passed');

      // `root` must win over cwd discovery. This is what the OpenCode plugin
      // passes (`ctx.location.directory`): the host process can run outside the
      // project, where findProjectRoot() finds nothing and a green project used
      // to report typecheck/security failures ("no script"/"no lockfile").
      const dir = mkdtempSync(join(tmpdir(), 'bos-root-'));
      try {
        const pkg = (exitCode: number) =>
          JSON.stringify({
            name: 'root-probe',
            version: '1.0.0',
            scripts: { typecheck: `node -e "process.exit(${exitCode})"` },
          });

        writeFileSync(join(dir, 'package.json'), pkg(0));
        process.chdir(tmpdir());
        const ok = await new AuditEngine().runReal({
          missionId: 'mission-root-probe',
          agentId: 'persona:architect',
          stages: ['typecheck'],
          root: dir,
        });
        expect(ok.stages[0]?.status).toBe('passed');

        writeFileSync(join(dir, 'package.json'), pkg(3));
        const bad = await new AuditEngine().runReal({
          missionId: 'mission-root-probe',
          agentId: 'persona:architect',
          stages: ['typecheck'],
          root: dir,
        });
        expect(bad.stages[0]?.status).toBe('failed');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      process.chdir(previous);
    }
  }, 300_000);
});

// The real coverage stage only knew the `lcov` layout, so the report written
// by this workspace (`coverage/index.html` from the html reporter) was reported
// as missing and every real audit ended in a warning.
describe('AuditEngine - coverage report detection', () => {
  it('detects the html and json reports this workspace writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bos-cov-'));
    try {
      expect(findCoverageReport(dir)).toBeNull();

      mkdirSync(join(dir, 'coverage'), { recursive: true });

      writeFileSync(join(dir, 'coverage', 'index.html'), '<html></html>');
      expect(findCoverageReport(dir)).toBe(join(dir, 'coverage', 'index.html'));
      rmSync(join(dir, 'coverage', 'index.html'));

      writeFileSync(join(dir, 'coverage', 'coverage-final.json'), '{}');
      expect(findCoverageReport(dir)).toBe(join(dir, 'coverage', 'coverage-final.json'));
      rmSync(join(dir, 'coverage', 'coverage-final.json'));

      writeFileSync(join(dir, 'coverage', 'coverage-summary.json'), '{}');
      expect(findCoverageReport(dir)).toBe(join(dir, 'coverage', 'coverage-summary.json'));
      rmSync(join(dir, 'coverage', 'coverage-summary.json'));

      mkdirSync(join(dir, 'coverage', 'lcov-report'), { recursive: true });
      writeFileSync(join(dir, 'coverage', 'lcov-report', 'index.html'), '<html></html>');
      expect(findCoverageReport(dir)).toBe(join(dir, 'coverage', 'lcov-report', 'index.html'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
// R19: a host that can only pass environment variables (the MCP stdio server,
// which a client may launch from any cwd) must still resolve the workspace, or
// the real stages run outside the project and report a false red.
describe('AuditEngine - audit root from the environment (R19)', () => {
  it('resolves the repo root from BEHAVIOROS_DNA_PATH (file or directory)', () => {
    const root = join(tmpdir(), 'probe-repo');

    expect(resolveAuditRoot({})).toBeUndefined();
    expect(resolveAuditRoot({ BEHAVIOROS_DNA_PATH: '  ' })).toBeUndefined();

    // A single pattern file and the patterns directory both mean the repo root.
    expect(resolveAuditRoot({ BEHAVIOROS_DNA_PATH: join(root, 'dnas', 'open-source.yaml') })).toBe(
      resolve(root),
    );
    expect(resolveAuditRoot({ BEHAVIOROS_DNA_PATH: join(root, 'dnas') })).toBe(resolve(root));

    // No new variable is invented: the withdrawn name must not be read.
    expect(
      resolveAuditRoot({
        BEHAVIOROS_PROJECT_ROOT: join(tmpdir(), 'other-repo'),
        BEHAVIOROS_DNA_PATH: join(root, 'dnas'),
      }),
    ).toBe(resolve(root));

    // The shipped `.mcp.json` uses a relative DNA path, and the stdio server may
    // be launched from any cwd: a relative path must resolve against the anchor,
    // not the cwd (the test process runs from packages/core, which has no dnas/).
    const checkout = mkdtempSync(join(tmpdir(), 'probe-checkout-'));
    try {
      mkdirSync(join(checkout, 'dnas'), { recursive: true });
      writeFileSync(join(checkout, 'dnas', 'open-source.yaml'), 'name: probe\n');
      mkdirSync(join(checkout, 'packages', 'mcp-server', 'dist'), { recursive: true });
      const anchor = join(checkout, 'packages', 'mcp-server', 'dist');

      expect(resolveAuditRoot({ BEHAVIOROS_DNA_PATH: './dnas/open-source.yaml' }, anchor)).toBe(
        resolve(checkout),
      );
      expect(resolveAuditRoot({ BEHAVIOROS_DNA_PATH: './dnas' }, anchor)).toBe(resolve(checkout));
      expect(
        resolveAuditRoot({ BEHAVIOROS_DNA_PATH: './__no_such_dnas__' }, anchor),
      ).toBeUndefined();
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  });
});
