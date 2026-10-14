import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the documentation against the class of bug this repository hit
 * repeatedly: a doc naming a tool, script or environment variable that does not
 * exist in the code.
 *
 * Documents that carry a dated "snapshot" banner are historical artefacts and
 * are skipped on purpose — they are allowed to describe an older state.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The 27 tools registered by `packages/mcp-server/src/server.ts`. */
const MCP_TOOLS = [
  'bos_apply_code_fixes',
  'bos_check_quality',
  'bos_code_edit',
  'bos_code_fixes',
  'bos_create_mission',
  'bos_decide',
  'bos_drift',
  'bos_evaluate_governance',
  'bos_evolution',
  'bos_get_insights',
  'bos_get_state',
  'bos_get_status',
  'bos_list_audit_reports',
  'bos_list_code_edits',
  'bos_list_code_fixes',
  'bos_list_decisions',
  'bos_list_dna',
  'bos_list_missions',
  'bos_list_pipeline_runs',
  'bos_preflight',
  'bos_recommendations',
  'bos_record_learning',
  'bos_run_audit',
  'bos_select_dna',
  'bos_set_agent',
  'bos_start_mission',
  'bos_whoami',
];

/** Extra tools registered by the OpenCode plugin (`plugins/opencode-v2`). */
const PLUGIN_ONLY_TOOLS = ['bos_get_log', 'bos_verify_audit_trail'];

const KNOWN_TOOLS = new Set([...MCP_TOOLS, ...PLUGIN_ONLY_TOOLS]);

/**
 * Names that the current docs deliberately record as *non-existent* (so they can
 * withdraw them). The test below fails if one of these is ever registered.
 */
const WITHDRAWN_TOOLS = [
  'bos_complete_mission',
  'bos_display_dna',
  'bos_fail_mission',
  'bos_get_audit_report',
  'bos_get_dna_pattern',
  'bos_get_mission',
  'bos_get_patterns',
  'bos_list_dna_patterns',
  'bos_resolve_truth',
  'bos_validate_dna',
];

/** Scripts that current docs deliberately record as removed. */
const WITHDRAWN_SCRIPTS = ['benchmark'];

/** pnpm commands (not scripts) that the docs may legitimately reference. */
const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'dlx',
  'exec',
  'install',
  'ls',
  'outdated',
  'publish',
  'remove',
  'run',
  'why',
]);

/** Environment variables that current docs deliberately record as non-existent. */
const WITHDRAWN_ENV_VARS = ['BEHAVIOROS_LOG_LEVEL', 'BEHAVIOROS_PROJECT', 'BEHAVIOROS_STATE_DIR'];

/** Recursively collects `*.md` files, skipping hidden and vendored directories. */
function collectMarkdown(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectMarkdown(full, out);
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function collectDocs(): string[] {
  const docs = [
    ...readdirSync(repoRoot)
      .filter((file) => file.endsWith('.md'))
      .map((file) => join(repoRoot, file)),
    ...collectMarkdown(join(repoRoot, 'docs')),
    ...readdirSync(join(repoRoot, '.github'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => join(repoRoot, '.github', file)),
    ...collectMarkdown(join(repoRoot, '.cursor', 'rules')),
    join(repoRoot, '.windsurfrules'),
    join(repoRoot, '.behavioros', 'README.md'),
  ];

  return docs.filter((file) => {
    if (!existsSync(file)) return false;
    // A dated banner marks a historical artefact which is allowed to describe an
    // older state: either "SUPERSEDED" or a "Snapshot" note pointing at CLAIMS.md.
    const head = readFileSync(file, 'utf-8').slice(0, 2000);
    const isHistorical =
      /SUPERSEDED/.test(head) || (/snapshot/i.test(head) && /CLAIMS\.md/.test(head));
    return !isHistorical;
  });
}

const docs = collectDocs();
const rel = (file: string) => relative(repoRoot, file).replace(/\\/g, '/');

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|mjs|js)$/.test(entry.name)) files.push(full);
    }
  };
  for (const pkg of readdirSync(join(repoRoot, 'packages')))
    walk(join(repoRoot, 'packages', pkg, 'src'));
  for (const plugin of readdirSync(join(repoRoot, 'plugins')))
    walk(join(repoRoot, 'plugins', plugin, 'src'));
  walk(join(repoRoot, 'scripts'));
  return files;
}

describe('documentation consistency', () => {
  it('found the documents it is supposed to check', () => {
    expect(docs.length).toBeGreaterThan(15);
    expect(docs.map(rel)).toContain('docs/CLAIMS.md');
  });

  it('only names registered bos_* tools in current docs', () => {
    for (const file of docs) {
      const names = new Set(readFileSync(file, 'utf-8').match(/bos_[a-z0-9_]+/g) ?? []);
      for (const name of names) {
        expect(
          KNOWN_TOOLS.has(name) || WITHDRAWN_TOOLS.includes(name),
          `${rel(file)} references unknown tool ${name}`,
        ).toBe(true);
      }
    }
  });

  it('does not back a withdrawn name with a real tool', () => {
    for (const name of WITHDRAWN_TOOLS) {
      expect(KNOWN_TOOLS.has(name), `${name} is registered but documented as non-existent`).toBe(
        false,
      );
    }
  });

  it('points every root package.json file script at an existing file', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      const match = /(?:^|\s)(?:node|tsx)\s+([^\s&|]+)/.exec(command);
      if (!match) continue;
      expect(
        existsSync(resolve(repoRoot, match[1])),
        `script "${name}" -> ${match[1]} does not exist`,
      ).toBe(true);
    }
  });

  it('delegates only to package scripts that exist', () => {
    const readScripts = (manifest: string): Record<string, string> => {
      const path = join(repoRoot, manifest);
      if (!existsSync(path)) return {};
      return (
        (JSON.parse(readFileSync(path, 'utf-8')) as { scripts?: Record<string, string> }).scripts ??
        {}
      );
    };

    const workspaces = new Map<string, Record<string, string>>();
    for (const dir of ['packages', 'plugins']) {
      for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifest = join(dir, entry.name, 'package.json');
        const path = join(repoRoot, manifest);
        if (!existsSync(path)) continue;
        const json = JSON.parse(readFileSync(path, 'utf-8')) as {
          name?: string;
          scripts?: Record<string, string>;
        };
        if (json.name) workspaces.set(json.name, json.scripts ?? {});
      }
    }

    for (const [name, command] of Object.entries(readScripts('package.json'))) {
      // `pnpm --filter <pkg> run <script>` — the delegating form used by root scripts.
      const match = /--filter\s+(\S+)\s+run\s+([A-Za-z0-9:_-]+)/.exec(command);
      if (!match) continue;
      const [, target, script] = match;
      expect(workspaces.has(target), `script "${name}" targets unknown workspace ${target}`).toBe(
        true,
      );
      expect(
        workspaces.get(target)?.[script] !== undefined,
        `script "${name}" -> ${target} run ${script}, but ${target} has no "${script}" script`,
      ).toBe(true);
    }
  });

  it('only references pnpm scripts that exist', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };

    for (const scriptName of WITHDRAWN_SCRIPTS) {
      expect(
        pkg.scripts[scriptName] === undefined,
        `${scriptName} is a root script again — update the WITHDRAWN list and the docs`,
      ).toBe(true);
    }

    for (const file of docs) {
      // Only check references the document presents as a command: inside
      // backticks or inside a fenced code block. Plain prose ("the pnpm
      // workspace") is not a script reference.
      let inFence = false;
      for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          continue;
        }

        const candidates: string[] = [];
        for (const match of line.matchAll(/`pnpm ([a-z][a-z0-9:_-]*)/g)) {
          candidates.push(match[1]);
        }
        if (inFence) {
          const match = /^\s*(?:\$ )?pnpm ([a-z][a-z0-9:_-]*)/.exec(line);
          if (match) candidates.push(match[1]);
        }

        for (const scriptName of candidates) {
          expect(
            pkg.scripts[scriptName] !== undefined ||
              PNPM_BUILTINS.has(scriptName) ||
              WITHDRAWN_SCRIPTS.includes(scriptName),
            `${rel(file)} references missing pnpm script "${scriptName}"`,
          ).toBe(true);
        }
      }
    }
  });

  it('only names real CLI commands in current docs', () => {
    const commands = new Set([
      'init',
      'compile',
      'validate',
      'status',
      'diff',
      'simulate',
      'deploy',
      'ecosystem',
      'agent',
      'autonomous',
      'protocol',
      'drift-check',
    ]);

    for (const file of docs) {
      const text = readFileSync(file, 'utf-8');
      // Only look at references the document presents as a command: between
      // backticks or inside a fenced code block. Prose and YAML/JSON snippets
      // ("behavioros": { "description": … }) are not command references.
      const candidates = new Set<string>();
      for (const match of text.matchAll(
        /`(?:npx )?(?:@behavior-os\/cli|behavioros) ([a-z][a-z-]*)/g,
      )) {
        candidates.add(match[1]);
      }
      let inFence = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (!inFence) continue;
        const match = /^\s*(?:npx )?(?:@behavior-os\/cli|behavioros) ([a-z][a-z-]*)/.exec(line);
        if (match) candidates.add(match[1]);
      }

      for (const command of candidates) {
        expect(
          commands.has(command),
          `${rel(file)} names non-existent CLI command "${command}"`,
        ).toBe(true);
      }
    }
  });

  it('only calls BehaviorOS methods that exist', () => {
    const source = readFileSync(
      join(repoRoot, 'packages', 'core', 'src', 'engine', 'behavior-os.ts'),
      'utf-8',
    );
    const methods = new Set(
      [
        ...source.matchAll(
          /^ {2}(?!private |static |get |set )(?:async )?([a-zA-Z][A-Za-z0-9]*)\(/gm,
        ),
      ].map((match) => match[1]),
    );
    expect(methods.size).toBeGreaterThan(20);

    for (const file of docs) {
      const calls = new Set(
        [...readFileSync(file, 'utf-8').matchAll(/\bbos\.([a-zA-Z][A-Za-z0-9]*)\(/g)].map(
          (match) => match[1],
        ),
      );
      for (const method of calls) {
        expect(methods.has(method), `${rel(file)} calls bos.${method}() which does not exist`).toBe(
          true,
        );
      }
    }
  });

  it('only names environment variables that exist in the code', () => {
    const source = sourceFiles()
      .map((file) => readFileSync(file, 'utf-8'))
      .join('\n');

    for (const name of WITHDRAWN_ENV_VARS) {
      expect(
        source.includes(name),
        `${name} exists in the code again — update the WITHDRAWN list and the docs`,
      ).toBe(false);
    }

    for (const file of docs) {
      const vars = new Set(
        (
          readFileSync(file, 'utf-8').match(/\b(?:BEHAVIOROS|BEHAVIOR_OS)_[A-Z0-9_]+\b/g) ?? []
        ).filter((name) => !name.endsWith('_CODE_EDIT_ROOT')),
      );
      for (const name of vars) {
        expect(
          source.includes(name) || WITHDRAWN_ENV_VARS.includes(name),
          `${rel(file)} references unused env var ${name}`,
        ).toBe(true);
      }
    }
  });
});
