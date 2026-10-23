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

/** The 57 tools registered by `packages/mcp-server/src/server.ts`. */
const MCP_TOOLS = [
  'bos_apply_code_fixes',
  'bos_cancel_mission',
  'bos_check_quality',
  'bos_code_edit',
  'bos_code_fixes',
  'bos_complete_mission',
  'bos_create_mission',
  'bos_decide',
  'bos_define_policy',
  'bos_drift',
  'bos_evaluate_governance',
  'bos_evaluate_role_action',
  'bos_evolution',
  'bos_fail_mission',
  'bos_get_insights',
  'bos_get_metrics',
  'bos_get_state',
  'bos_get_status',
  'bos_list_audit_reports',
  'bos_list_code_edits',
  'bos_override_rule',
  'bos_reset_metrics',
  'bos_list_code_fixes',
  'bos_list_decisions',
  'bos_list_dna',
  'bos_list_missions',
  'bos_list_pipeline_runs',
  'bos_list_roles',
  'bos_preflight',
  'bos_recommendations',
  'bos_record_learning',
  'bos_register_role',
  'bos_role_policy_report',
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
  'bos_display_dna',
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

/**
 * The typedoc output directory, read from `typedoc.json` so this exclusion keeps
 * working if the path changes. Generated API markdown must never be treated as a
 * hand-written document (it names only symbols from source and is not authored).
 */
function typedocOutputDir(): string {
  try {
    const config = JSON.parse(readFileSync(join(repoRoot, 'typedoc.json'), 'utf-8')) as {
      out?: unknown;
    };
    if (typeof config.out === 'string' && config.out.length > 0) {
      return resolve(repoRoot, config.out);
    }
  } catch {
    // Missing or malformed config: fall through to the documented default.
  }
  return join(repoRoot, 'docs', 'api');
}

const TYPEDOC_OUTPUT = typedocOutputDir();

/** Recursively collects `*.md` files, skipping hidden, vendored and generated directories. */
function collectMarkdown(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      if (resolve(full) === TYPEDOC_OUTPUT) continue;
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

/**
 * Quantitative claims are the class of documentation bug this repository hit
 * most often: `27` MCP tools when the server registers `30`, `53` orchestrator
 * tests when there are `64`, `534` cases when the suite runs `777`.
 *
 * Every value below is *derived from the file that defines it*, so a document
 * cannot drift from the code without failing a test. Two things stay out on
 * purpose and are named here rather than silently skipped: `CHANGELOG.md` and
 * the dated `*_REPORT.md` files in the root, which record what older releases
 * claimed ("45+ tools", "9 resources") and carry a snapshot banner.
 */
const CURRENT_DOCS = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'GUIDE.md',
  'QUICKSTART.md',
  'PITCH.md',
  'docs/ARCHITECTURE.md',
  'docs/ARCHITECTURE_DEEP_DIVE.md',
  'docs/API_REFERENCE.md',
  'docs/CLI.md',
  'docs/COMMANDS.md',
  'docs/OPENCODE_V2.md',
  'docs/SDK.md',
  'docs/CLAIMS.md',
  '.opencode/skills/verification-first/SKILL.md',
];

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

function countIn(relativePath: string, pattern: RegExp): number {
  return [...readRepoFile(relativePath).matchAll(pattern)].length;
}

/** What the code actually implements, measured — never typed by hand. */
function measuredCounts() {
  const engineFiles = readdirSync(join(repoRoot, 'packages', 'core', 'src', 'engine')).filter(
    (file) => file.endsWith('.ts'),
  );
  // engineFiles = engines + the BehaviorOS facade + the engine registry.
  return {
    mcpTools: countIn('packages/mcp-server/src/server.ts', /server\.registerTool\(/g),
    mcpResources: countIn('packages/mcp-server/src/server.ts', /server\.registerResource\(/g),
    pluginTools: countIn('plugins/opencode-v2/src/index.ts', /name: 'bos_/g),
    dnas: readdirSync(join(repoRoot, 'dnas')).filter((file) => file.endsWith('.yaml')).length,
    tables: countIn('packages/core/src/persistence/sqlite-store.ts', /CREATE TABLE/g),
    engines: engineFiles.length - 2,
  };
}

/**
 * Every place a document states a count, with the line that states it.
 *
 * Lines inside a "retracted claims" section are skipped: `docs/CLAIMS.md`
 * quotes retired figures ("22 engines", "45+ tools") on purpose, and the quote
 * is the evidence that they were retired. The skip is section-scoped, not
 * file-wide, so the live claims in the same document are still checked.
 */
function countClaims(
  relativePath: string,
  pattern: RegExp,
): Array<{ line: number; text: string; values: number[] }> {
  const claims: Array<{ line: number; text: string; values: number[] }> = [];
  let skipLevel = 0;
  let inFence = false;
  readRepoFile(relativePath)
    .split(/\r?\n/)
    .forEach((text, index) => {
      if (/^\s*(```|~~~)/.test(text)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;

      const heading = /^(#{1,6})\s+(.*)$/.exec(text);
      if (heading) {
        const level = heading[1].length;
        if (/retirad|withdrawn/i.test(heading[2])) skipLevel = level;
        else if (skipLevel !== 0 && level <= skipLevel) skipLevel = 0;
        return;
      }
      if (skipLevel !== 0) return;

      for (const match of text.matchAll(pattern)) {
        claims.push({
          line: index + 1,
          text: text.trim(),
          values: match.slice(1).flatMap((value) => (value === undefined ? [] : [Number(value)])),
        });
      }
    });
  return claims;
}

describe('documented counts match the code', () => {
  const measured = measuredCounts();
  const currentDocs = CURRENT_DOCS.filter((file) => existsSync(join(repoRoot, file)));

  it('derives the counts it is supposed to guard', () => {
    // A broken derivation would silently compare wrong numbers with wrong
    // numbers, so the derivation itself is pinned to the measured reality.
    expect(measured.mcpTools).toBe(57);
    expect(measured.mcpResources).toBe(2);
    expect(measured.pluginTools).toBe(37);
    expect(measured.dnas).toBe(21);
    expect(measured.tables).toBe(9);
    expect(measured.engines).toBe(21);
  });

  it('states the tool, resource, engine, DNA and table counts the code has', () => {
    const rules: Array<{ pattern: RegExp; expected: number[]; label: string }> = [
      { pattern: /(\d+)\s+MCP tools/g, expected: [measured.mcpTools], label: 'MCP tools' },
      {
        pattern: /(\d+)\s+MCP tools \+ (\d+) resources/g,
        expected: [measured.mcpTools, measured.mcpResources],
        label: 'MCP tools/resources',
      },
      {
        pattern: /(\d+)\s+registered tools \+ (\d+) resources/g,
        expected: [measured.mcpTools, measured.mcpResources],
        label: 'MCP tools/resources',
      },
      {
        pattern: /(\d+)\s+tools \+ (\d+) resources/g,
        expected: [measured.mcpTools, measured.mcpResources],
        label: 'MCP tools/resources',
      },
      {
        pattern: /MCP Server\D{0,6}(\d+)\s+Tools/g,
        expected: [measured.mcpTools],
        label: 'MCP tools',
      },
      {
        pattern: /(\d+)\s+bos_\*?\s*tools/g,
        expected: [measured.pluginTools],
        label: 'plugin tools',
      },
      {
        pattern: /(\d+)\s+tools in total/g,
        expected: [measured.pluginTools],
        label: 'plugin tools',
      },
      { pattern: /(\d+)\s+(?:core )?engines/g, expected: [measured.engines], label: 'engines' },
      { pattern: /(\d+)\s+DNA pattern/g, expected: [measured.dnas], label: 'DNA patterns' },
      { pattern: /(\d+)\s+tables\b/g, expected: [measured.tables], label: 'SQLite tables' },
    ];

    for (const file of currentDocs) {
      for (const rule of rules) {
        for (const claim of countClaims(file, rule.pattern)) {
          expect(
            claim.values,
            `${rel(join(repoRoot, file))}:${claim.line} claims ${rule.label} ` +
              `${claim.values.join('/')} but the code has ${rule.expected.join('/')} — ` +
              `"${claim.text}"`,
          ).toEqual(rule.expected);
        }
      }
    }
  });
});
