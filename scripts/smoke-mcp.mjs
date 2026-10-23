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
  env: process.env,
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
    // Cold start imports the built server and loads the 21 DNA patterns. On this
    // machine a full smoke run measured 22.2s end-to-end (2026-10-21), so the
    // first response can sit near the old 15s ceiling and fail under load.
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
    clientInfo: { name: 'behavioros-smoke', version: '1.0.0' },
  });
  notify('notifications/initialized', {});

  const { tools } = await request('tools/list', {});
  const names = (tools ?? []).map((tool) => tool.name);

  // R7: the server advertises 30 tools *and* 2 resources. Listing tools alone
  // never exercised the resource leg, so a broken resource handler could pass.
  const { resources } = await request('resources/list', {});
  const resourceUris = (resources ?? []).map((resource) => resource.uri);
  const protocolSteps = await request('resources/read', { uri: 'behavioros://protocol/steps' });
  const dnaCatalog = await request('resources/read', { uri: 'behavioros://dna/catalog' });

  const status = await request('tools/call', { name: 'bos_get_status', arguments: {} });
  const missions = await request('tools/call', { name: 'bos_list_missions', arguments: {} });
  const dna = await request('tools/call', {
    name: 'bos_select_dna',
    arguments: { pattern: 'enterprise-governance' },
  });
  const learning = await request('tools/call', {
    name: 'bos_record_learning',
    arguments: {
      type: 'insight',
      source: 'smoke-mcp',
      content: 'relatedMission must be forwarded to the learning engine',
      impact: 'high',
      relatedMission: 'mission-smoke',
    },
  });

  const listDna = await request('tools/call', { name: 'bos_list_dna', arguments: {} });

  // Governance context must actually be matched now (previously it was spread at
  // the top level and silently matched nothing). enterprise-sox escalates any
  // production change.
  await request('tools/call', {
    name: 'bos_select_dna',
    arguments: { pattern: 'enterprise-sox' },
  });
  const verdict = await request('tools/call', {
    name: 'bos_evaluate_governance',
    arguments: {
      action: 'deploy',
      agent: 'smoke-mcp',
      context: { 'production-change': true },
    },
  });

  const missionsText = missions?.content?.[0]?.text ?? '';
  const dnaText = dna?.content?.[0]?.text ?? '';
  const learningText = learning?.content?.[0]?.text ?? '';
  const listDnaText = listDna?.content?.[0]?.text ?? '';
  const verdictText = verdict?.content?.[0]?.text ?? '';

  console.log('MCP server   :', init?.serverInfo?.name, init?.serverInfo?.version);
  console.log('Tools (%d)   : %s', names.length, names.join(', '));
  console.log('Resources (%d): %s', resourceUris.length, resourceUris.join(', '));
  console.log(
    'bos_get_status:',
    JSON.stringify(status?.content?.[0]?.text ?? status).slice(0, 160),
  );
  console.log('bos_list_missions:', missionsText.replace(/\s+/g, ' ').slice(0, 160));
  console.log('bos_select_dna:', dnaText.replace(/\s+/g, ' ').slice(0, 160));
  console.log('bos_record_learning:', learningText.replace(/\s+/g, ' ').slice(0, 200));
  console.log('bos_list_dna:', listDnaText.replace(/\s+/g, ' ').slice(0, 120));
  console.log('bos_evaluate_governance:', verdictText.replace(/\s+/g, ' ').slice(0, 200));

  if (names.length === 0) throw new Error('No tools registered');
  if (!names.includes('bos_evaluate_governance')) throw new Error('Missing governance tool');
  if (!names.includes('bos_run_audit')) throw new Error('Missing audit tool');
  if (!names.includes('bos_list_dna')) throw new Error('Missing bos_list_dna tool');
  if (resourceUris.length !== 2) {
    throw new Error(`Expected 2 resources, got ${resourceUris.length}: ${resourceUris.join(', ')}`);
  }
  if (!resourceUris.includes('behavioros://protocol/steps')) {
    throw new Error(`Missing protocol resource: ${resourceUris.join(', ')}`);
  }
  const stepsText = protocolSteps?.contents?.[0]?.text ?? '';
  if (!stepsText.includes('bos_select_dna') || !stepsText.includes('bos_run_audit')) {
    throw new Error(`protocol/steps resource does not render the real protocol: ${stepsText}`);
  }
  const catalogText = dnaCatalog?.contents?.[0]?.text ?? '';
  const catalog = JSON.parse(catalogText);
  if (!Array.isArray(catalog.available) || catalog.available.length !== 21) {
    throw new Error(`dna/catalog resource is not the real catalog: ${catalogText.slice(0, 200)}`);
  }

  // Print what the resource assertions actually saw: the gate's own log must
  // show the resource leg ran, not just the URI list (independent audit, #4).
  console.log(
    'resource protocol/steps: renders real steps =',
    stepsText.includes('bos_select_dna') && stepsText.includes('bos_run_audit'),
  );
  console.log('resource dna/catalog: patterns =', catalog.available.length);
  if (dnaText.toLowerCase().includes('not found')) {
    throw new Error(`DNA patterns were not loaded from disk: ${dnaText}`);
  }
  if (!learningText.includes('mission-smoke')) {
    throw new Error(`bos_record_learning dropped relatedMission: ${learningText}`);
  }
  const listDnaParsed = JSON.parse(listDnaText);
  if (!listDnaParsed.total || listDnaParsed.total < 21) {
    throw new Error(`bos_list_dna returned too few patterns: ${listDnaText}`);
  }
  const verdictParsed = JSON.parse(verdictText);
  if (verdictParsed.verdict !== 'escalate') {
    throw new Error(
      `Governance context was not matched: expected escalate, got ${JSON.stringify(verdictParsed)}`,
    );
  }
  console.log('Governance context matched: enterprise-sox escalation on production-change');
} catch (error) {
  exitCode = 1;
  console.error('Smoke test failed:', error.message);
  if (stderrChunks.length) console.error(stderrChunks.join(''));
} finally {
  child.kill();
}

process.exit(exitCode);
