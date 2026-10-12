import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendGovernanceLog,
  clearGovernanceLog,
  GOVERNANCE_LOG_MAX,
  getGovernanceLog,
  serializeGovernanceLog,
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
});
