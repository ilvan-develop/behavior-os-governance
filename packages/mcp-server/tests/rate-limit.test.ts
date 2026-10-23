import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMIT_MAX_CALLS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type RateLimitConfig,
  rateLimitConfigFromEnv,
  ToolRateLimiter,
  withRateLimit,
} from '../src/rate-limit.js';

function config(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return { maxCalls: 2, windowMs: 1000, disabled: false, ...overrides };
}

describe('ToolRateLimiter', () => {
  it('allows the configured capacity and then reports a retry delay', () => {
    const limiter = new ToolRateLimiter(config());

    expect(limiter.check('tool', 0)).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    expect(limiter.check('tool', 0)).toMatchObject({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });

    const denied = limiter.check('tool', 0);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBe(500);
  });

  it('refills tokens as time passes instead of using a fixed window', () => {
    const limiter = new ToolRateLimiter(config());
    limiter.check('tool', 0);
    limiter.check('tool', 0);

    expect(limiter.check('tool', 499).allowed).toBe(false);
    expect(limiter.check('tool', 500).allowed).toBe(true);
  });

  it('keeps one bucket per tool', () => {
    const limiter = new ToolRateLimiter(config({ maxCalls: 1 }));
    expect(limiter.check('read', 0).allowed).toBe(true);
    expect(limiter.check('read', 0).allowed).toBe(false);
    expect(limiter.check('write', 0).allowed).toBe(true);
  });

  it('can be disabled without changing the reported limit', () => {
    const limiter = new ToolRateLimiter(config({ maxCalls: 1, disabled: true }));

    expect(limiter.check('tool', 0)).toMatchObject({
      allowed: true,
      limit: 1,
      remaining: 1,
    });
    expect(limiter.check('tool', 0).allowed).toBe(true);
  });

  it('resets one tool or every tool', () => {
    const limiter = new ToolRateLimiter(config({ maxCalls: 1 }));
    limiter.check('a', 0);
    limiter.check('b', 0);
    limiter.reset('a');
    expect(limiter.check('a', 0).allowed).toBe(true);
    limiter.reset();
    expect(limiter.check('b', 0).allowed).toBe(true);
  });

  it('rejects invalid configuration', () => {
    expect(() => new ToolRateLimiter(config({ maxCalls: 0 }))).toThrow(RangeError);
    expect(() => new ToolRateLimiter(config({ windowMs: 0 }))).toThrow(RangeError);
  });
});

describe('rate limit environment', () => {
  it('uses the secure defaults when nothing is configured', () => {
    const parsed = rateLimitConfigFromEnv({});

    expect(parsed.warnings).toEqual([]);
    expect(parsed.config).toEqual({
      maxCalls: DEFAULT_RATE_LIMIT_MAX_CALLS,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
      disabled: false,
    });
  });

  it('reads valid overrides and the explicit disable flag', () => {
    const parsed = rateLimitConfigFromEnv({
      BEHAVIOROS_MCP_RATE_LIMIT_MAX: '5',
      BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS: '2500',
      BEHAVIOROS_MCP_RATE_LIMIT_DISABLED: 'true',
    });

    expect(parsed.warnings).toEqual([]);
    expect(parsed.config).toEqual({ maxCalls: 5, windowMs: 2500, disabled: true });
  });

  it('falls back to defaults and reports malformed values', () => {
    const parsed = rateLimitConfigFromEnv({
      BEHAVIOROS_MCP_RATE_LIMIT_MAX: '0',
      BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS: 'soon',
    });

    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.config.maxCalls).toBe(DEFAULT_RATE_LIMIT_MAX_CALLS);
    expect(parsed.config.windowMs).toBe(DEFAULT_RATE_LIMIT_WINDOW_MS);
  });
});

describe('withRateLimit', () => {
  it('does not invoke the callback after the bucket is empty', async () => {
    const limiter = new ToolRateLimiter(config({ maxCalls: 1 }));
    let calls = 0;
    const wrapped = withRateLimit(
      'sample',
      async (args: { value: number }, _extra: unknown) => {
        calls += 1;
        return { content: [{ type: 'text' as const, text: `ok ${args.value}` }] };
      },
      limiter,
    );

    const allowed = await wrapped({ value: 1 }, {});
    expect(allowed).toEqual({ content: [{ type: 'text', text: 'ok 1' }] });

    const denied = (await wrapped({ value: 2 }, {})) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(calls).toBe(1);
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toContain('Rate limit exceeded for sample');
  });
});

describe('MCP server rate limiting', () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  const previous = {
    max: process.env.BEHAVIOROS_MCP_RATE_LIMIT_MAX,
    window: process.env.BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS,
    disabled: process.env.BEHAVIOROS_MCP_RATE_LIMIT_DISABLED,
  };

  beforeAll(async () => {
    process.env.BEHAVIOROS_MCP_RATE_LIMIT_MAX = '2';
    process.env.BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS = '60000';
    delete process.env.BEHAVIOROS_MCP_RATE_LIMIT_DISABLED;

    // Import after setting the environment: the server builds its limiter at
    // module load time.
    const { server } = await import('../src/server.js');
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'rate-limit-test', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    if (previous.max === undefined) delete process.env.BEHAVIOROS_MCP_RATE_LIMIT_MAX;
    else process.env.BEHAVIOROS_MCP_RATE_LIMIT_MAX = previous.max;
    if (previous.window === undefined) delete process.env.BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS;
    else process.env.BEHAVIOROS_MCP_RATE_LIMIT_WINDOW_MS = previous.window;
    if (previous.disabled === undefined) delete process.env.BEHAVIOROS_MCP_RATE_LIMIT_DISABLED;
    else process.env.BEHAVIOROS_MCP_RATE_LIMIT_DISABLED = previous.disabled;

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

  it('applies the limiter to a real MCP tool call', async () => {
    const first = await client.callTool({ name: 'bos_get_state', arguments: {} });
    const second = await client.callTool({ name: 'bos_get_state', arguments: {} });
    expect((first as { isError?: boolean }).isError).not.toBe(true);
    expect((second as { isError?: boolean }).isError).not.toBe(true);

    const third = (await client.callTool({ name: 'bos_get_state', arguments: {} })) as {
      content: Array<{ text?: string }>;
      isError?: boolean;
    };
    expect(third.isError).toBe(true);
    expect(third.content[0]?.text).toContain('Rate limit exceeded for bos_get_state');
  });
});
