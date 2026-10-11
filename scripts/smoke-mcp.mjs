#!/usr/bin/env node
/**
 * Runtime smoke test for the Behavior-OS MCP server.
 *
 * Spawns the built stdio MCP server, performs the MCP handshake, lists the
 * registered tools, and calls a couple of them. This validates the full path
 * that OpenCode uses when it launches the server (ESM resolution, DNA loading,
 * tool registration) without needing a model.
 *
 * Usage: node scripts/smoke-mcp.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'server.js');
const serverCwd = path.join(repoRoot, 'packages', 'mcp-server');

const child = spawn(process.execPath, [serverPath], {
  cwd: serverCwd,
  env: {
    ...process.env,
    BEHAVIOROS_LOG_LEVEL: 'error',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const pending = new Map();
let nextId = 1;
const stderrChunks = [];

child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString()));

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    } catch {
      // ignore non-JSON lines
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for ${method}`));
    }, 15000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

let exitCode = 0;
try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'behavioros-smoke', version: '1.0.0' },
  });
  notify('notifications/initialized', {});

  const { tools } = await request('tools/list', {});
  const names = (tools ?? []).map((tool) => tool.name);

  const status = await request('tools/call', { name: 'bos_get_status', arguments: {} });
  const missions = await request('tools/call', { name: 'bos_list_missions', arguments: {} });
  const dna = await request('tools/call', {
    name: 'bos_select_dna',
    arguments: { pattern: 'enterprise-governance' },
  });
  const missionsText = missions?.content?.[0]?.text ?? '';
  const dnaText = dna?.content?.[0]?.text ?? '';

  console.log('MCP server   :', init?.serverInfo?.name, init?.serverInfo?.version);
  console.log('Tools (%d)   : %s', names.length, names.join(', '));
  console.log(
    'bos_get_status:',
    JSON.stringify(status?.content?.[0]?.text ?? status).slice(0, 160),
  );
  console.log('bos_list_missions:', missionsText.replace(/\s+/g, ' ').slice(0, 160));
  console.log('bos_select_dna:', dnaText.replace(/\s+/g, ' ').slice(0, 160));

  if (names.length === 0) throw new Error('No tools registered');
  if (!names.includes('bos_evaluate_governance')) throw new Error('Missing governance tool');
  if (!names.includes('bos_run_audit')) throw new Error('Missing audit tool');
  if (dnaText.toLowerCase().includes('not found')) {
    throw new Error(`DNA patterns were not loaded from disk: ${dnaText}`);
  }
} catch (error) {
  exitCode = 1;
  console.error('Smoke test failed:', error.message);
  if (stderrChunks.length) console.error(stderrChunks.join(''));
} finally {
  child.kill();
}

process.exit(exitCode);
