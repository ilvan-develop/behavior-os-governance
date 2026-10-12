import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendGovernanceLog,
  clearGovernanceLog,
  computeGovernanceHash,
  GENESIS_HASH,
  GOVERNANCE_LOG_MAX,
  getGovernanceChainHead,
  getGovernanceLog,
  seedGovernanceLog,
  serializeGovernanceLog,
  verifyGovernanceLog,
} from '../src/governance-log.js';

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
    expect(verifyGovernanceLog()).toEqual({ valid: true, checked: 2 });
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
