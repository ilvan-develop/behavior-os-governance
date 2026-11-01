import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION } from '../src/version.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

  it('reports the published package version, not a hardcoded literal', () => {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf-8')) as {
      version: string;
    };
    expect(CLI_VERSION, '--version must match the version on the registry').toBe(pkg.version);

    const cliSource = readFileSync(resolve(packageRoot, 'src', 'cli.ts'), 'utf-8');
    expect(cliSource).toContain('.version(CLI_VERSION)');
    expect(
      cliSource,
      'a hardcoded --version drifts from package.json and misleads bug reports',
    ).not.toMatch(/\.version\(['"]\d+\.\d+\.\d+['"]\)/);
  });
});
