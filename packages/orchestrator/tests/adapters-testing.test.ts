import { describe, expect, it } from 'vitest';
import {
  DelayAdapter,
  FailAdapter,
  GovernedAdapter,
  RecordAdapter,
} from '../src/adapters-testing.js';

describe('Test Adapters', () => {
  it('RecordAdapter records calls', async () => {
    const adapter = new RecordAdapter();
    const result = await adapter.execute(
      { command: 'echo hello' },
      {
        taskId: 't1',
        missionId: 'm1',
        correlationId: 'c1',
        idempotencyKey: 'k1',
        agentId: 'a1',
        attempt: 1,
        signal: new AbortController().signal,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('recorded');
    expect(adapter.getRecords()).toHaveLength(1);
  });

  it('FailAdapter returns failure', async () => {
    const adapter = new FailAdapter({ exitCode: 42, stderr: 'boom' });
    const result = await adapter.execute(
      {},
      {
        taskId: 't1',
        missionId: 'm1',
        correlationId: 'c1',
        idempotencyKey: 'k1',
        agentId: 'a1',
        attempt: 1,
        signal: new AbortController().signal,
      },
    );
    expect(result.exitCode).toBe(42);
    expect(result.stderr).toBe('boom');
  });

  it('DelayAdapter honours timeout', async () => {
    const adapter = new DelayAdapter(100);
    const ac = new AbortController();
    const promise = adapter.execute(
      {},
      {
        taskId: 't1',
        missionId: 'm1',
        correlationId: 'c1',
        idempotencyKey: 'k1',
        agentId: 'a1',
        attempt: 1,
        signal: ac.signal,
      },
    );
    ac.abort();
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('GovernedAdapter returns success', async () => {
    const adapter = new GovernedAdapter();
    const result = await adapter.execute(
      {},
      {
        taskId: 't1',
        missionId: 'm1',
        correlationId: 'c1',
        idempotencyKey: 'k1',
        agentId: 'a1',
        attempt: 1,
        signal: new AbortController().signal,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.metadata?.governed).toBe(true);
  });
});
