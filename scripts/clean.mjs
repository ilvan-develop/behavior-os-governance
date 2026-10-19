#!/usr/bin/env node
/**
 * Cross-platform removal helper used by every workspace package's `clean`
 * script and by the root `clean:all` script.
 *
 * Usage:
 *   node <path-to>/scripts/clean.mjs [target ...]
 *
 * With no arguments it removes `dist` from the current working directory.
 * Targets are resolved against the current working directory, so the exact
 * same helper works from `packages/*` and `plugins/*` when invoked as
 * `node ../../scripts/clean.mjs`.
 *
 * Uses `node:fs.rmSync` only — no shell, no `rm -rf`, no `Remove-Item` — so it
 * behaves identically on Windows and POSIX.
 */
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : ['dist'];

for (const target of targets) {
  const absolute = resolve(process.cwd(), target);

  // Never allow a typo to wipe the working directory itself or a volume root.
  if (absolute === process.cwd() || dirname(absolute) === absolute) {
    throw new Error(`clean.mjs: refusing to remove unsafe path "${absolute}"`);
  }

  rmSync(absolute, { recursive: true, force: true });
  console.log(`clean.mjs: removed ${absolute}`);
}
