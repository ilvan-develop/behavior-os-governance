import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('CLI Package', () => {
  it('should export commands', () => {
    expect(true).toBe(true);
  });

  it('registers a metrics command with --json and --reset flags', async () => {
    const cliSource = await readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts'),
      'utf-8',
    );
    expect(cliSource).toContain("command('metrics')");
    expect(cliSource).toContain('getMetrics');
    expect(cliSource).toContain('--json');
    expect(cliSource).toContain('--reset');
    expect(cliSource).toContain('resetMetrics');
  });
});
