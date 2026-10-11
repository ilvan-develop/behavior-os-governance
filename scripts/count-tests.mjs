#!/usr/bin/env node
/**
 * Count actual test cases across the monorepo.
 * Finds all .test.ts files, counts test blocks (describe/it), reports per-package.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

// Packages to scan (exclude node_modules)
const packages = [
  'packages/schemas',
  'packages/core',
  'packages/mcp-server',
  'packages/sdk',
  'packages/cli',
  'plugins/opencode-v2',
  'examples',
];

function isTestFile(name) {
  return name.endsWith('.test.ts') || name.endsWith('.test.js');
}

async function findTestFiles(dir) {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        results.push(...(await findTestFiles(full)));
      } else if (isTestFile(entry.name)) {
        results.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}

async function countTestsInFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  // Count top-level describe blocks
  const describeMatches = content.match(/\bdescribe\s*\(/g) || [];
  // Count it() calls (individual test cases)
  const itMatches = content.match(/\bit\s*\(/g) || [];
  const xitMatches = content.match(/\bxit\s*\(/g) || [];
  // Also count test() calls
  const testMatches = content.match(/\btest\s*\(/g) || [];
  const xtestMatches = content.match(/\bxtest\s*\(/g) || [];

  const totalCases =
    itMatches.length + xitMatches.length + testMatches.length + xtestMatches.length;
  const totalDescribe = describeMatches.length;

  return { totalCases, totalDescribe, itMatches: itMatches.length };
}

function _packageFromPath(filePath) {
  const rel = filePath.replace(`${repoRoot.replace(/\\/g, '/')}/`, '');
  const parts = rel.split('/');
  if (parts[0] === 'packages') return `@behavior-os/${parts[1]}`;
  if (parts[0] === 'plugins') return `plugin-${parts[1]}`;
  if (parts[0] === 'examples') return '@behavior-os/examples';
  return parts[0];
}

async function main() {
  const results = new Map(); // package -> { files, cases, describes }

  for (const pkg of packages) {
    const pkgDir = join(repoRoot, pkg);
    try {
      const files = await findTestFiles(pkgDir);
      let totalCases = 0;
      let totalDescribes = 0;
      for (const f of files) {
        const counts = await countTestsInFile(f);
        totalCases += counts.totalCases;
        totalDescribes += counts.totalDescribe;
      }
      if (files.length > 0) {
        results.set(pkg, {
          files: files.length,
          cases: totalCases,
          describes: totalDescribes,
          fileDetails: files.map((f) => ({
            name: f.replace(`${repoRoot}\\`, '').replace(/\\/g, '/'),
            cases: (() => {
              try {
                return countTestsInFile(f).then((r) => r.totalCases);
              } catch {
                return 0;
              }
            })(),
          })),
        });
      }
    } catch {
      // Package not found or unreadable
    }
  }

  // Print results
  let grandTotalCases = 0;
  let grandTotalFiles = 0;

  console.log('=== Behavior-OS Test Count Report ===\n');

  for (const [pkg, data] of results) {
    console.log(`${pkg}:`);
    console.log(`  Files: ${data.files}`);
    console.log(`  Test cases (it/test): ${data.cases}`);
    console.log(`  Describe blocks: ${data.describes}`);
    grandTotalCases += data.cases;
    grandTotalFiles += data.files;
  }

  console.log('\n=== Summary ===');
  console.log(`Total test files: ${grandTotalFiles}`);
  console.log(`Total test cases: ${grandTotalCases}`);
  console.log(`Packages with tests: ${results.size}`);
}

main().catch(console.error);
