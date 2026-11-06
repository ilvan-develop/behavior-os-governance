#!/usr/bin/env node
/**
 * Regression probe for the MCP DNA library loader.
 *
 * The MCP server accepted `BEHAVIOROS_DNA_PATH` pointing at a single pattern
 * file, but then only that file was selectable. A host configured with
 * `enterprise-governance.yaml` advertised one pattern while the plugin host
 * advertised all 21, so `bos_select_dna` could not resolve patterns the agent
 * had been told were active.
 *
 * This probe spawns the built stdio server in a fresh process with
 * `BEHAVIOROS_DNA_PATH` set to a single file and asserts that the whole sibling
 * library is still selectable. It is chained into `pnpm smoke:mcp`, which runs
 * after `pnpm build`.
 *
 * Usage: node scripts/smoke-dna-library.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'server.js');
const serverCwd = path.join(repoRoot, 'packages', 'mcp-server');
const configuredDna = path.join(repoRoot, 'dnas', 'enterprise-governance.yaml');

const child = spawn(process.execPath, [serverPath], {
  cwd: serverCwd,
  env: { ...process.env, BEHAVIOROS_DNA_PATH: configuredDna },
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
    // Same cold-start budget as smoke-mcp.mjs: the first response imports the
    // built server and loads the DNA library, which can take ~20s on Windows.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for ${method}`));
    }, 30_000);
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
    clientInfo: { name: 'behavioros-dna-library-probe', version: '1.0.0' },
  });
  notify('notifications/initialized', {});

  const catalog = await request('resources/read', { uri: 'behavioros://dna/catalog' });
  const catalogText = catalog?.contents?.[0]?.text ?? '';
  const parsedCatalog = JSON.parse(catalogText);
  const available = parsedCatalog.available ?? [];

  if (available.length !== 21) {
    throw new Error(
      `Expected 21 selectable patterns with a single-file BEHAVIOROS_DNA_PATH, got ${available.length}: ${available.join(', ')}`,
    );
  }
  for (const required of ['enterprise-governance', 'lean-factory', 'surgical-team']) {
    if (!available.includes(required)) {
      throw new Error(`Sibling pattern "${required}" was not loaded: ${available.join(', ')}`);
    }
  }

  const selected = await request('tools/call', {
    name: 'bos_select_dna',
    arguments: { pattern: 'lean-factory' },
  });
  const selectedText = selected?.content?.[0]?.text ?? '';
  if (!/lean-factory/i.test(selectedText)) {
    throw new Error(`bos_select_dna did not resolve the sibling pattern: ${selectedText}`);
  }

  console.log('MCP server          :', init?.serverInfo?.name, init?.serverInfo?.version);
  console.log('Configured DNA file :', path.relative(repoRoot, configuredDna));
  console.log('Selectable patterns :', available.length);
  console.log('bos_select_dna      :', selectedText.replace(/\s+/g, ' ').slice(0, 160));
  console.log('Sibling library loading: verified');
} catch (error) {
  exitCode = 1;
  console.error('DNA library probe failed:', error.message);
  if (stderrChunks.length) console.error(stderrChunks.join(''));
} finally {
  child.kill();
}

process.exit(exitCode);
