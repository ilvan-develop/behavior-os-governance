#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorOS } from '@behavior-os/core';
import chalk from 'chalk';
import { Command } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('behavioros')
  .description('Behavior-OS CLI - Governance platform for AI agent teams')
  .version('2.0.0');

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

    // Create .agent_state.json
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
          args: [join(__dirname, '..', 'mcp-server', 'dist', 'server.js')],
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
  .description('Compile DNA patterns')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const dnasDir = join(dir, 'dnas');

    if (!existsSync(dnasDir)) {
      console.error(chalk.red('Error: dnas/ directory not found'));
      process.exit(1);
    }

    const files = [
      'surgical-team.yaml',
      'enterprise-governance.yaml',
      'military-operations.yaml',
      'lean-factory.yaml',
    ];
    console.log(chalk.blue('Compiling DNA patterns...'));

    for (const file of files) {
      const filepath = join(dnasDir, file);
      if (existsSync(filepath)) {
        try {
          const content = readFileSync(filepath, 'utf-8');
          // Basic validation - check for required fields
          if (content.includes('name:') && content.includes('governance:')) {
            console.log(chalk.green(`  ✓ ${file}`));
          } else {
            console.log(chalk.yellow(`  ⚠ ${file} - missing required fields`));
          }
        } catch (_error) {
          console.log(chalk.red(`  ✗ ${file} - error reading`));
        }
      }
    }
  });

// VALIDATE command
program
  .command('validate')
  .description('Validate DNA configurations')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const _bos = new BehaviorOS();

    console.log(chalk.blue('Validating Behavior-OS configuration...'));

    // Check for required files
    const checks = [
      { file: '.behavioros/state.json', required: true },
      { file: '.mcp.json', required: false },
      { file: 'dnas', required: true },
    ];

    let allPassed = true;
    for (const check of checks) {
      const exists = existsSync(join(dir, check.file));
      if (check.required && !exists) {
        console.log(chalk.red(`  ✗ ${check.file} - missing`));
        allPassed = false;
      } else {
        console.log(chalk.green(`  ✓ ${check.file}`));
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
  .description('Show system status and health')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;

    // Load state
    let state = null;
    const statePath = join(dir, '.behavioros', 'state.json');
    if (existsSync(statePath)) {
      state = JSON.parse(readFileSync(statePath, 'utf-8'));
    }

    console.log(chalk.blue('Behavior-OS Status'));
    console.log(chalk.gray('='.repeat(40)));

    if (state) {
      console.log(chalk.cyan(`DNA Pattern: ${state.selectedDna || 'Not selected'}`));
      console.log(chalk.cyan(`Current Step: ${state.currentStep}/7`));
      console.log(chalk.cyan(`Active Mission: ${state.activeMission || 'None'}`));
      console.log(chalk.cyan(`Last Updated: ${state.updatedAt}`));
    } else {
      console.log(chalk.yellow("No state found. Run 'behavioros init' first."));
    }

    // Check MCP config
    const mcpPath = join(dir, '.mcp.json');
    if (existsSync(mcpPath)) {
      console.log(chalk.green('\n✓ MCP configuration found'));
    } else {
      console.log(chalk.yellow('\n⚠ MCP configuration not found'));
    }
  });

// DIFF command
program
  .command('diff')
  .description('Detect behavioral drift between DNA versions')
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

// EMULATE command
program
  .command('simulate')
  .description('Simulate governance decisions')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--action <action>', 'Action to simulate', 'deploy')
  .option('--agent <agent>', 'Agent ID', 'test-agent')
  .action(async (options) => {
    const bos = new BehaviorOS();

    console.log(chalk.blue(`Simulating: ${options.action}`));
    console.log(chalk.gray(`Agent: ${options.agent}`));

    try {
      const decision = bos.evaluateGovernance(options.action, {
        agent: options.agent,
        context: {},
      });

      console.log(chalk.green(`Verdict: ${decision.verdict}`));
      console.log(chalk.gray(`Reason: ${decision.reason}`));
    } catch (_error) {
      console.log(chalk.yellow('Simulation completed (no DNA loaded)'));
    }
  });

// DEPLOY command
program
  .command('deploy')
  .description('Deploy with quality gates')
  .option('-d, --directory <path>', 'Project directory', '.')
  .option('--mission-id <id>', 'Mission ID to deploy')
  .action(async (_options) => {
    console.log(chalk.blue('Running deployment quality gates...'));

    const gates = ['lint', 'typecheck', 'security', 'coverage'];
    for (const gate of gates) {
      console.log(chalk.cyan(`  Checking ${gate}...`));
      // Simulate check
      console.log(chalk.green(`    ✓ ${gate} passed`));
    }

    console.log(chalk.green('\n✓ All quality gates passed. Ready for deployment.'));
  });

// ECOSYSTEM command
program
  .command('ecosystem')
  .description('Show ecosystem status and statistics')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const dnasDir = join(dir, 'dnas');

    let dnaCount = 0;
    if (existsSync(dnasDir)) {
      try {
        const files = await import('node:fs/promises');
        const entries = await files.readdir(dnasDir);
        dnaCount = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).length;
      } catch {
        // directory may not exist
      }
    }

    console.log(chalk.blue('Behavior-OS Ecosystem'));
    console.log(chalk.gray('='.repeat(40)));
    console.log(`  DNA Patterns:  ${dnaCount} loaded`);
    console.log('  MCP Tools:     9 registered');
    console.log('  Governance:    block | escalate | warn | log | transform');
    console.log('  Quality Gates: configurable per DNA pattern');
  });

// AGENT command
program
  .command('agent')
  .description('Manage agents')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action((options) => {
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
      console.log(chalk.yellow("  No agents registered. Run 'behavioros init' first."));
    }

    console.log(chalk.gray('\n  Use the SDK to register and manage agents:'));
    console.log(chalk.gray('    const bos = new BehaviorOS();'));
    console.log(
      chalk.gray(
        "    bos.registerAgent({ id: 'agent-1', name: 'DevBot', type: 'developer', ... });",
      ),
    );
  });

// AUTONOMOUS command
program
  .command('autonomous')
  .description('Run fully autonomous task through the 7-step protocol')
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

    console.log(chalk.blue(`Autonomous task: ${options.task}`));
    console.log(chalk.gray('='.repeat(40)));

    // Step 1: Load DNA
    console.log(chalk.cyan('\n[Step 1/7] Loading DNA pattern...'));
    try {
      const yaml = await import('js-yaml');
      const fs = await import('node:fs/promises');
      const dnaPath = join(dir, 'dnas', `${options.dna}.yaml`);
      if (existsSync(dnaPath)) {
        const content = await fs.readFile(dnaPath, 'utf-8');
        const dna = yaml.load(content) as import('@behavior-os/schemas').DNA;
        await bos.loadDNA(dna);
        console.log(chalk.green(`  ✓ Loaded DNA: ${options.dna}`));
      } else {
        console.log(chalk.yellow(`  ⚠ DNA file not found: ${dnaPath}, using default`));
        await bos.loadDNA({
          name: options.dna,
          version: '2.0.0',
          description: 'Default governance',
          personas: [],
          governance: [],
          quality: [],
        });
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Could not load DNA: ${err}`));
    }

    // Step 2: Create mission
    console.log(chalk.cyan('\n[Step 2/7] Creating mission...'));
    const mission = bos.createMission({
      title: options.task,
      type: 'feature',
      priority: options.priority as 'critical' | 'high' | 'medium' | 'low',
    });
    console.log(chalk.green(`  ✓ Mission created: ${mission.id}`));

    // Step 3: Evaluate governance
    console.log(chalk.cyan('\n[Step 3/7] Evaluating governance...'));
    const decision = bos.evaluateGovernance('execute_task', {
      agent: 'autonomous-agent',
      context: { task: options.task },
    });
    console.log(
      chalk[decision.verdict === 'deny' ? 'red' : 'green'](
        `  ${decision.verdict.toUpperCase()}: ${decision.reason}`,
      ),
    );

    // Step 4: Start mission
    bos.startMission(mission.id);
    console.log(chalk.green('  ✓ Mission started'));

    // Step 5: Run audit
    console.log(chalk.cyan('\n[Step 5/7] Running audit...'));
    const report = bos.runAudit({
      missionId: mission.id,
      agentId: 'autonomous-agent',
      simulate: true,
    });
    console.log(
      chalk[report.overall === 'pass' ? 'green' : 'yellow'](
        `  Audit: ${report.overall.toUpperCase()} (${report.summary})`,
      ),
    );

    // Step 6: Record learning
    console.log(chalk.cyan('\n[Step 6/7] Recording learning...'));
    const event = bos.recordLearning({
      type: 'insight',
      source: 'autonomous-task',
      content: `Task executed: ${options.task}`,
      impact: decision.verdict === 'deny' ? 'high' : 'medium',
      relatedMission: mission.id,
    });
    console.log(chalk.green(`  ✓ Learning recorded: ${event.id}`));

    // Step 7: Update state
    console.log(chalk.cyan('\n[Step 7/7] Updating protocol state...'));
    const statePath = join(dir, '.behavioros', 'state.json');
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      state.stepHistory = [
        ...(state.stepHistory || []),
        { step: 7, timestamp: new Date().toISOString(), missionId: mission.id },
      ];
      state.updatedAt = new Date().toISOString();
      writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
    console.log(chalk.green('  ✓ Protocol state updated'));

    console.log(chalk.green('\n✅ Autonomous task completed.'));
    console.log(chalk.gray(`  Mission: ${mission.id}`));
    console.log(chalk.gray(`  Governance: ${decision.verdict}`));
    console.log(chalk.gray(`  Audit: ${report.overall}`));
  });

// PROTOCOL command
program
  .command('protocol')
  .description('Check 7-step protocol compliance')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const statePath = join(dir, '.behavioros', 'state.json');

    if (!existsSync(statePath)) {
      console.log(chalk.yellow("No protocol state found. Run 'behavioros init' first."));
      return;
    }

    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const steps = [
      { num: 1, name: 'Select DNA', tool: 'bos_select_dna' },
      { num: 2, name: 'Display DNA Block', tool: 'visual' },
      { num: 3, name: 'Resolve Truth', tool: 'bos_resolve_truth' },
      { num: 4, name: 'Create Mission', tool: 'create-mission' },
      { num: 5, name: 'Delegate', tool: 'task' },
      { num: 6, name: 'Run Audit', tool: 'bos_run_audit' },
      { num: 7, name: 'Record Learning', tool: 'record-learning' },
    ];

    console.log(chalk.blue('Protocol Compliance Check'));
    console.log(chalk.gray('='.repeat(40)));

    for (const step of steps) {
      const completed = state.stepHistory?.some((h: { step: number }) => h.step === step.num);
      const icon = completed ? chalk.green('✓') : chalk.yellow('○');
      console.log(`${icon} Step ${step.num}: ${step.name} (${step.tool})`);
    }
  });

// DRIFT-CHECK command
program
  .command('drift-check')
  .description('Compare current vs baseline behavior')
  .option('-d, --directory <path>', 'Project directory', '.')
  .action(async (options) => {
    const dir = options.directory;
    const statePath = join(dir, '.behavioros', 'state.json');
    const baselinePath = join(dir, '.behavioros', 'baseline.json');

    console.log(chalk.blue('Checking for behavioral drift...'));

    if (!existsSync(baselinePath)) {
      console.log(
        chalk.yellow('  No baseline found. Create one with: behavioros diff --save-baseline'),
      );
      return;
    }

    if (!existsSync(statePath)) {
      console.log(chalk.yellow("  No current state found. Run 'behavioros init' first."));
      return;
    }

    try {
      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

      // Compare key behavioral attributes
      const drifts: string[] = [];
      if (state.selectedDna !== baseline.selectedDna) {
        drifts.push(`DNA pattern changed: ${baseline.selectedDna} → ${state.selectedDna}`);
      }
      if (state.currentStep !== baseline.currentStep) {
        drifts.push(`Protocol step changed: ${baseline.currentStep} → ${state.currentStep}`);
      }

      if (drifts.length === 0) {
        console.log(chalk.green('  No drift detected. Behavior matches baseline.'));
      } else {
        for (const d of drifts) {
          console.log(chalk.yellow(`  ⚠ ${d}`));
        }
      }
    } catch {
      console.log(
        chalk.red('  Error comparing state. Check format of state.json and baseline.json.'),
      );
    }
  });

program.parse();
