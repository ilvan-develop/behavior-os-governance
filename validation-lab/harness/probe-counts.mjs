import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 1. Core Engines
const engineDir = 'packages/core/src/engine';
const engineFiles = readdirSync(engineDir).filter(f => f.endsWith('.ts'));
const nonEngines = engineFiles.filter(f => ['index.ts', 'behavior-os.ts', 'behavior-os-types.ts'].includes(f));
const actualEngines = engineFiles.filter(f => !nonEngines.includes(f));
console.log('=== CORE ENGINES ===');
console.log('Total files in engine dir:', engineFiles.length);
console.log('Non-engine files:', nonEngines);
console.log('Actual engine files count:', actualEngines.length);

// 2. MCP Tools & Resources
const mcpServerSource = readFileSync('packages/mcp-server/src/server.ts', 'utf8');
const toolMatches = [];
const regex = /server\.registerTool\(\s*['"]([^'"]+)['"]/g;
let m;
while ((m = regex.exec(mcpServerSource)) !== null) {
  toolMatches.push(m[1]);
}
const resourceMatches = [];
const resRegex = /server\.registerResource\(\s*['"]([^'"]+)['"]/g;
while ((m = resRegex.exec(mcpServerSource)) !== null) {
  resourceMatches.push(m[1]);
}
console.log('\n=== MCP SERVER ===');
console.log('Total registerTool calls:', toolMatches.length);
console.log('Unique tool names:', new Set(toolMatches).size);
console.log('Total registerResource calls:', resourceMatches.length);
console.log('Resources:', resourceMatches);

// 3. OpenCode V2 Tools
const toolsDir = 'plugins/opencode-v2/src/tools';
const toolFiles = readdirSync(toolsDir).filter(f => f.endsWith('.ts'));
const pluginToolNames = new Set();
for (const tf of toolFiles) {
  const content = readFileSync(join(toolsDir, tf), 'utf8');
  const nameRegex = /name:\s*['"](bos_[a-zA-Z0-9_]+)['"]/g;
  while ((m = nameRegex.exec(content)) !== null) {
    pluginToolNames.add(m[1]);
  }
  const addJsonRegex = /addJson\(\s*['"](bos_[a-zA-Z0-9_]+)['"]/g;
  while ((m = addJsonRegex.exec(content)) !== null) {
    pluginToolNames.add(m[1]);
  }
}
// Add exposed engines
const exposedContent = readFileSync('plugins/opencode-v2/src/exposed-engines.ts', 'utf8');
const expRegex = /toolName:\s*['"](bos_[a-zA-Z0-9_]+)['"]/g;
while ((m = expRegex.exec(exposedContent)) !== null) {
  pluginToolNames.add(m[1]);
}
console.log('\n=== OPENCODE V2 PLUGIN ===');
console.log('Unique bos_* tools registered in plugin:', pluginToolNames.size);
