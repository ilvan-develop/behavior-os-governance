// Test script to verify BehaviorOS MCP server works
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_SCRIPT = 'C:/www/behavior-os/packages/mcp-server/dist/server.js';
const INPUT_FILE = '/tmp/mcp_test_input.json';
const OUTPUT_FILE = '/tmp/mcp_test_output.json';

// Create test input
const testInput = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  }
};

writeFileSync(INPUT_FILE, JSON.stringify(testInput));

// Spawn MCP server
const server = spawn('node', [SERVER_SCRIPT], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let outputData = '';

server.stdout.on('data', (data) => {
  outputData += data.toString();
  console.log('MCP Server stdout:', data.toString());
  if (outputData.includes('"result"')) {
    console.log('✅ MCP Server initialized successfully!');
    server.kill();
  }
});

server.stderr.on('data', (data) => {
  console.error('MCP Server stderr:', data.toString());
});

server.on('close', (code) => {
  console.log(`MCP Server exited with code ${code}`);
  try { unlinkSync(INPUT_FILE); } catch {}
  try { unlinkSync(OUTPUT_FILE); } catch {}
});

server.on('error', (error) => {
  console.error('Failed to start MCP Server:', error);
  try { unlinkSync(INPUT_FILE); } catch {}
  try { unlinkSync(OUTPUT_FILE); } catch {}
});

// Send input after a short delay
setTimeout(() => {
  server.stdin.write(JSON.stringify(testInput) + '\n');
}, 500);

console.log('Starting BehaviorOS MCP Server...');
console.log('Testing initialization...');
