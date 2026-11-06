/**
 * Runtime proof for the DNA library fix.
 *
 * The MCP host used to load exactly one pattern when `BEHAVIOROS_DNA_PATH`
 * pointed at a single file (the user-level OpenCode registration points at
 * `./dnas/enterprise-governance.yaml`). The plugin host surfaced all 21
 * patterns, so `bos_select_dna({ pattern: 'lean-factory' })` failed with
 * "not found" even though the injected context claimed Lean Factory was
 * active. A configured file must still expose every sibling pattern.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { server } from '../src/server.js';

const singleFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'dnas',
  'enterprise-governance.yaml',
);

type TextResult = { content: Array<{ type: string; text: string }> };

describe('MCP DNA library loading', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  const previous = process.env.BEHAVIOROS_DNA_PATH;

  beforeAll(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'dna-library-test', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.BEHAVIOROS_DNA_PATH;
    else process.env.BEHAVIOROS_DNA_PATH = previous;
    try {
      await clientTransport.close();
    } catch {
      /* ignore */
    }
    try {
      await serverTransport.close();
    } catch {
      /* ignore */
    }
  });

  it('exposes sibling patterns when BEHAVIOROS_DNA_PATH is a single file', async () => {
    process.env.BEHAVIOROS_DNA_PATH = singleFile;
    const result = (await client.callTool({
      name: 'bos_list_dna',
      arguments: {},
    })) as TextResult;
    const parsed = JSON.parse(result.content[0].text) as {
      total: number;
      patterns: Array<{ key: string }>;
    };
    const keys = parsed.patterns.map((pattern) => pattern.key);
    expect(parsed.total).toBeGreaterThanOrEqual(21);
    expect(keys).toContain('enterprise-governance');
    expect(keys).toContain('lean-factory');
  });

  it('resolves a sibling pattern through bos_select_dna', async () => {
    process.env.BEHAVIOROS_DNA_PATH = singleFile;
    const result = (await client.callTool({
      name: 'bos_select_dna',
      arguments: { pattern: 'lean-factory' },
    })) as TextResult;
    const text = result.content[0].text;
    expect(text).not.toContain('not found');
    expect(text.toLowerCase()).toContain('lean-factory');
    expect(text.toLowerCase()).toContain('selected successfully');
  });
});
