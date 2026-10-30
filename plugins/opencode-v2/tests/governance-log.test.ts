import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendGovernanceLog,
  clearGovernanceLog,
  computeGovernanceHash,
  GENESIS_HASH,
  GOVERNANCE_LOG_MAX,
  getGovernanceChainHead,
  getGovernanceLog,
  getGovernanceLogSinkStatus,
  initGovernanceLogSink,
  seedGovernanceLog,
  serializeGovernanceLog,
  verifyGovernanceLog,
  verifyGovernanceLogFile,
} from '@behavior-os/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function sampleInput(overrides: Partial<Parameters<typeof appendGovernanceLog>[0]> = {}) {
  return {
    kind: 'permission' as const,
    outcome: 'deny' as const,
    dna: 'surgical-team',
    step: 0,
    mission: null,
    action: 'bash',
    detail: 'Production change blocked',
    ...overrides,
  };
}

describe('governance log module', () => {
  afterEach(() => {
    clearGovernanceLog();
    vi.restoreAllMocks();
  });

  it('appends events with a monotonic sequence and ISO timestamp', () => {
    const first = appendGovernanceLog(sampleInput({ action: 'a' }));
    const second = appendGovernanceLog(sampleInput({ action: 'b' }));

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(first.at)).not.toBeNaN();
    expect(second.kind).toBe('permission');
    expect(second.outcome).toBe('deny');
    expect(second.dna).toBe('surgical-team');
  });

  it('returns the most recent events, newest last, honoring the limit', () => {
    for (let index = 0; index < 10; index += 1) {
      appendGovernanceLog(sampleInput({ action: `action-${index}` }));
    }

    const all = getGovernanceLog(100);
    expect(all).toHaveLength(10);
    expect(all[0].action).toBe('action-0');
    expect(all[9].action).toBe('action-9');

    const limited = getGovernanceLog(3);
    expect(limited).toHaveLength(3);
    expect(limited[0].action).toBe('action-7');
    expect(limited[2].action).toBe('action-9');
  });

  it('caps the ring buffer at GOVERNANCE_LOG_MAX entries', () => {
    for (let index = 0; index < GOVERNANCE_LOG_MAX + 10; index += 1) {
      appendGovernanceLog(sampleInput({ action: `action-${index}` }));
    }

    const entries = getGovernanceLog(GOVERNANCE_LOG_MAX + 100);
    expect(entries).toHaveLength(GOVERNANCE_LOG_MAX);
    // The oldest 10 entries are evicted; sequence numbers keep counting.
    expect(entries[0].action).toBe(`action-${10}`);
    expect(entries[entries.length - 1].action).toBe(`action-${GOVERNANCE_LOG_MAX + 9}`);
  });

  it('echoes deny/escalate/error events to the console, but not info', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    appendGovernanceLog(sampleInput({ outcome: 'deny', detail: 'Blocked' }));
    appendGovernanceLog(sampleInput({ outcome: 'escalate', detail: 'Needs approval' }));
    appendGovernanceLog(sampleInput({ outcome: 'error', detail: 'Tool failed' }));
    appendGovernanceLog(sampleInput({ outcome: 'info', detail: 'Benign' }));

    const lines = spy.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes('[Behavior-OS:LOG:permission:deny]'))).toHaveLength(
      1,
    );
    expect(
      lines.filter((line) => line.includes('[Behavior-OS:LOG:permission:escalate]')),
    ).toHaveLength(1);
    expect(
      lines.filter((line) => line.includes('[Behavior-OS:LOG:permission:error]')),
    ).toHaveLength(1);
    // 'info' outcomes are not echoed, so no 4th line for the same kind.
    expect(lines.filter((line) => line.includes('[Behavior-OS:LOG:permission:info]'))).toHaveLength(
      0,
    );
  });

  it('serializes an event into a single greppable line', () => {
    const entry = appendGovernanceLog(
      sampleInput({ dna: 'devops-pipeline', detail: 'Deploy requires approval' }),
    );
    const line = serializeGovernanceLog(entry);

    expect(line).toContain('[Behavior-OS:LOG:permission:deny]');
    expect(line).toContain('dna=devops-pipeline');
    expect(line).toContain('step=0');
    expect(line).toContain('action="bash"');
    expect(line).toContain('Deploy requires approval');
  });

  it('stamps every event with a stable per-instance identity', () => {
    const first = appendGovernanceLog(sampleInput({ action: 'a' }));
    const second = appendGovernanceLog(sampleInput({ action: 'b' }));

    expect(first.instance).toBeTruthy();
    // Stable within a process, so concurrent instances are distinguishable.
    expect(first.instance).toBe(second.instance);
    expect(serializeGovernanceLog(first)).toContain(`inst=${first.instance}`);
  });
});

describe('governance log hash chain (tamper-evidence)', () => {
  afterEach(() => {
    clearGovernanceLog();
    vi.restoreAllMocks();
  });

  it('links each event to the previous one, starting at genesis', () => {
    const first = appendGovernanceLog(sampleInput({ action: 'a' }));
    const second = appendGovernanceLog(sampleInput({ action: 'b' }));

    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(second.prevHash).toBe(first.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.hash).not.toBe(first.hash);
    expect(verifyGovernanceLog()).toEqual({ valid: true, checked: 2, complete: true });
  });

  it('reports the first tampered event instead of the whole chain', () => {
    appendGovernanceLog(sampleInput({ action: 'a' }));
    const second = appendGovernanceLog(sampleInput({ action: 'b' }));
    appendGovernanceLog(sampleInput({ action: 'c' }));

    // Simulate an out-of-band edit of a stored event.
    second.detail = 'tampered';

    const result = verifyGovernanceLog();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(second.seq);
  });

  it('stays verifiable after the ring buffer evicts older events', () => {
    for (let index = 0; index < GOVERNANCE_LOG_MAX + 5; index += 1) {
      appendGovernanceLog(sampleInput({ action: `a-${index}` }));
    }

    const retained = getGovernanceLog(GOVERNANCE_LOG_MAX + 100);
    expect(retained).toHaveLength(GOVERNANCE_LOG_MAX);
    expect(verifyGovernanceLog(retained).valid).toBe(true);
  });

  it('exposes the chain head and anchors restored events', () => {
    appendGovernanceLog(sampleInput({ action: 'a' }));
    const tail = appendGovernanceLog(sampleInput({ action: 'b' }));
    const head = getGovernanceChainHead();

    expect(head.head).toBe(tail.hash);
    expect(head.length).toBe(2);

    const snapshot = getGovernanceLog(50);
    clearGovernanceLog();
    expect(seedGovernanceLog(snapshot)).toBe(2);
    expect(verifyGovernanceLog().valid).toBe(true);
    expect(getGovernanceChainHead().head).toBe(tail.hash);
  });

  it('recomputes a hashless legacy event so old snapshots still verify', () => {
    const legacy = {
      seq: 1,
      at: new Date().toISOString(),
      instance: 'legacy',
      kind: 'tool',
      outcome: 'info',
      dna: null,
      step: 0,
      mission: null,
      action: 'x',
      detail: 'pre-hash snapshot',
    };
    expect(seedGovernanceLog([legacy])).toBe(1);
    const [stored] = getGovernanceLog(1);
    expect(stored.hash).toBe(computeGovernanceHash(stored));
    expect(verifyGovernanceLog().valid).toBe(true);
  });
});

describe('durable append-only audit sink', () => {
  let dir: string;
  let file: string;

  function setup(): void {
    dir = mkdtempSync(join(tmpdir(), 'bos-audit-'));
    file = join(dir, 'audit.jsonl');
  }

  beforeEach(() => {
    // deny/escalate events echo to the console; keep the test output readable.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    initGovernanceLogSink(null);
    clearGovernanceLog();
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('appends every event to the JSONL file and verifies the whole history', () => {
    setup();
    initGovernanceLogSink(file);

    appendGovernanceLog(sampleInput({ action: 'a' }));
    appendGovernanceLog(sampleInput({ action: 'b' }));
    appendGovernanceLog(sampleInput({ detail: 'Deploy requires approval', action: 'bash' }));

    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(getGovernanceLogSinkStatus()).toEqual({ path: file, writeErrors: 0 });

    const verification = verifyGovernanceLogFile(file);
    expect(verification).toEqual({ valid: true, checked: 3, complete: true });
  });

  it('restores the log from the sink on init and keeps one continuous chain', () => {
    setup();
    initGovernanceLogSink(file);
    appendGovernanceLog(sampleInput({ action: 'a' }));
    appendGovernanceLog(sampleInput({ action: 'b' }));

    // Simulate a restart: fresh memory, same sink.
    clearGovernanceLog();
    initGovernanceLogSink(file);

    expect(getGovernanceLog(10)).toHaveLength(2);
    const next = appendGovernanceLog(sampleInput({ action: 'c' }));

    expect(next.seq).toBe(3);
    expect(verifyGovernanceLogFile(file).valid).toBe(true);
    expect(verifyGovernanceLogFile(file).checked).toBe(3);
  });

  it('does not clobber a sink-restored log with a shorter snapshot tail', () => {
    setup();
    initGovernanceLogSink(file);
    for (let index = 0; index < 5; index += 1) {
      appendGovernanceLog(sampleInput({ action: `a-${index}` }));
    }
    const tail = getGovernanceLog(2);

    clearGovernanceLog();
    initGovernanceLogSink(file);
    expect(seedGovernanceLog(tail)).toBe(0);
    expect(getGovernanceLog(10)).toHaveLength(5);
  });

  it('detects a truncated head', () => {
    setup();
    initGovernanceLogSink(file);
    appendGovernanceLog(sampleInput({ action: 'a' }));
    appendGovernanceLog(sampleInput({ action: 'b' }));

    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    writeFileSync(file, `${lines.slice(1).join('\n')}\n`);

    const verification = verifyGovernanceLogFile(file);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('truncated head');
  });

  it('detects a deleted middle line through the sequence gap', () => {
    setup();
    initGovernanceLogSink(file);
    appendGovernanceLog(sampleInput({ action: 'a' }));
    appendGovernanceLog(sampleInput({ action: 'b' }));
    appendGovernanceLog(sampleInput({ action: 'c' }));

    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    writeFileSync(file, [lines[0], lines[2], ''].join('\n'));

    const verification = verifyGovernanceLogFile(file);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('sequence gap');
  });

  it('detects an edited entry and reports a missing file', () => {
    setup();
    initGovernanceLogSink(file);
    appendGovernanceLog(sampleInput({ action: 'a' }));

    const [line] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const edited = JSON.parse(line) as Record<string, unknown>;
    edited.detail = 'rewritten after the fact';
    writeFileSync(file, `${JSON.stringify(edited)}\n`);

    const tampered = verifyGovernanceLogFile(file);
    expect(tampered.valid).toBe(false);
    expect(tampered.reason).toContain('hash mismatch');

    const missing = verifyGovernanceLogFile(join(dir, 'does-not-exist.jsonl'));
    expect(missing.valid).toBe(false);
    expect(missing.reason).toBe('audit log not found');
  });

  it('counts a failed sink write instead of breaking governance', () => {
    setup();
    initGovernanceLogSink(join(dir, 'nested', 'missing', 'audit.jsonl'));

    expect(() => appendGovernanceLog(sampleInput({ action: 'a' }))).not.toThrow();

    expect(getGovernanceLogSinkStatus()).toEqual({
      path: join(dir, 'nested', 'missing', 'audit.jsonl'),
      writeErrors: 1,
    });
    // The in-memory trail still records the event.
    expect(getGovernanceLog(10)).toHaveLength(1);
  });
});
