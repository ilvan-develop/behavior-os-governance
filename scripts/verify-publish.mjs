#!/usr/bin/env node
/**
 * Guard against the failure mode that shipped an unusable release:
 * `npm publish` from the workspace root publishes the *source* manifests, so
 * `workspace:*` dependency ranges and missing `bin` targets end up on the
 * registry. Consumers then cannot install the package at all
 * (`EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`).
 *
 * This script packs every publishable workspace package the way the release
 * does (`pnpm pack`, which rewrites `workspace:*` to the real version) and
 * verifies the packed manifest:
 *
 *   1. no dependency range uses the `workspace:` protocol
 *   2. every `bin` target exists inside the tarball
 *   3. every declared `main` / `types` / `exports` target exists
 *
 * Run it after `pnpm build` and before `changeset publish`.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
const globs = [...workspace.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);

/** Package names changesets is configured to skip (see .changeset/config.json). */
function ignoredPackages() {
  const configPath = join(repoRoot, '.changeset', 'config.json');
  if (!existsSync(configPath)) return new Set();
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return new Set(config.ignore ?? []);
}

function workspacePackageDirs() {
  const dirs = [];
  for (const glob of globs) {
    const base = glob.replace(/\/\*$/, '');
    const parent = join(repoRoot, base);
    if (!existsSync(parent)) continue;
    if (!glob.endsWith('/*')) {
      if (existsSync(join(parent, 'package.json'))) dirs.push(parent);
      continue;
    }
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parent, entry.name);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

const ignore = ignoredPackages();
const candidates = workspacePackageDirs()
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter(({ pkg }) => pkg.private !== true && !ignore.has(pkg.name));

if (candidates.length === 0) {
  console.error('verify-publish: no publishable packages found — check pnpm-workspace.yaml');
  process.exit(1);
}

const packDir = mkdtempSync(join(tmpdir(), 'behavior-os-verify-publish-'));
const failures = [];

function readPackedManifest(tarball) {
  const raw = execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function pack(dir) {
  const output = execSync(`pnpm pack --pack-destination="${packDir}"`, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const match = output.match(/[^\s"']+\.tgz/);
  if (!match) throw new Error('pnpm pack did not report a tarball path');
  const tarball = match[0].trim();
  return existsSync(tarball) ? tarball : join(packDir, tarball.split(/[\\/]/).pop());
}

function listTarball(tarball) {
  return execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^package\//, ''));
}

/**
 * npm links `bin` entries straight to the packed file on Unix, so a missing
 * `#!/usr/bin/env node` line turns the command into "Exec format error".
 */
function hasShebang(tarball, file) {
  const head = execFileSync('tar', ['-xOzf', tarball, `package/${file}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).slice(0, 64);
  return head.startsWith('#!');
}

/** Every file target declared by the manifest that must exist in the tarball. */
function declaredTargets(manifest) {
  const targets = [];
  const push = (value, field) => {
    if (typeof value === 'string') targets.push({ file: value.replace(/^\.\//, ''), field });
  };
  push(manifest.main, 'main');
  push(manifest.types, 'types');
  push(manifest.typings, 'typings');
  for (const value of Object.values(manifest.bin ?? {})) push(value, 'bin');
  const walk = (value, field) => {
    if (typeof value === 'string') push(value, field);
    else if (Array.isArray(value)) {
      for (const entry of value) walk(entry, field);
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) walk(entry, field);
    }
  };
  if (manifest.exports) walk(manifest.exports, 'exports');
  return targets;
}

/** `exports` may use globs (`dist/engine/*.js`); match them against the tarball. */
function matchesWildcard(target, files) {
  if (!target.includes('*')) return false;
  const pattern = new RegExp(
    `^${target
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')}$`,
  );
  for (const file of files) {
    if (pattern.test(file)) return true;
  }
  return false;
}

try {
  for (const { dir, pkg } of candidates) {
    let tarball;
    try {
      tarball = pack(dir);
    } catch (error) {
      failures.push(`${pkg.name}: pnpm pack failed — ${String(error.message).split('\n')[0]}`);
      continue;
    }

    const manifest = readPackedManifest(tarball);
    const files = new Set(listTarball(tarball));

    const protocols = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ];
    for (const field of protocols) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          failures.push(
            `${pkg.name}: ${field}.${name} still uses "${range}" in the packed manifest — publish with \`pnpm\`, never \`npm publish\``,
          );
        }
      }
    }

    for (const { file, field } of declaredTargets(manifest)) {
      if (!files.has(file) && !matchesWildcard(file, files)) {
        failures.push(`${pkg.name}: ${field} target "${file}" is not inside the tarball`);
      }
    }

    for (const [name, binPath] of Object.entries(manifest.bin ?? {})) {
      const file = String(binPath).replace(/^\.\//, '');
      if (files.has(file) && !hasShebang(tarball, file)) {
        failures.push(
          `${pkg.name}: bin "${name}" points at "${file}" without a "#!/usr/bin/env node" shebang`,
        );
      }
    }

    console.log(
      `ok   ${pkg.name}@${manifest.version} — ${files.size} files, ${Object.keys(manifest.dependencies ?? {}).length} deps`,
    );
  }
} finally {
  rmSync(packDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\nverify-publish: ${failures.length} problem(s) would break consumers:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`\nChecked ${candidates.map(({ pkg }) => pkg.name).join(', ')}`);
  process.exit(1);
}

console.log(`\nverify-publish: ${candidates.length} package(s) are installable from the registry.`);
