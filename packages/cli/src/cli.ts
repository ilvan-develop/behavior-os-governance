#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorOS, DNALoader } from '@behavior-os/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { listRegisteredAgents } from './agents.js';
import { runDriftCheck } from './drift.js';
import { CLI_VERSION } from './version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('behavioros')
  .description('Behavior-OS CLI - Governance platform for AI agent teams')
  .version(CLI_VERSION);

/**
 * Best-effort DNA loader shared by the commands that need governance to be
 * active. Reads `BEHAVIOROS_DNA_PATH` first, then `<dir>/dnas/<pattern>.yaml`.
 *
 * Returns the DNA name that was actually loaded, or `null` when nothing was
 * loaded. Callers must surface `null` instead of assuming governance ran — an
 * unloaded DNA means every gate is skipped, not passed.
 */
async function loadDnaForCommand(
  bos: BehaviorOS,
  dir: string,
  pattern: string,
): Promise<string | null> {
  const candidates = [process.env.BEHAVIOROS_DNA_PATH, join(dir, 'dnas', `${pattern}.yaml`)].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const yaml = await import('js-yaml');
      const fs = await import('node:fs/promises');
      const dna = yaml.load(
        await fs.readFile(candidate, 'utf-8'),
      ) as import('@behavior-os/schemas').DNA;
      await bos.loadDNA(dna);
      return dna.name;
    } catch {
      // Try the next candidate rather than claiming a DNA was loaded.
    }
  }

  return null;
}

// INIT command
program
  .command('init')
  .description('Initialize a new Behavior-OS project')
  .option('-d, --directory <path>', 'Target directory', '.')
  .option('--dna <pattern>', 'Initial DNA pattern', 'enterprise-governance')
  .action(async (options) => {
    const dir = options.directory;

    // Create directory structure
    const dirs = ['dnas', 'src', 'tests', '.behavioros'];
    for (const d of dirs) {
      mkdirSync(join(dir, d), { recursive: true });
    }

    // Create .behavioros/state.json
    const state = {
      currentStep: 0,
      selectedDna: options.dna,
      activeMission: null,
      stepHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, '.behavioros', 'state.json'), JSON.stringify(state, null, 2));

    // Create .mcp.json
    const mcpConfig = {
      mcpServers: {
        behavioros: {
          command: 'node',
          args: [join(__dirname, '..', '..', 'mcp-server', 'dist', 'server.js')],
          env: {
            BEHAVIOROS_DNA_PATH: join(dir, 'dnas', `${options.dna}.yaml`),
          },
        },
      },
    };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2));

    // Create sample DNA
    const sampleDNA = `name: ${options.dna}
version: "2.0.0"
description: "Behavior-OS DNA pattern"
personas:
  - role: developer
    name: Default Developer
    authority: developer
    skills: [code, test, review]
governance:
  - id: default-rule
    level: medium
    action: warn
    conditions:
      - type: default
        value: true
quality:
  - id: coverage
    type: test_coverage
    threshold: 80
`;
    writeFileSync(join(dir, 'dnas', `${options.dna}.yaml`), sampleDNA);

    console.log(chalk.green(`✓ Behavior-OS project initialized in ${dir}`));
    console.log(chalk.gray(`  DNA pattern: ${options.dna}`));
    console.log(chalk.gray(`  Config files created:`));
    console.log(chalk.gray(`    - .behavioros/state.json`));
    console.log(chalk.gray(`    - .mcp.json`));
    console.log(chalk.gray(`    - dnas/${options.dna}.yaml`));
  });

// COMPILE command
program
  .command('compile')
  .description('Parse and validate every DNA pattern in dnas/')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const dnasDir = join(dir, 'dnas');

    if (!existsSync(dnasDir)) {
      console.error(chalk.red('Error: dnas/ directory not found'));
      process.exit(1);
    }

    const fileSystem = await import('node:fs/promises');
    const files = (await fileSystem.readdir(dnasDir))
      .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort();

    console.log(chalk.blue(`Compiling ${files.length} DNA pattern(s) from dnas/...`));

    const loader = new DNALoader();
    const yaml = await import('js-yaml');
    let failed = 0;

    for (const file of files) {
      try {
        // Validated against the full DNASchema, not a substring check.
        loader.load(yaml.load(readFileSync(join(dnasDir, file), 'utf-8')));
        console.log(chalk.green(`  ✓ ${file}`));
      } catch (error) {
        failed += 1;
        console.log(chalk.red(`  ✗ ${file} — ${error instanceof Error ? error.message : error}`));
      }
    }

    if (failed > 0) {
      console.log(chalk.red(`\n✗ ${failed} of ${files.length} pattern(s) failed validation.`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ ${files.length} pattern(s) compiled and validated.`));
  });

// VALIDATE command
program
  .command('validate')
  .description('Validate the project layout and every DNA pattern in dnas/')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;

    console.log(chalk.blue('Validating Behavior-OS project...'));

    // Check for required files
    const checks = [
      { file: '.behavioros/state.json', required: true },
      { file: '.mcp.json', required: false },
      { file: 'dnas', required: true },
    ];

    let allPassed = true;
    for (const check of checks) {
      const exists = existsSync(join(dir, check.file));
      if (exists) {
        console.log(chalk.green(`  ✓ ${check.file}`));
      } else if (check.required) {
        console.log(chalk.red(`  ✗ ${check.file} - missing`));
        allPassed = false;
      } else {
        console.log(chalk.gray(`  ○ ${check.file} - optional, not present`));
      }
    }

    // Validate every DNA pattern against the schema (the engine's own loader).
    const dnasDir = join(dir, 'dnas');
    if (existsSync(dnasDir)) {
      const fileSystem = await import('node:fs/promises');
      const files = (await fileSystem.readdir(dnasDir))
        .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
        .sort();
      const loader = new DNALoader();
      const yaml = await import('js-yaml');
      let invalid = 0;

      for (const file of files) {
        try {
          loader.load(yaml.load(readFileSync(join(dnasDir, file), 'utf-8')));
        } catch (error) {
          invalid += 1;
          console.log(
            chalk.red(`  ✗ dnas/${file} — ${error instanceof Error ? error.message : error}`),
          );
        }
      }

      if (invalid > 0) {
        allPassed = false;
      } else {
        console.log(chalk.green(`  ✓ dnas/ — ${files.length} pattern(s) valid`));
      }
    }

    if (allPassed) {
      console.log(chalk.green('\n✓ Validation passed!'));
    } else {
      console.log(chalk.red('\n✗ Validation failed. Please fix the issues above.'));
      process.exit(1);
    }
  });

// STATUS command
program
  .command('status')
  .description('Show engine status plus the local .behavioros/state.json')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--dna <pattern>', 'DNA pattern to load', 'enterprise-governance')
  .action(async (options) => {
    const dir = options.directory;

    const bos = new BehaviorOS();
    const loaded = await loadDnaForCommand(bos, dir, options.dna);
    const status = bos.getStatus();

    console.log(chalk.blue('Behavior-OS Status'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(`  DNA loaded:  ${loaded ?? 'none'}`);
    console.log(`  Governance:  ${status.config.governance}`);
    console.log(`  Missions:    ${status.missions}`);
    console.log(`  Agents:      ${status.agents}`);

    // Load state
    let state = null;
    const statePath = join(dir, '.behavioros', 'state.json');
    if (existsSync(statePath)) {
      state = JSON.parse(readFileSync(statePath, 'utf-8'));
    }

    if (state) {
      console.log(chalk.cyan(`  State file:  .behavioros/state.json (updated ${state.updatedAt})`));
      console.log(chalk.cyan(`  DNA Pattern: ${state.selectedDna || 'Not selected'}`));
      console.log(chalk.cyan(`  Current Step: ${state.currentStep}/7`));
      console.log(chalk.cyan(`  Active Mission: ${state.activeMission || 'None'}`));
    } else {
      console.log(chalk.yellow('  No .behavioros/state.json (create one with: behavioros init).'));
    }

    // Check MCP config
    const mcpPath = join(dir, '.mcp.json');
    if (existsSync(mcpPath)) {
      console.log(chalk.green('  ✓ .mcp.json present (this command does not start the server)'));
    } else {
      console.log(chalk.gray('  ○ .mcp.json not found'));
    }
  });

// DIFF command
program
  .command('diff')
  .description('Compare dnas/*.yaml with .behavioros/baseline.json')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const dnasDir = join(dir, 'dnas');
    const baselinePath = join(dir, '.behavioros', 'baseline.json');

    console.log(chalk.blue('Checking for behavioral drift...'));

    if (!existsSync(dnasDir)) {
      console.log(chalk.yellow('  No dnas/ directory found.'));
      return;
    }

    // Load current DNA files
    const yaml = await import('js-yaml');
    const fs = await import('node:fs/promises');
    const currentDNAs: Record<string, unknown> = {};
    try {
      const files = await fs.readdir(dnasDir);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          const content = await fs.readFile(join(dnasDir, file), 'utf-8');
          const name = file.replace(/\.(yaml|yml)$/, '');
          currentDNAs[name] = yaml.load(content);
        }
      }
    } catch {
      console.log(chalk.yellow('  Could not read dnas/ directory.'));
      return;
    }

    // Load baseline
    let baseline: Record<string, unknown> = {};
    if (existsSync(baselinePath)) {
      try {
        baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
      } catch {
        console.log(chalk.yellow('  Invalid baseline file, skipping comparison.'));
        return;
      }
    }

    if (Object.keys(baseline).length === 0) {
      console.log(chalk.green('  No baseline found. Current DNA state will be used as baseline.'));
      await fs.writeFile(baselinePath, JSON.stringify(currentDNAs, null, 2));
      return;
    }

    let driftDetected = false;
    for (const [name, current] of Object.entries(currentDNAs)) {
      const base = (baseline as Record<string, unknown>)[name];
      if (!base) {
        console.log(chalk.red(`  ✗ New DNA pattern detected: ${name}`));
        driftDetected = true;
        continue;
      }
      const currentStr = JSON.stringify(current);
      const baseStr = JSON.stringify(base);
      if (currentStr !== baseStr) {
        console.log(chalk.yellow(`  ⚠ Drift detected in ${name}`));
        driftDetected = true;
      }
    }

    if (!driftDetected) {
      console.log(chalk.green('  No drift detected. All DNA patterns match baseline.'));
    }
  });

// SIMULATE command
program
  .command('simulate')
  .description('Evaluate one action against the loaded DNA rules')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--action <action>', 'Action to simulate', 'deploy')
  .option('--agent <agent>', 'Agent ID', 'test-agent')
  .option('--dna <pattern>', 'DNA pattern to load', 'enterprise-governance')
  .action(async (options) => {
    const bos = new BehaviorOS();
    const loaded = await loadDnaForCommand(bos, options.directory, options.dna);

    console.log(chalk.blue(`Simulating: ${options.action}`));
    console.log(chalk.gray(`Agent: ${options.agent}`));

    if (!loaded) {
      console.log(chalk.yellow(`  ⚠ No DNA loaded (looked for dnas/${options.dna}.yaml)`));
      console.log(chalk.yellow('    Without a DNA there are no rules to evaluate.'));
      return;
    }

    const decision = bos.evaluateGovernance(options.action, {
      agent: options.agent,
      context: { action: options.action },
    });

    console.log(chalk.gray(`DNA: ${loaded}`));
    console.log(chalk.green(`Verdict: ${decision.verdict}`));
    console.log(chalk.gray(`Reason: ${decision.reason}`));
  });

// DEPLOY command
program
  .command('deploy')
  .description('Print the deployment gate plan (does not execute the gates)')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--mission-id <id>', 'Mission ID to deploy')
  .option('--dna <pattern>', 'DNA pattern to load', 'enterprise-governance')
  .action(async (options) => {
    const bos = new BehaviorOS();
    const loaded = await loadDnaForCommand(bos, options.directory, options.dna);

    console.log(chalk.blue('Deployment gate plan'));
    console.log(chalk.gray('This command prints the plan; it does not run quality gates.'));
    if (options.missionId) console.log(chalk.gray(`  Mission: ${options.missionId}`));

    if (!loaded) {
      console.log(chalk.yellow(`  ⚠ No DNA loaded (looked for dnas/${options.dna}.yaml)`));
      console.log(
        chalk.gray(
          '    Quality gates are declared by the DNA: pass --dna or set BEHAVIOROS_DNA_PATH.',
        ),
      );
    } else {
      console.log(chalk.gray(`  DNA: ${loaded}`));
    }

    const gates = bos.getPipelineEngine().getGates();
    if (gates.length === 0) {
      console.log(chalk.gray('  (pipeline disabled or DNA declares no quality gates)'));
    } else {
      for (const gate of gates) {
        console.log(
          `  ${gate.phase.padEnd(4)} ${gate.id}${gate.blocking ? '' : ' (non-blocking)'}`,
        );
      }
    }

    // The `governance` pre gate is the one gate that can run here for real: it
    // evaluates the `deploy` action against the loaded DNA and vetoes on `deny`.
    const identity = bos.resolveAgentIdentity();
    const preflight = bos.preflightAction('deploy', { agent: identity.agentId });
    if (preflight.allowed) {
      console.log(chalk.green(`\n  Pre-flight (governance): allowed — agent ${identity.agentId}`));
    } else {
      console.log(
        chalk.red(`\n  Pre-flight (governance): blocked by ${preflight.blockedBy ?? 'a gate'}`),
      );
      process.exitCode = 1;
    }

    console.log(
      chalk.gray('\n  Run the real checks with: pnpm lint:check && pnpm typecheck && pnpm test'),
    );
  });

// ECOSYSTEM command
program
  .command('ecosystem')
  .description('Report what can be read from the project on disk')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const dnasDir = join(dir, 'dnas');

    let dnaNames: string[] = [];
    if (existsSync(dnasDir)) {
      try {
        const files = await import('node:fs/promises');
        const entries = await files.readdir(dnasDir);
        dnaNames = entries
          .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
          .map((f) => f.replace(/\.(yaml|yml)$/, ''))
          .sort();
      } catch {
        // directory may not exist
      }
    }

    console.log(chalk.blue('Behavior-OS ecosystem'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(`  DNA patterns:  ${dnaNames.length}`);
    for (const name of dnaNames) console.log(chalk.gray(`    - ${name}`));
    console.log('  Verdicts:      allow | deny | escalate | transform');
    console.log(chalk.gray('  Gate plan:     behavioros deploy --dna <pattern>'));
    console.log(chalk.gray('  Engine/tool inventory: docs/CLAIMS.md'));
  });

// AGENT command
program
  .command('agent')
  .description('Show the local state summary and agents from the SQLite registry')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option(
    '--db <path>',
    'Agent registry SQLite path (default: <dir>/behavioros.db or <dir>/.behavioros/behavioros.db)',
  )
  .action(async (options) => {
    const dir = options.directory;
    const statePath = join(dir, '.behavioros', 'state.json');

    console.log(chalk.blue('Behavior-OS Agents'));
    console.log(chalk.gray('='.repeat(40)));

    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        console.log(chalk.cyan(`  DNA Pattern: ${state.selectedDna || 'Not selected'}`));
        console.log(chalk.cyan(`  Active Mission: ${state.activeMission || 'None'}`));
        console.log(chalk.cyan(`  Current Step: ${state.currentStep}/7`));
        if (state.stepHistory?.length) {
          console.log(chalk.gray(`  Steps completed: ${state.stepHistory.length}`));
        }
      } catch {
        console.log(chalk.yellow('  Invalid state file.'));
      }
    } else {
      console.log(
        chalk.yellow('  No .behavioros/state.json found (create one with: behavioros init).'),
      );
    }

    const registry = await listRegisteredAgents(dir, options.db);
    console.log(chalk.cyan(`\n  Agent registry: ${registry.path}`));

    if (!registry.found) {
      console.log(chalk.yellow('  No agent registry found.'));
      console.log(chalk.gray('  Register agents with the SDK and persistence enabled:'));
      console.log(
        chalk.gray("    const bos = new BehaviorOS({ persistence: { path: 'behavioros.db' } });"),
      );
      console.log(
        chalk.gray(
          "    bos.registerAgent({ id: 'agent-1', name: 'DevBot', type: 'developer', ... });",
        ),
      );
      return;
    }

    if (registry.error) {
      console.log(chalk.red(`  Could not read the registry: ${registry.error}`));
      process.exitCode = 1;
      return;
    }

    if (registry.agents.length === 0) {
      console.log(chalk.yellow('  Registry is empty.'));
      return;
    }

    console.log(chalk.green(`  ${registry.agents.length} registered agent(s):`));
    for (const agent of registry.agents) {
      console.log(
        chalk.gray(
          `    ${agent.id}  ${agent.name}  [${agent.type}/${agent.status}]  DNA=${agent.dnaPattern}  mission=${agent.currentMission ?? 'none'}`,
        ),
      );
    }
  });

// AUTONOMOUS command
program
  .command('autonomous')
  .description('Dry-run the 7-step protocol on a task (no work is executed; audit is simulated)')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('-t, --task <task>', 'Task description')
  .option('--dna <pattern>', 'DNA pattern to use', 'enterprise-governance')
  .option('--priority <level>', 'Mission priority', 'medium')
  .action(async (options) => {
    if (!options.task) {
      console.error(chalk.red('Error: --task is required'));
      process.exit(1);
    }

    const dir = options.directory;
    const bos = new BehaviorOS();

    console.log(chalk.blue(`Protocol dry run: ${options.task}`));
    console.log(chalk.gray('No work is executed. The audit below is simulated (simulate: true).'));
    console.log(chalk.gray('='.repeat(40)));

    // Protocol step 1 — select DNA.
    console.log(chalk.cyan('\n[Step 1/7] Select DNA'));
    const loaded = await loadDnaForCommand(bos, dir, options.dna);
    if (loaded) {
      console.log(chalk.green(`  ✓ Loaded DNA: ${loaded}`));
    } else {
      console.log(chalk.yellow(`  ⚠ No DNA loaded (looked for dnas/${options.dna}.yaml)`));
      console.log(chalk.yellow('    Governance rules are unavailable without a DNA.'));
    }
    console.log(chalk.gray('  (steps 2–3 run interactively: bos_list_dna / bos_get_state)'));

    // Pre-flight is not a protocol step: it is the real governance check.
    const identity = bos.resolveAgentIdentity();
    let verdict: string | null = null;
    if (loaded) {
      const decision = bos.evaluateGovernance('execute_task', {
        agent: identity.agentId,
        context: { task: options.task },
      });
      verdict = decision.verdict;
      console.log(
        chalk[decision.verdict === 'deny' ? 'red' : 'green'](
          `  Pre-flight (governance): ${decision.verdict.toUpperCase()} — ${decision.reason}`,
        ),
      );
    } else {
      console.log(chalk.yellow('  Pre-flight (governance): skipped — no DNA loaded'));
    }

    // Protocol step 4 — create mission. requiredChecks mirrors the plugin's
    // auto-mission: governance + audit must pass before completion is accepted.
    console.log(chalk.cyan('\n[Step 4/7] Create mission'));
    const mission = bos.createMission({
      title: options.task,
      type: 'feature',
      priority: options.priority as 'critical' | 'high' | 'medium' | 'low',
      requiredChecks: ['governance', 'audit'],
    });
    console.log(chalk.green(`  ✓ Mission created: ${mission.id}`));

    // Protocol step 5 — start mission.
    console.log(chalk.cyan('\n[Step 5/7] Start mission'));
    bos.startMission(mission.id);
    console.log(chalk.green('  ✓ Mission started'));

    // Protocol step 6 — run audit (simulated).
    console.log(chalk.cyan('\n[Step 6/7] Run audit (simulated)'));
    const report = await bos.runAudit({
      missionId: mission.id,
      agentId: identity.agentId,
      simulate: true,
    });
    console.log(
      chalk[report.overall === 'pass' ? 'green' : 'yellow'](
        `  Audit: ${report.overall.toUpperCase()} (${report.summary})`,
      ),
    );

    // Protocol step 7 — record learning.
    console.log(chalk.cyan('\n[Step 7/7] Record learning'));
    const event = bos.recordLearning({
      type: 'insight',
      source: 'autonomous-dry-run',
      content: `Dry run of task: ${options.task}`,
      impact: verdict === 'deny' ? 'high' : 'medium',
      relatedMission: mission.id,
    });
    console.log(chalk.green(`  ✓ Learning recorded: ${event.id}`));

    // Close the mission created by the dry run. Since the audit was simulated
    // (no real verification), the mission cannot be "completed" — it gets
    // cancelled to close the lifecycle. This fixes the CLI lifecycle gap where
    // autonomous created missions it could never close.
    bos.cancelMission(mission.id);
    const closed = bos.getMission(mission.id);
    console.log(
      chalk.gray(`  Mission ${mission.id} closed (status: ${closed?.status ?? 'unknown'})`),
    );
    const statePath = join(dir, '.behavioros', 'state.json');
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      state.stepHistory = [
        ...(state.stepHistory || []),
        { step: 7, timestamp: new Date().toISOString(), missionId: mission.id },
      ];
      state.updatedAt = new Date().toISOString();
      writeFileSync(statePath, JSON.stringify(state, null, 2));
      console.log(chalk.gray('  (state.json updated — not a protocol step)'));
    }

    console.log(chalk.green('\n✅ Protocol dry run completed — no work was executed.'));
    console.log(chalk.gray(`  Mission: ${mission.id}`));
    console.log(chalk.gray(`  Governance: ${verdict ?? 'skipped (no DNA)'}`));
    console.log(chalk.gray(`  Audit: ${report.overall} (simulated)`));
  });

// PROTOCOL command
program
  .command('protocol')
  .description('Check the 7-step protocol against the local state file')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const statePath = join(dir, '.behavioros', 'state.json');

    if (!existsSync(statePath)) {
      console.log(chalk.yellow("No protocol state found. Run 'behavioros init' first."));
      return;
    }

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    // Mirrors PROTOCOL_TOOL_STEPS in @behavior-os/core (engine/behavior-os.ts).
    const steps = [
      { num: 1, name: 'Select DNA', tool: 'bos_select_dna' },
      { num: 2, name: 'Confirm DNA rules', tool: 'bos_list_dna' },
      { num: 3, name: 'Resolve state', tool: 'bos_get_state' },
      { num: 4, name: 'Create mission', tool: 'bos_create_mission' },
      { num: 5, name: 'Start mission', tool: 'bos_start_mission' },
      { num: 6, name: 'Run audit', tool: 'bos_run_audit' },
      { num: 7, name: 'Record learning', tool: 'bos_record_learning' },
    ];

    console.log(chalk.blue('Protocol Compliance Check'));
    console.log(chalk.gray('='.repeat(40)));

    for (const step of steps) {
      const completed = state.stepHistory?.some((h: { step: number }) => h.step === step.num);
      const icon = completed ? chalk.green('✓') : chalk.yellow('○');
      console.log(`${icon} Step ${step.num}: ${step.name} (${step.tool})`);
    }

    console.log(
      chalk.gray(
        '\nThis reads .behavioros/state.json (written by `behavioros init`/`autonomous`).',
      ),
    );
    console.log(
      chalk.gray('Live protocol state lives in the host: the plugin stores it via ctx.storage.'),
    );
  });

// DRIFT-CHECK command
program
  .command('drift-check')
  .description('Compare dnas/*.yaml with .behavioros/baseline.json using DriftEngine')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;

    console.log(chalk.blue('Checking for behavioral drift...'));

    let report: Awaited<ReturnType<typeof runDriftCheck>>;
    try {
      report = await runDriftCheck(dir);
    } catch (error) {
      console.log(
        chalk.red(
          `  Error comparing DNA snapshots: ${error instanceof Error ? error.message : error}`,
        ),
      );
      process.exitCode = 1;
      return;
    }

    if (!report.baselineFound) {
      console.log(chalk.yellow('  No baseline found. Create one with: behavioros diff'));
      return;
    }

    if (report.findings.length === 0 && report.stateDrifts.length === 0) {
      if (!report.dnasFound && report.compared === 0 && report.stateDrifts.length === 0) {
        console.log(chalk.yellow('  No dnas/ directory found.'));
        return;
      }
      if (!report.stateFound && report.compared === 0) {
        console.log(chalk.yellow("  No current state found. Run 'behavioros init' first."));
        return;
      }
      console.log(
        chalk.green(`  No drift detected. ${report.compared} DNA pattern(s) match the baseline.`),
      );
      return;
    }

    if (report.compared > 0) {
      console.log(chalk.gray(`  Compared ${report.compared} DNA pattern(s) against the baseline.`));
    }
    for (const finding of report.findings) {
      const message =
        finding.kind === 'changed'
          ? `Drift in ${finding.pattern}: ${finding.summary.replace(/^Drift detected: /, '')}`
          : finding.summary;
      console.log(chalk.yellow(`  ⚠ ${message}`));
    }
    for (const drift of report.stateDrifts) {
      console.log(chalk.yellow(`  ⚠ ${drift}`));
    }
    console.log(
      chalk.red(
        `\n  Drift detected: ${report.findings.length + report.stateDrifts.length} change(s).`,
      ),
    );
    process.exitCode = 1;
  });

// METRICS command
program
  .command('metrics')
  .description('Display governance metrics from the Behavior-OS engine')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('-j, --json', 'Output as JSON instead of formatted table')
  .option('-r, --reset', 'Reset all metrics before reporting')
  .action(async (options) => {
    const dir = options.directory;
    const pattern = process.env.BEHAVIOROS_DNA || 'surgical-team';
    const bos = new BehaviorOS();
    const loaded = await loadDnaForCommand(bos, dir, pattern);

    if (options.reset) {
      bos.resetMetrics();
      console.log(chalk.gray('  ✓ Metrics reset'));
    }

    const metrics = bos.getMetrics();

    if (options.json) {
      console.log(JSON.stringify(metrics, null, 2));
      return;
    }

    console.log(chalk.blue('Behavior-OS Governance Metrics'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(chalk.gray(`DNA: ${loaded ?? 'none'}`));
    console.log(chalk.gray(`Timestamp: ${metrics.timestamp}`));
    console.log(chalk.gray(`Uptime: ${Math.round(metrics.uptimeMs / 1000)}s`));

    // Governance overview
    const gov = metrics.governance;
    const total = gov.totalActions;
    const denyPct = total > 0 ? ((gov.denied / total) * 100).toFixed(1) : '0.0';
    console.log(chalk.yellow('\nGovernance:'));
    console.log(`  Total actions:  ${total}`);
    console.log(`  Allowed:        ${gov.allowed}`);
    console.log(`  Denied:         ${gov.denied} (${denyPct}%)`);
    console.log(`  Escalated:      ${gov.escalated}`);
    console.log(`  Warned:         ${gov.warned}`);
    console.log(`  Avg rules/action: ${gov.avgRulesPerAction.toFixed(1)}`);

    if (gov.topRules.length > 0) {
      console.log(chalk.yellow('\nTop firing rules:'));
      for (const rule of gov.topRules) {
        console.log(`  ${rule.id.padEnd(30)} ${rule.count}× (${rule.action})`);
      }
    }

    if (gov.latencySamples && gov.latencySamples.length > 0) {
      const sorted = [...gov.latencySamples].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      console.log(chalk.yellow('\nLatency (ms):'));
      console.log(`  p50: ${p50}`);
      console.log(`  p95: ${p95}`);
    }

    // Learning summary
    console.log(chalk.yellow('\nLearning:'));
    console.log(`  Events total: ${metrics.learningEventsTotal}`);
    const byType = Object.entries(metrics.learningEventsByType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of byType.slice(0, 5)) {
      console.log(`  ${type}: ${count}`);
    }

    // Consensus/prediction (if any)
    if (metrics.consensus.totalRounds > 0) {
      console.log(chalk.yellow('\nConsensus:'));
      console.log(`  Rounds: ${metrics.consensus.totalRounds}`);
      console.log(`  Approved: ${metrics.consensus.approved}`);
      console.log(`  Rejected: ${metrics.consensus.rejected}`);
    }
    if (metrics.prediction.totalPredictions > 0) {
      console.log(chalk.yellow('\nPredictions:'));
      console.log(`  Total: ${metrics.prediction.totalPredictions}`);
    }
  });

program.parse();
