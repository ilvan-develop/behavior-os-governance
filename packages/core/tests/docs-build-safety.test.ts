import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the "typedoc eats the hand-written docs" incident.
 *
 * A bare `typedoc` (no config) defaults `out` to `./docs` with
 * `cleanOutputDir: true`, so it deletes every hand-written markdown file under
 * `docs/`. This test asserts the configuration can never do that again: the
 * output directory must be a dedicated, isolated, git-ignored directory.
 *
 * The test never runs typedoc, so it is safe even when the config is broken.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const TYPEDOC_CONFIG = resolve(repoRoot, 'typedoc.json');
const GITIGNORE = resolve(repoRoot, '.gitignore');
const DOCS_DIR = resolve(repoRoot, 'docs');

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(TYPEDOC_CONFIG, 'utf-8')) as Record<string, unknown>;
}

/** Converts a .gitignore-ish glob into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // `**` must be tried before `*`; a sentinel placeholder is unnecessary and
  // would trip `lint/suspicious/noControlCharactersInRegex` when matched back.
  const withGlobs = escaped
    .replace(/\*\*|\*/g, (match) => (match === '**' ? '.*' : '[^/]*'))
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${withGlobs}$`);
}

/**
 * True when `relPath` (posix, relative to the repo root) is ignored by some
 * entry in the given .gitignore text. A gitignore pattern ignores a path when
 * it matches the path itself or any of its ancestor directories.
 */
function isIgnored(relPath: string, gitignore: string): boolean {
  const rel = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = rel.split('/');
  let ignored = false;

  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = (negated ? line.slice(1) : line).replace(/\/+$/, '');
    if (pattern === '') continue;

    const rx = globToRegExp(pattern);
    const hit = parts.some((_, index) => rx.test(parts.slice(0, index + 1).join('/')));
    if (hit) ignored = !negated;
  }

  return ignored;
}

describe('docs build safety', () => {
  it('has a typedoc config file', () => {
    expect(existsSync(TYPEDOC_CONFIG), `expected ${TYPEDOC_CONFIG} to exist`).toBe(true);
  });

  it('configures a non-empty entry point list whose files all exist', () => {
    const entryPoints = readConfig().entryPoints;
    expect(Array.isArray(entryPoints), 'typedoc.json "entryPoints" must be an array').toBe(true);

    const list = entryPoints as unknown[];
    expect(list.length, 'typedoc.json "entryPoints" must not be empty').toBeGreaterThan(0);

    for (const entry of list) {
      expect(typeof entry, `entry point ${String(entry)} must be a string`).toBe('string');
      const file = resolve(repoRoot, entry as string);
      expect(existsSync(file), `entry point ${String(entry)} does not exist on disk`).toBe(true);
    }
  });

  it('never points typedoc output at the repo root or the hand-written docs directory', () => {
    const out = readConfig().out;
    expect(typeof out, 'typedoc.json "out" must be a string').toBe('string');
    expect((out as string).length, 'typedoc.json "out" must not be empty').toBeGreaterThan(0);

    const resolved = resolve(repoRoot, out as string);
    expect(
      resolved,
      `typedoc "out" resolves to the repo root (${resolved}); cleanOutputDir would wipe the repository`,
    ).not.toBe(repoRoot);
    expect(
      resolved,
      `typedoc "out" resolves to the hand-written docs directory (${resolved}); cleanOutputDir would delete docs/`,
    ).not.toBe(DOCS_DIR);
  });

  it('keeps the typedoc output directory out of version control', () => {
    const out = readConfig().out as string;
    const rel = out.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const gitignore = readFileSync(GITIGNORE, 'utf-8');
    expect(
      isIgnored(rel, gitignore),
      `typedoc "out" (${rel}) is not ignored by .gitignore; generated output must not be committed`,
    ).toBe(true);
  });
});
