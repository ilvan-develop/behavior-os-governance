const { readFileSync, writeFileSync } = require('node:fs');
const { execSync } = require('node:child_process');

const packages = ['core', 'mcp-server', 'schemas', 'cli', 'sdk'];

console.log('🔧 Fixing ESM module extensions in behavior-os dist...\n');

for (const pkg of packages) {
  const distPath = `packages/${pkg}/dist`;
  try {
    const files = execSync(`find ${distPath} -name "*.js" -type f`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    let fixed = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const updated = content.replace(/from\s+'\.\/([^'"]+)(?!\.js)'/g, "from './$1.js'");
      if (updated !== content) {
        writeFileSync(file, updated);
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
