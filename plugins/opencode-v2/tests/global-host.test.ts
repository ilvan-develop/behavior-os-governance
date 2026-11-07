import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import globalPlugin from '../src/global';
import { hasProjectLoader } from '../src/index';

const temporaryProjects: string[] = [];

function temporaryProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'behavior-os-global-'));
  temporaryProjects.push(directory);
  return directory;
}

function writeLoader(directory: string, extension: 'ts' | 'js'): void {
  const plugins = path.join(directory, '.opencode', 'plugins');
  mkdirSync(plugins, { recursive: true });
  writeFileSync(path.join(plugins, `behavioros.${extension}`), 'export {};\n');
}

afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('global host', () => {
  it('uses a distinct plugin id from the project host', () => {
    expect(globalPlugin.id).toBe('behavior-os-global');
  });

  it('stays dormant and touches no context domain when a project loader exists', async () => {
    const project = temporaryProject();
    writeLoader(project, 'ts');
    expect(hasProjectLoader(project)).toBe(true);

    const touched: string[] = [];
    const ctx = new Proxy(
      { location: { directory: project } },
      {
        get(target, property) {
          if (property === 'location') return target.location;
          touched.push(String(property));
          throw new Error(`global host touched ctx.${String(property)}`);
        },
      },
    );

    await expect(globalPlugin.setup(ctx as never)).resolves.toBeUndefined();
    expect(touched).toEqual([]);
  });

  it('detects a .js project loader too', () => {
    const project = temporaryProject();
    writeLoader(project, 'js');
    expect(hasProjectLoader(project)).toBe(true);
  });

  it('does not detect a loader in a project without .opencode/plugins', () => {
    expect(hasProjectLoader(temporaryProject())).toBe(false);
  });
});
