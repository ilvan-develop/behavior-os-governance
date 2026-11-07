import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import plugin, { BOOTSTRAP_COMMAND } from '../src/index';

interface CapturedCommand {
  name: string;
  description?: string;
  execute: (input: {
    sessionID: string;
    prompt: { text: string };
    delivery: 'steer' | 'queue';
  }) => Promise<void>;
}

const temporaryProjects: string[] = [];

function temporaryProject(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'behavior-os-bootstrap-'));
  temporaryProjects.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryProjects.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDormantContext(directory: string) {
  const commands: CapturedCommand[] = [];
  const synthetic: Array<{ sessionID: string; text: string }> = [];

  const ctx = {
    location: { directory },
    command: {
      transform: async (
        callback: (editor: { add: (command: CapturedCommand) => void }) => void,
      ) => {
        callback({ add: (command) => commands.push(command) });
      },
    },
    session: {
      synthetic: async (input: { sessionID: string; text: string }) => {
        synthetic.push({ sessionID: input.sessionID, text: input.text });
      },
    },
  };

  return { ctx, commands, synthetic };
}

describe('dormant plugin bootstrap', () => {
  it('registers /bos-init and touches no governance domain', async () => {
    const project = temporaryProject();
    const { ctx, commands } = createDormantContext(project);

    await plugin.setup(ctx as never);

    expect(commands.map((command) => command.name)).toContain(BOOTSTRAP_COMMAND);
    expect(existsSync(path.join(project, '.behavioros', 'config.json'))).toBe(false);
  });

  it('writes the marker, copies the patterns and reports the restart requirement', async () => {
    const project = temporaryProject();
    const { ctx, commands, synthetic } = createDormantContext(project);

    await plugin.setup(ctx as never);

    const bootstrap = commands.find((command) => command.name === BOOTSTRAP_COMMAND);
    expect(bootstrap).toBeDefined();
    await bootstrap?.execute({
      sessionID: 'ses_test',
      prompt: { text: '' },
      delivery: 'steer',
    });

    expect(existsSync(path.join(project, '.behavioros', 'config.json'))).toBe(true);
    expect(existsSync(path.join(project, 'dnas', 'enterprise-governance.yaml'))).toBe(true);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]?.text).toContain('governance is now enabled');
    expect(synthetic[0]?.text).toContain('Restart the OpenCode session');
  });
});
