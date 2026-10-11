#!/usr/bin/env node
/**
 * Fix ESM module extensions in compiled JavaScript files
 * This script adds .js extensions to relative imports in dist directories
 */

import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';

const packages = ['core', 'mcp-server', 'schemas', 'cli', 'sdk'];

console.log('🔧 Fixing ESM module extensions in behavior-os dist...\n');

for (const pkg of packages) {
  const distPath = `packages/${pkg}/dist`;
  if (!existsSync(distPath)) {
    console.log(`  ⏭️  Skipping ${pkg} (no dist directory)`);
    continue;
  }

  try {
    // Use find + sed to add .js extensions
    const findCmd = `find ${distPath} -name "*.js" -type f`;
    const files = execSync(findCmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    let fixed = 0;
    for (const file of files) {
      const content = require('fs').readFileSync(file, 'utf8');
      // Match imports without extensions (not starting with @ or http)
      const updated = content.replace(
        /from\s+'\.\/([^'"]+)(?!\.js)'/g,
        "from './$1.js'"
      );
      if (updated !== content) {
        require('fs').writeFileSync(file, updated);
        fixed++;
        console.log(`  ✅ Fixed ${file.replace('packages/', '')}`);
      }
    }

    console.log(`  📦 ${pkg}: ${fixed} file(s) fixed`);
  } catch (error) {
    console.error(`  ❌ Error fixing ${pkg}: ${error.message}`);
  }
}

console.log('\n✅ ESM module extensions fixed!');
