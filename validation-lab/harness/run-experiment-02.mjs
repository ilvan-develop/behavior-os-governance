import { CognitiveLoadBalancerEngine } from '../../packages/core/dist/index.js';
import {
  DelegationEngine,
  AutonomousOrchestrator,
  CircuitBreaker
} from '../../packages/orchestrator/dist/index.js';

async function main() {
  console.log('=== EXPERIMENT 02: DELEGATION, CONCURRENCY & ORCHESTRATION ===\n');

  let passedAssertions = 0;
  let totalAssertions = 0;
  function assert(condition, description) {
    totalAssertions++;
    if (condition) {
      passedAssertions++;
      console.log(`[PASS] ${description}`);
    } else {
      console.error(`[FAIL] ${description}`);
    }
  }

  // =========================================================================
  // PROVA 1: ZERO-TRUST ROLE ENFORCEMENT & SPECIALIST SELECTION
  // =========================================================================
  console.log('--- PROVA 1: Zero-Trust Role & Authority Enforcement ---');
  const loadEngine1 = new CognitiveLoadBalancerEngine();
  const profiles = [
    {
      id: 'researcher-agent',
      role: 'explorer',
      capabilities: ['investigate', 'analyze', 'code-review'],
      authority: 'readonly'
    },
    {
      id: 'auditor-agent',
      role: 'auditor',
      capabilities: ['verify', 'audit', 'compliance'],
      authority: 'readonly'
    },
    {
      id: 'builder-agent-1',
      role: 'fixer',
      capabilities: ['implement', 'refactor', 'execute'],
      authority: 'write'
    },
    {
      id: 'builder-agent-2',
      role: 'fixer',
      capabilities: ['implement', 'refactor', 'execute'],
      authority: 'write'
    }
  ];

  const delegationEngine = new DelegationEngine(loadEngine1, {
    profiles,
    policy: { maxConcurrent: 2 }
  });

  // Test 1.1: Read-only task routes to read-only specialist (researcher or auditor)
  const readTaskAssignment = delegationEngine.assign({
    taskId: 'task-investigate-bug',
    requiredSkills: ['investigate'],
    mutating: false,
    inFlightCount: 0
  });
  assert(
    readTaskAssignment.agentId === 'researcher-agent' && readTaskAssignment.role === 'explorer',
    'Investigation task routes to read-only specialist (researcher-agent)'
  );

  // Test 1.2: Mutating task is strictly refused for read-only roles
  const loadEngineReadOnlyOnly = new CognitiveLoadBalancerEngine();
  const readOnlyDelegation = new DelegationEngine(loadEngineReadOnlyOnly, {
    profiles: [
      {
        id: 'auditor-only',
        role: 'auditor',
        capabilities: ['implement'], // claims skill, but authority is readonly
        authority: 'readonly'
      }
    ]
  });
  const rogueAssignment = readOnlyDelegation.assign({
    taskId: 'task-apply-fix',
    requiredSkills: ['implement'],
    mutating: true,
    inFlightCount: 0
  });
  assert(
    rogueAssignment.agentId === null && rogueAssignment.role === null,
    'Mutating task is strictly REFUSED when only read-only agents are present (authority overrides skill claims)'
  );

  // Test 1.3: Mutating task assigns to write-authority specialist (builder)
  const mutatingTaskAssignment = delegationEngine.assign({
    taskId: 'task-refactor-module',
    requiredSkills: ['implement'],
    mutating: true,
    inFlightCount: 0
  });
  assert(
    (mutatingTaskAssignment.agentId === 'builder-agent-1' || mutatingTaskAssignment.agentId === 'builder-agent-2') &&
    mutatingTaskAssignment.role === 'fixer',
    'Mutating task is assigned to a verified write-authority specialist (builder-agent)'
  );

  // =========================================================================
  // PROVA 2: COGNITIVE LOAD BALANCING & BOUNDED CONCURRENCY BUDGET
  // =========================================================================
  console.log('\n--- PROVA 2: Cognitive Load Balancing & Bounded Concurrency ---');

  // Let builder-1 take a task, increasing its load
  delegationEngine.onTaskStarted('builder-agent-1', 'task-1');

  // Next mutating task should route to builder-2 (lowest load)
  const secondAssignment = delegationEngine.assign({
    taskId: 'task-2',
    requiredSkills: ['implement'],
    mutating: true,
    inFlightCount: 1
  });
  assert(
    secondAssignment.agentId === 'builder-agent-2',
    'Cognitive load balancer assigns next task to the lowest-loaded specialist (builder-agent-2)'
  );

  delegationEngine.onTaskStarted('builder-agent-2', 'task-2');

  // Now inFlightCount reaches maxConcurrent (2)
  const throttledAssignment = delegationEngine.assign({
    taskId: 'task-3',
    requiredSkills: ['implement'],
    mutating: true,
    inFlightCount: 2
  });
  assert(
    throttledAssignment.agentId === null && throttledAssignment.reason.includes('Concurrency budget exhausted'),
    'Assignment is throttled when concurrency budget is reached (prevents overload / runaway execution)'
  );

  // Release task-1 and verify budget reopens
  delegationEngine.onTaskCompleted('builder-agent-1', 'task-1');
  const reopenedAssignment = delegationEngine.assign({
    taskId: 'task-3',
    requiredSkills: ['implement'],
    mutating: true,
    inFlightCount: 1
  });
  assert(
    reopenedAssignment.agentId !== null,
    'Budget reopens immediately upon task completion (resumes queue deterministically)'
  );

  // =========================================================================
  // PROVA 3: CIRCUIT BREAKER INTELLIGENCE & ANTI-LOOP FAILURE RECOVERY
  // =========================================================================
  console.log('\n--- PROVA 3: Circuit Breaker Intelligence & Failure Recovery ---');

  let simulatedTime = 1000;
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 100,
    now: () => simulatedTime
  });

  assert(breaker.getState() === 'closed', 'Circuit breaker starts in closed state (normal execution)');

  // Simulate 2 failures (under threshold)
  breaker.recordFailure();
  breaker.recordFailure();
  assert(breaker.getState() === 'closed', 'Circuit breaker remains closed under threshold (<3 failures)');
  assert(breaker.canExecute() === true, 'Execution allowed under threshold');

  // 3rd failure triggers trip
  breaker.recordFailure();
  assert(breaker.getState() === 'open', 'Circuit breaker TRIPS to open on 3rd consecutive failure (detects repetitive failure)');
  assert(breaker.canExecute() === false, 'Circuit breaker REJECTS execution in open state (prevents infinite retry loop)');

  // Advance clock past cooldown
  simulatedTime += 150;
  assert(breaker.canExecute() === true, 'Circuit breaker allows trial call after cooldown window');
  assert(breaker.getState() === 'half-open', 'Circuit breaker enters half-open state during recovery probe');
  
  // Successful trial call resets circuit
  breaker.recordSuccess();
  assert(breaker.getState() === 'closed', 'Circuit breaker RESETS to closed after successful recovery probe');

  // =========================================================================
  // PROVA 4: AUTONOMOUS ORCHESTRATION PIPELINE INTEGRATION
  // =========================================================================
  console.log('\n--- PROVA 4: End-to-End Autonomous Orchestrator Dispatch ---');

  const dispatchedTasks = [];
  const mockAdapter = {
    name: 'mock',
    mutating: false,
    async execute(task, context) {
      dispatchedTasks.push({
        taskId: context.taskId,
        agentId: context.agentId,
        authority: delegationEngine.getProfile(context.agentId)?.authority
      });
      return {
        exitCode: 0,
        stdout: `Task ${context.taskId} executed by ${context.agentId}`,
        stderr: ''
      };
    }
  };

  const orchestrator = new AutonomousOrchestrator({
    delegation: delegationEngine
  });

  orchestrator.registerAdapter(mockAdapter);

  orchestrator.registerAgent({
    id: 'researcher-agent',
    dnaPattern: 'enterprise-governance',
    capabilities: ['investigate', 'analyze', 'code-review'],
    authority: 'readonly',
    role: 'explorer'
  });

  orchestrator.registerAgent({
    id: 'builder-agent-1',
    dnaPattern: 'enterprise-governance',
    capabilities: ['implement', 'refactor', 'execute'],
    authority: 'write',
    role: 'fixer'
  });

  const defaultGate = [
    {
      gate: 'exit-code',
      description: 'Must exit with code 0',
      type: 'exit-code',
      expected: '0',
      required: true
    }
  ];

  const plan = {
    missionId: 'exp-02-mission',
    title: 'Autonomous Delegation Validation',
    tasks: [
      {
        id: 'step-1-audit',
        objective: 'Conduct read-only inspection of repository',
        adapter: 'mock',
        command: 'run audit',
        mutating: false,
        dependencies: [],
        acceptance: defaultGate
      },
      {
        id: 'step-2-remediation',
        objective: 'Apply confirmed fixes to source code',
        adapter: 'mock',
        command: 'apply fix',
        mutating: true,
        dependencies: ['step-1-audit'],
        acceptance: defaultGate
      }
    ]
  };

  const executionResult = await orchestrator.executeMission(plan, 'researcher-agent');
  console.log('Dispatched tasks trace:', JSON.stringify(dispatchedTasks, null, 2));
  assert(executionResult.status === 'completed', 'Autonomous orchestrator completes multi-step phased plan');
  assert(dispatchedTasks.length === 2, 'All phased tasks dispatched sequentially with dependency resolution');
  assert(
    dispatchedTasks[0].agentId === 'researcher-agent' && dispatchedTasks[0].authority === 'readonly',
    'Step 1 (read-only audit) executed by researcher-agent with readonly authority'
  );
  assert(
    dispatchedTasks[1].agentId === 'builder-agent-1' && dispatchedTasks[1].authority === 'write',
    'Step 2 (mutating remediation) delegated to builder-agent-1 with write authority'
  );

  console.log('\n============================================================');
  console.log(`TOTAL ASSERTIONS: ${totalAssertions} | PASSED: ${passedAssertions} | FAILED: ${totalAssertions - passedAssertions}`);
  console.log(`RESULT: ${passedAssertions === totalAssertions ? 'EXPERIMENT 02 PASS' : 'EXPERIMENT 02 FAIL'}`);
  console.log('============================================================\n');

  if (passedAssertions !== totalAssertions) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in experiment 02:', err);
  process.exit(1);
});
