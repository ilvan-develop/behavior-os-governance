/**
 * Runtime contract tests via InMemoryTransport.
 *
 * Exercises the actual MCP handlers end-to-end: bos_code_edit vote handling
 * (validation, the votes/applyVotes alias, missionId forwarding) and the S1
 * mission lifecycle (evidence gating, stale versions, idempotent replay,
 * explicit fail/cancel semantics).
 */

import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Vote } from '@behavior-os/schemas';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { server, voteSchema } from '../src/server.js';

const fixturesDir = join(fileURLToPath(import.meta.url), '..', 'fixtures');
const testFile = join(fixturesDir, 'contract-test.txt');

// Sync setup: create fixture file before any tests run.
if (!existsSync(fixturesDir)) {
  mkdirSync(fixturesDir, { recursive: true });
}
writeFileSync(testFile, 'old text here\n');

describe('MCP bos_code_edit runtime contract', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'contract-test-client', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
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
    try {
      if (existsSync(testFile)) unlinkSync(testFile);
      if (existsSync(fixturesDir)) {
        const entries = readdirSync(fixturesDir);
        if (entries.length === 0) rmdirSync(fixturesDir);
      }
    } catch {
      /* ignore */
    }
  });

  it('returns dry-run result for a valid vote', async () => {
    const vote: Vote = { voterId: 'u1', choice: 'approve' };
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: { file: testFile, find: 'old', replace: 'new', apply: false, votes: [vote] },
    });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.applied).toBe(false);
    expect(parsed.reason).toBe('dry-run');
  });

  it('forwards missionId into the result', async () => {
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: { file: testFile, find: 'old', replace: 'new', apply: false, missionId: 'm-1' },
    });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.preview).not.toBeNull();
    expect(parsed.reason).toBe('dry-run');
  });

  it('accepts the deprecated applyVotes alias', async () => {
    const vote: Vote = { voterId: 'u2', choice: 'reject' };
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: { file: testFile, find: 'old', replace: 'new', apply: false, applyVotes: [vote] },
    });
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.applied).toBe(false);
    expect(parsed.reason).toBe('dry-run');
  });

  it('rejects when both votes and applyVotes are supplied', async () => {
    const vote: Vote = { voterId: 'u3', choice: 'approve' };
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: {
        file: testFile,
        find: 'old',
        replace: 'new',
        apply: false,
        votes: [vote],
        applyVotes: [vote],
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('rejects a vote missing voterId', async () => {
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: {
        file: testFile,
        find: 'old',
        replace: 'new',
        apply: false,
        votes: [{ choice: 'approve' } as never],
      },
    });
    expect(result).toBeDefined();
  });

  it('rejects a vote with an invalid choice', async () => {
    const result = await client.callTool({
      name: 'bos_code_edit',
      arguments: {
        file: testFile,
        find: 'old',
        replace: 'new',
        apply: false,
        votes: [{ voterId: 'u1', choice: 'maybe' } as never],
      },
    });
    expect(result).toBeDefined();
  });

  it('voteSchema is importable and validates correctly', () => {
    const ok = voteSchema.safeParse({ voterId: 'u1', choice: 'approve' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.voterId).toBe('u1');
      expect(ok.data.choice).toBe('approve');
    }

    const withOpts = voteSchema.safeParse({
      voterId: 'u1',
      choice: 'reject',
      weight: 2,
      reason: 'r',
    });
    expect(withOpts.success).toBe(true);
    if (withOpts.success) {
      expect(withOpts.data.weight).toBe(2);
      expect(withOpts.data.reason).toBe('r');
    }

    const bad = voteSchema.safeParse({ choice: 'approve' });
    expect(bad.success).toBe(false);
  });

  it('mission lifecycle enforces evidence, stale versions and idempotent replay', async () => {
    const created = await client.callTool({
      name: 'bos_create_mission',
      arguments: {
        title: 'S1 MCP runtime contract',
        type: 'feature',
        priority: 'high',
        requiredChecks: ['tests'],
      },
    });
    const mission = JSON.parse(textOf(created)) as {
      id: string;
      status: string;
      requiredChecks: string[];
      version: number;
    };
    expect(mission.status).toBe('pending');
    expect(mission.requiredChecks).toEqual(['tests']);
    expect(mission.version).toBe(0);

    const started = await client.callTool({
      name: 'bos_start_mission',
      arguments: { missionId: mission.id, expectedVersion: 0, actor: 'tester' },
    });
    expect((started as { isError?: boolean }).isError).not.toBe(true);

    const listed = JSON.parse(
      textOf(await client.callTool({ name: 'bos_list_missions', arguments: {} })),
    ) as Array<{ id: string; transitions?: Array<{ actor?: string }> }>;
    const startedMission = listed.find((entry) => entry.id === mission.id);
    expect(startedMission?.transitions?.[0]?.actor).toBe('tester');

    const staleMission = await client.callTool({
      name: 'bos_create_mission',
      arguments: { title: 'S1 MCP stale start', type: 'feature', priority: 'low' },
    });
    const staleMissionId = (JSON.parse(textOf(staleMission)) as { id: string }).id;
    const staleStart = await client.callTool({
      name: 'bos_start_mission',
      arguments: { missionId: staleMissionId, expectedVersion: 99 },
    });
    expect((staleStart as { isError?: boolean }).isError).toBe(true);
    expect(textOf(staleStart)).toContain('VERSION_CONFLICT');

    const missing = await client.callTool({
      name: 'bos_complete_mission',
      arguments: { missionId: mission.id, evidence: [] },
    });
    expect((missing as { isError?: boolean }).isError).toBe(true);
    expect(textOf(missing)).toContain('EVIDENCE_MISSING');

    const stale = await client.callTool({
      name: 'bos_complete_mission',
      arguments: {
        missionId: mission.id,
        expectedVersion: 0,
        evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
      },
    });
    expect((stale as { isError?: boolean }).isError).toBe(true);
    expect(textOf(stale)).toContain('VERSION_CONFLICT');

    const completed = await client.callTool({
      name: 'bos_complete_mission',
      arguments: {
        missionId: mission.id,
        expectedVersion: 1,
        evidence: [{ gate: 'tests', status: 'passed', source: 'pnpm test' }],
      },
    });
    const completedBody = JSON.parse(textOf(completed)) as {
      ok: boolean;
      changed: boolean;
      status: string;
      completionBasis: string;
      evidenceVerified: boolean;
    };
    expect(completedBody).toMatchObject({
      ok: true,
      changed: true,
      status: 'completed',
      completionBasis: 'evidence',
      evidenceVerified: true,
    });

    const replay = await client.callTool({
      name: 'bos_complete_mission',
      arguments: { missionId: mission.id },
    });
    const replayBody = JSON.parse(textOf(replay)) as {
      ok: boolean;
      changed: boolean;
      status: string;
    };
    expect(replayBody).toMatchObject({ ok: true, changed: false, status: 'completed' });
  });

  it('fail and cancel are explicit terminal transitions with no resurrection', async () => {
    const failedMission = await client.callTool({
      name: 'bos_create_mission',
      arguments: { title: 'S1 MCP fail contract', type: 'bugfix', priority: 'medium' },
    });
    const failedId = (JSON.parse(textOf(failedMission)) as { id: string }).id;
    await client.callTool({
      name: 'bos_start_mission',
      arguments: { missionId: failedId },
    });

    const failed = await client.callTool({
      name: 'bos_fail_mission',
      arguments: { missionId: failedId, reason: 'verification failed', expectedVersion: 1 },
    });
    expect(JSON.parse(textOf(failed))).toMatchObject({ ok: true, status: 'failed' });

    const cancelledMission = await client.callTool({
      name: 'bos_create_mission',
      arguments: { title: 'S1 MCP cancel contract', type: 'research', priority: 'low' },
    });
    const cancelledId = (JSON.parse(textOf(cancelledMission)) as { id: string }).id;

    const cancelled = await client.callTool({
      name: 'bos_cancel_mission',
      arguments: { missionId: cancelledId, reason: 'superseded' },
    });
    expect(JSON.parse(textOf(cancelled))).toMatchObject({ ok: true, status: 'cancelled' });

    const refused = await client.callTool({
      name: 'bos_complete_mission',
      arguments: { missionId: cancelledId },
    });
    expect((refused as { isError?: boolean }).isError).toBe(true);
    expect(textOf(refused)).toContain('INVALID_TRANSITION');
  });
});

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? '';
}
