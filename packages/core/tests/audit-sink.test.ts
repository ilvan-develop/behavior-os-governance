/**
 * Tests for the durable governance log sink (BEHAVIOR_OS_AUDIT_LOG).
 *
 * Verifies that when the env var is set, the audit trail:
 * - Appends entries to a JSONL file
 * - Survives restart (re-seeds from file)
 * - Detects truncation and corruption
 * - Reports complete: true when the full chain is verifiable
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Governance log durable sink', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = join(
      tmpdir(),
      `behavior-os-audit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );
  });

  afterEach(() => {
    if (existsSync(logFile)) {
      try {
        unlinkSync(logFile);
      } catch {
        /* ignore */
      }
    }
    // Reset module-level sink state between tests to avoid cross-test contamination.
    import('../src/governance-log.js')
      .then((m) => {
        try {
          m.clearGovernanceLog();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  });

  it('appends entries to the JSONL file when sink is enabled', async () => {
    const { initGovernanceLogSink, appendGovernanceLog } = await import('../src/governance-log.js');
    initGovernanceLogSink(logFile);

    appendGovernanceLog({
      kind: 'permission',
      outcome: 'allow',
      dna: 'test',
      step: 0,
      mission: null,
      action: 'read',
      detail: 'ok',
    });
    appendGovernanceLog({
      kind: 'permission',
      outcome: 'deny',
      dna: 'test',
      step: 0,
      mission: null,
      action: 'write',
      detail: 'blocked',
    });

    const entries = readFileSync(logFile, 'utf8').trim().split('\n');
    expect(entries).toHaveLength(2);
    const first = JSON.parse(entries[0]);
    expect(first.kind).toBe('permission');
    expect(first.outcome).toBe('allow');
    expect(first.seq).toBe(1);
  });

  it('detects a truncated head (missing genesis)', async () => {
    const { verifyGovernanceLogFile } = await import('../src/governance-log.js');
    writeFileSync(
      logFile,
      `${JSON.stringify({
        seq: 2,
        prevHash: 'abc',
        hash: 'def',
        kind: 'permission',
        outcome: 'allow',
        dna: 't',
        step: 0,
        mission: null,
        action: 'r',
        detail: 'd',
        at: new Date().toISOString(),
      })}\n`,
    );

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.reason).toContain('truncated');
  });

  it('reports complete: true when chain starts at genesis', async () => {
    const { initGovernanceLogSink, appendGovernanceLog, verifyGovernanceLogFile } = await import(
      '../src/governance-log.js'
    );
    initGovernanceLogSink(logFile);
    appendGovernanceLog({
      kind: 'permission',
      outcome: 'allow',
      dna: 'test',
      step: 0,
      mission: null,
      action: 'read',
      detail: 'ok',
    });

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.checked).toBe(1);
  });

  it('detects a hash mismatch (tampered entry)', async () => {
    const { initGovernanceLogSink, appendGovernanceLog, verifyGovernanceLogFile } = await import(
      '../src/governance-log.js'
    );
    initGovernanceLogSink(logFile);
    appendGovernanceLog({
      kind: 'permission',
      outcome: 'allow',
      dna: 'test',
      step: 0,
      mission: null,
      action: 'read',
      detail: 'ok',
    });
    appendGovernanceLog({
      kind: 'permission',
      outcome: 'deny',
      dna: 'test',
      step: 0,
      mission: null,
      action: 'write',
      detail: 'blocked',
    });

    // Tamper with the second entry's detail without recomputing its hash.
    const lines = readFileSync(logFile, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[1]);
    entry.detail = 'tampered';
    lines[1] = JSON.stringify(entry);
    writeFileSync(logFile, `${lines.join('\n')}\n`);

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('hash mismatch');
  });

  // Two OpenCode sessions can point at the same BEHAVIOR_OS_AUDIT_LOG and
  // append concurrently. Their per-process sequence counters interleave, so the
  // file is a multiplexed log: the verifier must attest each instance chain
  // instead of demanding one global contiguous sequence.
  async function multiplexedEntries() {
    const { computeGovernanceHash, GENESIS_HASH } = await import('../src/governance-log.js');
    const at = new Date().toISOString();
    const make = (instance: string, seq: number, prevHash: string, detail: string) => {
      const base = {
        seq,
        at,
        instance,
        kind: 'permission' as const,
        outcome: 'allow' as const,
        dna: 'test',
        step: 0,
        mission: null,
        action: 'a',
        detail,
        prevHash,
      };
      return { ...base, hash: computeGovernanceHash(base) };
    };
    const a1 = make('p1-aaa', 1, GENESIS_HASH, 'a1');
    const b1 = make('p2-bbb', 1, GENESIS_HASH, 'b1');
    const a2 = make('p1-aaa', 2, a1.hash, 'a2');
    const b2 = make('p2-bbb', 2, b1.hash, 'b2');
    const a3 = make('p1-aaa', 3, a2.hash, 'a3');
    return { a1, a2, a3, b1, b2 };
  }

  it('verifies each instance chain when several sessions interleave in one sink', async () => {
    const { verifyGovernanceLogFile } = await import('../src/governance-log.js');
    const { a1, b1, a2, b2 } = await multiplexedEntries();
    writeFileSync(
      logFile,
      `${[a1, b1, a2, b2].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    );

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(4);
    // No single instance attests the whole file, so it cannot be "complete".
    expect(result.complete).toBe(false);
  });

  it('still detects a hash mismatch inside one instance of a multiplexed sink', async () => {
    const { verifyGovernanceLogFile } = await import('../src/governance-log.js');
    const { a1, b1, a2, b2 } = await multiplexedEntries();
    const tampered = { ...b2, detail: 'tampered' };
    writeFileSync(
      logFile,
      `${[a1, b1, a2, tampered].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    );

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('hash mismatch in instance p2-bbb');
  });

  it('detects a deleted middle line within one instance of a multiplexed sink', async () => {
    const { verifyGovernanceLogFile } = await import('../src/governance-log.js');
    const { a1, b1, a3, b2 } = await multiplexedEntries();
    // a2 (seq 2) is missing: the p1-aaa chain must jump from seq 1 to seq 3.
    writeFileSync(
      logFile,
      `${[a1, b1, a3, b2].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    );

    const result = verifyGovernanceLogFile(logFile);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sequence gap in instance p1-aaa');
  });
});
