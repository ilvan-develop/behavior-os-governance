#!/usr/bin/env node
/**
 * Copy the repository DNA patterns into the plugin build so a published
 * `@behavior-os/opencode-plugin` can scaffold them from `dist/dnas` when a
 * project runs `/bos-init`. Without this the dormant bootstrap command has no
 * patterns to copy outside a checkout of this repository.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'dnas');
const destination = join(repoRoot, 'plugins', 'opencode-v2', 'dist', 'dnas');

if (!existsSync(source)) {
  console.error(`copy-plugin-dnas: DNA source directory is missing: ${source}`);
  process.exit(1);
}

mkdirSync(destination, { recursive: true });

let copied = 0;
for (const file of readdirSync(source)) {
  if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
  copyFileSync(join(source, file), join(destination, file));
  copied += 1;
}

if (copied === 0) {
  console.error(`copy-plugin-dnas: no DNA patterns found in ${source}`);
  process.exit(1);
}

console.log(`copy-plugin-dnas: ${copied} pattern(s) -> ${destination}`);
