import { describe, expect, it } from 'vitest';
import {
  NotificationCoalescer,
  type NotificationIdentity,
  notificationKey,
} from '../src/notifications.js';

const identity = (overrides: Partial<NotificationIdentity> = {}): NotificationIdentity => ({
  sessionID: 'ses-test',
  kind: 'deny',
  action: 'edit',
  reason: 'Blocked by rule: license-check',
  ...overrides,
});

function make(options: Partial<ConstructorParameters<typeof NotificationCoalescer>[0]> = {}) {
  const clock = { now: 1_000 };
  const coalescer = new NotificationCoalescer({
    windowMs: 60_000,
    maxPerWindow: 3,
    now: () => clock.now,
    ...options,
  });
  return { coalescer, clock };
}

describe('NotificationCoalescer', () => {
  it('sends the first decision and suppresses an identical one', () => {
    const { coalescer } = make();
    expect(coalescer.take(identity()).send).toBe(true);

    const second = coalescer.take(identity());
    expect(second.send).toBe(false);
    expect(second.suppressed).toBe('duplicate');
    expect(coalescer.stats('ses-test')).toEqual({
      sent: 1,
      suppressedDuplicate: 1,
      suppressedCap: 0,
    });
  });

  it('keeps distinct decisions distinct', () => {
    const { coalescer } = make({ maxPerWindow: 10 });
    const distinct = [
      identity(),
      identity({ kind: 'escalate' }),
      identity({ action: 'bash' }),
      identity({ reason: 'Blocked by another rule' }),
      identity({ sessionID: 'ses-other' }),
    ];
    for (const item of distinct) expect(coalescer.take(item).send).toBe(true);

    expect(coalescer.stats('ses-test').sent).toBe(4);
    expect(coalescer.stats('ses-other').sent).toBe(1);
  });

  it('normalises whitespace but preserves wording, case and punctuation', () => {
    const { coalescer } = make();
    expect(coalescer.take(identity({ reason: 'Blocked  by\trule' })).send).toBe(true);
    expect(coalescer.take(identity({ reason: ' Blocked by rule ' })).suppressed).toBe('duplicate');

    const { coalescer: other } = make();
    expect(other.take(identity({ reason: 'Blocked by rule' })).send).toBe(true);
    expect(other.take(identity({ reason: 'blocked by rule' })).send).toBe(true);
    expect(other.take(identity({ reason: 'Blocked by rule.' })).send).toBe(true);
  });

  it('expires the cap window exactly at the boundary', () => {
    const { coalescer, clock } = make({ windowMs: 1_000, dedupeTtlMs: 1_000 });
    expect(coalescer.take(identity()).send).toBe(true);

    clock.now += 999;
    expect(coalescer.take(identity()).suppressed).toBe('duplicate');

    clock.now += 1;
    expect(coalescer.take(identity()).send).toBe(true);
  });

  it('caps distinct notices per window and recovers after the window', () => {
    const { coalescer, clock } = make({ windowMs: 1_000, maxPerWindow: 2 });
    expect(coalescer.take(identity({ reason: 'rule one' })).send).toBe(true);
    expect(coalescer.take(identity({ reason: 'rule two' })).send).toBe(true);

    const capped = coalescer.take(identity({ reason: 'rule three' }));
    expect(capped.send).toBe(false);
    expect(capped.suppressed).toBe('cap');

    // A repeated identity is a duplicate even when the window is full.
    expect(coalescer.take(identity({ reason: 'rule one' })).suppressed).toBe('duplicate');

    clock.now += 1_000;
    expect(coalescer.take(identity({ reason: 'rule three' })).send).toBe(true);
  });

  it('resets the cap window but keeps recent dedupe identities', () => {
    const { coalescer, clock } = make({ windowMs: 1_000, dedupeTtlMs: 5_000 });
    expect(coalescer.take(identity()).send).toBe(true);
    expect(coalescer.take(identity()).suppressed).toBe('duplicate');

    expect(coalescer.reset('ses-test')).toEqual({
      sent: 1,
      suppressedDuplicate: 1,
      suppressedCap: 0,
    });
    // A second reset with only retained dedupe keys still reports the (now
    // empty) cap window instead of forgetting the identity.
    expect(coalescer.reset('ses-test')).toEqual({
      sent: 0,
      suppressedDuplicate: 0,
      suppressedCap: 0,
    });
    expect(coalescer.take(identity()).suppressed).toBe('duplicate');

    // A distinct decision is not blocked by the retained identity.
    expect(coalescer.take(identity({ reason: 'another rule' })).send).toBe(true);

    // The identity is forgotten only after its own TTL.
    clock.now += 5_000;
    expect(coalescer.take(identity()).send).toBe(true);
  });

  it('keeps suppressing a re-evaluated request across prompt resets', () => {
    const { coalescer, clock } = make({ windowMs: 1_000, dedupeTtlMs: 5_000 });
    expect(coalescer.take(identity()).send).toBe(true);

    for (let turn = 0; turn < 4; turn += 1) {
      clock.now += 1_000;
      coalescer.reset('ses-test');
      const decision = coalescer.take(identity());
      expect(decision.send).toBe(false);
      expect(decision.suppressed).toBe('duplicate');
    }

    clock.now += 1_000;
    expect(coalescer.take(identity()).send).toBe(true);
  });

  it('restores a snapshot and keeps suppressing inside the dedupe TTL', () => {
    const first = make({ dedupeTtlMs: 60_000 });
    first.coalescer.take(identity());

    const second = make({ dedupeTtlMs: 60_000 });
    expect(second.coalescer.restore(first.coalescer.snapshot())).toBe(true);
    expect(second.coalescer.take(identity()).suppressed).toBe('duplicate');

    second.clock.now = first.clock.now + 60_000;
    expect(second.coalescer.take(identity()).send).toBe(true);
  });

  it('returns a detached snapshot', () => {
    const { coalescer } = make();
    coalescer.take(identity());

    const snapshot = coalescer.snapshot();
    snapshot.sessions['ses-test'].sent = 99;
    snapshot.sessions['ses-test'].keys = {};

    expect(coalescer.stats('ses-test').sent).toBe(1);
    expect(coalescer.take(identity()).suppressed).toBe('duplicate');
  });

  it('rejects invalid snapshots without changing live state', () => {
    const { coalescer } = make();
    coalescer.take(identity());

    const invalid: unknown[] = [
      null,
      {},
      { version: 2 }, // missing sessions
      { version: 3, sessions: {} }, // future version
      { version: 1, sessions: [] },
      {
        version: 1,
        sessions: {
          s: {
            windowStartedAt: 0,
            sent: -1,
            keys: {},
            suppressedDuplicate: 0,
            suppressedCap: 0,
          },
        },
      },
      {
        version: 1,
        sessions: {
          s: {
            windowStartedAt: 0,
            sent: 1,
            keys: { k: 'not-a-number' },
            suppressedDuplicate: 0,
            suppressedCap: 0,
          },
        },
      },
    ];

    for (const value of invalid) expect(coalescer.restore(value)).toBe(false);
    expect(coalescer.stats('ses-test').sent).toBe(1);
  });

  it('is atomic across many callers in one turn', () => {
    const { coalescer } = make({ maxPerWindow: 3 });

    const duplicateDecisions = Array.from({ length: 100 }, () => coalescer.take(identity()));
    expect(duplicateDecisions.filter((decision) => decision.send)).toHaveLength(1);
    expect(coalescer.stats('ses-test').suppressedDuplicate).toBe(99);

    const distinct = Array.from({ length: 100 }, (_, index) =>
      identity({ reason: `rule-${index}` }),
    );
    const sent = distinct.map((item) => coalescer.take(item)).filter((decision) => decision.send);
    expect(sent).toHaveLength(2);
    expect(coalescer.stats('ses-test').suppressedCap).toBe(98);
  });

  it('rejects invalid options', () => {
    expect(() => new NotificationCoalescer({ windowMs: 0, maxPerWindow: 1 })).toThrow();
    expect(() => new NotificationCoalescer({ windowMs: Number.NaN, maxPerWindow: 1 })).toThrow();
    expect(() => new NotificationCoalescer({ windowMs: 1, maxPerWindow: 0 })).toThrow();
    expect(() => new NotificationCoalescer({ windowMs: 1, maxPerWindow: 1.5 })).toThrow();
    expect(
      () => new NotificationCoalescer({ windowMs: 1, maxPerWindow: 1, dedupeTtlMs: 0 }),
    ).toThrow();
    expect(
      () => new NotificationCoalescer({ windowMs: 1, maxPerWindow: 1, dedupeTtlMs: Number.NaN }),
    ).toThrow();
  });

  it('derives a stable key and never merges different sessions', () => {
    expect(notificationKey(identity())).toBe(notificationKey(identity()));
    expect(notificationKey(identity({ sessionID: 'a' }))).not.toBe(
      notificationKey(identity({ sessionID: 'b' })),
    );
  });
});
