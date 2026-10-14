import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DNA } from '@behavior-os/schemas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS, CodeEditEngine, CodeEditError, personaIdentity } from '../src/index.js';

/**
 * Governed code editing is the one place Behavior-OS writes to source files, so
 * the tests have to prove the dry-run default and every refusal path — path
 * escape, non-editable extension, ambiguous match, stale hash, missing opt-in,
 * rejected vote — before they prove the happy path.
 */
function makeDna(): DNA {
  return {
    name: 'Edit DNA',
    version: '1.0.0',
    description: 'Code-edit test pattern',
    personas: [{ role: 'developer', name: 'Test Dev', authority: 'developer', skills: ['coding'] }],
    governance: [],
    quality: [],
  };
}

describe('CodeEditEngine', () => {
  let base: string;
  let root: string;
  let engine: CodeEditEngine;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'bos-codeedit-'));
    root = join(base, 'workspace');
    mkdirSync(root);
    writeFileSync(join(root, 'app.ts'), 'const x = 1;\nconst y = 2;\n', 'utf8');
    engine = new CodeEditEngine({ root });
  });

  afterEach(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* Windows may still hold a handle; best effort. */
    }
  });

  it('previews hashes and a unified diff without touching the file', () => {
    const preview = engine.preview({
      file: 'app.ts',
      find: 'const x = 1;',
      replace: 'const x = 42;',
    });

    expect(preview.file).toBe('app.ts');
    expect(preview.occurrences).toBe(1);
    expect(preview.beforeHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(preview.afterHash).not.toBe(preview.beforeHash);
    expect(preview.diff).toContain('-const x = 1;');
    expect(preview.diff).toContain('+const x = 42;');
    expect(preview.addedLines).toBe(1);
    // The file is untouched: preview is read-only.
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('refuses a path outside the workspace root', () => {
    writeFileSync(join(base, 'outside.ts'), 'const z = 1;\n', 'utf8');
    expect(() =>
      engine.preview({ file: '../outside.ts', find: 'const z', replace: 'const w' }),
    ).toThrow(CodeEditError);
    expect(() =>
      engine.preview({ file: join(base, 'outside.ts'), find: 'const z', replace: 'const w' }),
    ).toThrow(/outside the workspace root/);
  });

  it('refuses an extension outside the allowlist', () => {
    writeFileSync(join(root, 'prod.env.local'), 'TOKEN=1\n', 'utf8');
    expect(() =>
      engine.preview({ file: 'prod.env.local', find: 'TOKEN=1', replace: 'TOKEN=2' }),
    ).toThrow(/not editable/);
  });

  it('refuses a missing or ambiguous match', () => {
    expect(() => engine.preview({ file: 'app.ts', find: 'nope', replace: 'x' })).toThrow(
      /does not occur/,
    );
    writeFileSync(join(root, 'dup.ts'), 'const a = 1;\nconst a = 1;\n', 'utf8');
    expect(() =>
      engine.preview({ file: 'dup.ts', find: 'const a = 1;', replace: 'const a = 2;' }),
    ).toThrow(/occurs 2 times/);
  });

  it('applies atomically and leaves no temp file behind', () => {
    const preview = engine.apply({
      file: 'app.ts',
      find: 'const x = 1;',
      replace: 'const x = 9;',
    });

    expect(preview.afterHash).toMatch(/^sha256:/);
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('const x = 9;\nconst y = 2;\n');
    expect(readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('refuses a stale expectedBeforeHash instead of overwriting', () => {
    const preview = engine.preview({
      file: 'app.ts',
      find: 'const x = 1;',
      replace: 'const x = 2;',
    });
    writeFileSync(join(root, 'app.ts'), 'const x = 1;\nconst y = 3;\n', 'utf8');

    expect(() =>
      engine.apply(
        { file: 'app.ts', find: 'const x = 1;', replace: 'const x = 2;' },
        { expectedBeforeHash: preview.beforeHash },
      ),
    ).toThrow(/stale edit/);
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('const x = 1;\nconst y = 3;\n');
  });
});

describe('BehaviorOS.applyCodeEdit', () => {
  let base: string;
  let root: string;
  const file = 'app.ts';

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'bos-codeedit-'));
    root = join(base, 'workspace');
    mkdirSync(root);
    writeFileSync(join(root, file), 'const x = 1;\nconst y = 2;\n', 'utf8');
  });

  afterEach(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const current = (): string => readFileSync(join(root, file), 'utf8');

  it('defaults to a dry run and never writes', () => {
    const bos = new BehaviorOS({ codeEdit: { enabled: true, root } });

    const result = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('dry-run');
    expect(result.preview?.afterHash).toMatch(/^sha256:/);
    expect(result.record?.applied).toBe(false);
    expect(result.record?.reason).toBe('dry-run');
    expect(current()).toContain('const x = 1;');
  });

  it('refuses to write while code editing is not enabled', () => {
    const bos = new BehaviorOS({ codeEdit: { root } });

    const result = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('opt-in-disabled');
    expect(result.enabled).toBe(false);
    expect(current()).toContain('const x = 1;');
  });

  it('writes, persists and reports the governed edit when enabled', () => {
    const dbPath = join(base, 'state.db');
    const bos = new BehaviorOS({
      codeEdit: { enabled: true, root },
      persistence: { path: dbPath },
    });

    const dry = bos.applyCodeEdit({ file, find: 'const x = 1;', replace: 'const x = 2;' });
    const result = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
    });

    expect(result.applied).toBe(true);
    expect(result.preview?.occurrences).toBe(1);
    expect(result.record?.applied).toBe(true);
    expect(result.record?.file).toBe(file);
    expect(result.record?.beforeHash).not.toBe(result.record?.afterHash);
    expect(current()).toBe('const x = 2;\nconst y = 2;\n');

    // Dry-runs and applications are both part of the versioned record.
    const stored = bos.listCodeEdits();
    expect(stored).toHaveLength(2);
    const storedResult = stored.find((record) => record.id === result.record?.id);
    expect(storedResult?.applied).toBe(true);
    expect(storedResult?.afterHash).toBe(result.record?.afterHash);
    const storedDryRun = stored.find((record) => record.id === dry.record?.id);
    expect(storedDryRun?.applied).toBe(false);
    expect(storedDryRun?.reason).toBe('dry-run');
    bos.closeStore();
  });

  it('requires an approving vote when votes are supplied', () => {
    const bos = new BehaviorOS({ codeEdit: { enabled: true, root } });

    const rejected = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
      votes: [{ voterId: 'a', choice: 'reject' }],
    });
    expect(rejected.applied).toBe(false);
    expect(rejected.reason).toBe('vote-rejected');
    expect(rejected.record?.voteOutcome).toBe('rejected');
    expect(current()).toContain('const x = 1;');

    const approved = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
      votes: [{ voterId: 'a', choice: 'approve' }],
    });
    expect(approved.applied).toBe(true);
    expect(approved.decision?.outcome).toBe('approved');
    expect(current()).toBe('const x = 2;\nconst y = 2;\n');
  });

  it('refuses a stale preview hash and records the refusal', () => {
    const bos = new BehaviorOS({ codeEdit: { enabled: true, root } });
    const preview = bos.applyCodeEdit({ file, find: 'const x = 1;', replace: 'const x = 2;' });
    writeFileSync(join(root, file), 'const x = 1;\nconst y = 3;\n', 'utf8');

    const stale = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
      expectedBeforeHash: preview.preview?.beforeHash,
    });

    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe('guard-refused');
    expect(stale.error).toMatch(/stale edit/);
    expect(current()).toBe('const x = 1;\nconst y = 3;\n');
  });

  it('reports the guard-rail error for an invalid request', () => {
    const bos = new BehaviorOS({ codeEdit: { enabled: true, root } });

    const result = bos.applyCodeEdit({ file: '../escape.ts', find: 'a', replace: 'b' });

    expect(result.preview).toBeNull();
    expect(result.record).toBeNull();
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/outside the workspace root/);
  });

  it('attributes the record to the DNA persona and records a learning', async () => {
    const bos = new BehaviorOS({ codeEdit: { enabled: true, root } });
    await bos.loadDNA(makeDna());

    const result = bos.applyCodeEdit({
      file,
      find: 'const x = 1;',
      replace: 'const x = 2;',
      apply: true,
    });

    expect(result.applied).toBe(true);
    // The governed agent, not the model name of whatever host is running.
    expect(result.record?.agentId).toBe(personaIdentity('developer'));
    expect(result.record?.dnaPattern).toBe('Edit DNA');
    expect(bos.exportState().learnings.some((event) => event.source === 'code-edit')).toBe(true);
  });
});
