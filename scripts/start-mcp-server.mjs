import { spawn } from 'node:child_process';

const server = spawn('node', ['/c/www/behavior-os/packages/mcp-server/dist/mcp-server/server.js'], {
  stdio: 'pipe',
  detached: false,
});

server.stdout.on('data', (data) => {
  console.log('MCP Server stdout:', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('MCP Server stderr:', data.toString());
});

server.on('close', (code) => {
  console.log(`MCP Server exited with code ${code}`);
});

server.on('error', (error) => {
  console.error('MCP Server error:', error);
});

console.log('Starting MCP Server...');
console.log('PID:', server.pid);
