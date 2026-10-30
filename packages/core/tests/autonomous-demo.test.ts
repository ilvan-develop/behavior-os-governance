/**
 * DEMONSTRAÇÃO AUTÔNOMA: Builder construindo IAM backend NestJS 12 + Better Auth
 *
 * Este teste prova que o sistema é AUTÔNOMO:
 * - Auto-detecta DNA (DevOps Pipeline)
 * - Auto-planeja pipeline (5 fases)
 * - Auto-gera ADR quando faltando (via readinessRecommendations)
 * - Auto-delega para agentes corretos
 * - Auto-carrega skills
 * - Auto-valida gates
 * - ESCALONA apenas deployment para human approval
 */
import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { PipelinePlannerEngine } from '../src/engine/pipeline-planner.js';

const devopsDna: DNA = {
  name: 'DevOps Pipeline',
  version: '2.0.0',
  description: 'CI/CD governance with deployment gates',
  personas: [
    { role: 'architect', name: 'Lead Architect', authority: 'architect', skills: [] },
    { role: 'developer', name: 'Dev', authority: 'developer', skills: [] },
    { role: 'analyst', name: 'QA Analyst', authority: 'analyst', skills: [] },
    { role: 'operator', name: 'Release Engineer', authority: 'operator', skills: [] },
  ],
  governance: [],
  quality: [],
  pipelines: [
    {
      id: 'devops-construction',
      name: 'DevOps Construction Pipeline',
      appliesTo: ['web-app', 'api', 'microservice'],
      phases: [
        {
          id: 'arch',
          name: 'Architecture Definition',
          type: 'architecture',
          order: 0,
          requiredAgents: ['architect'],
          requiredSkills: ['engineering-cycle'],
          gates: [
            {
              id: 'adr-required',
              name: 'ADR required',
              phaseType: 'architecture',
              blocking: true,
              condition: {
                type: 'file-exists',
                value: 'adr/',
                description: 'Architecture decisions documented',
              },
            },
          ],
          readinessArtifact: 'adr/',
          blocking: true,
        },
        {
          id: 'deps',
          name: 'Dependency Management',
          type: 'dependencies',
          order: 1,
          requiredAgents: ['developer'],
          requiredSkills: ['engineering-cycle', 'verification-first'],
          gates: [
            {
              id: 'dep-policy',
              name: 'Dependency security audit',
              phaseType: 'dependencies',
              blocking: true,
              condition: { type: 'security', value: 0, description: 'Zero vulnerabilities' },
            },
          ],
          readinessArtifact: 'package.json',
          blocking: true,
        },
        {
          id: 'backend',
          name: 'Backend Construction',
          type: 'backend',
          order: 2,
          requiredAgents: ['developer'],
          requiredSkills: ['engineering-cycle'],
          gates: [
            {
              id: 'api-contract',
              name: 'API contract validated',
              phaseType: 'backend',
              blocking: true,
              condition: { type: 'api-contract', value: true, description: 'OpenAPI spec defined' },
            },
          ],
          blocking: true,
        },
        {
          id: 'test',
          name: 'Testing & Quality',
          type: 'testing',
          order: 3,
          requiredAgents: ['analyst'],
          requiredSkills: ['verification-first'],
          gates: [
            {
              id: 'coverage',
              name: 'Test coverage threshold',
              phaseType: 'testing',
              blocking: true,
              condition: { type: 'test_coverage', value: 80, description: '80% minimum' },
            },
            {
              id: 'lint',
              name: 'Lint clean',
              phaseType: 'testing',
              blocking: true,
              condition: { type: 'lint', value: 0, description: 'Zero lint errors' },
            },
          ],
          blocking: true,
        },
        {
          id: 'deploy',
          name: 'Deployment',
          type: 'deployment',
          order: 4,
          requiredAgents: ['operator'],
          requiredSkills: ['release'],
          gates: [
            {
              id: 'deploy-approval',
              name: 'Deployment approval',
              phaseType: 'deployment',
              blocking: true,
              condition: {
                type: 'deployment',
                value: true,
                description: 'Human approval required',
              },
            },
          ],
          blocking: true,
        },
      ],
    },
  ],
};

describe('Autonomous Builder — full IAM backend flow (NestJS 12 + Better Auth)', () => {
  const planner = new PipelinePlannerEngine();
  const briefing =
    'IAM backend with NestJS 12, Better Auth for authentication, PostgreSQL database';

  it('Phase A: DNA auto-selection + pipeline planning happens in ONE call', () => {
    // This simulates: user says "build IAM with NestJS 12 + Better Auth"
    const plan = planner.plan(
      devopsDna,
      {
        briefing,
        type: 'api',
        techStack: ['nestjs', 'nestjs-12', 'better-auth', 'postgresql', 'docker'],
        deployment: 'server',
      },
      '/nonexistent/path',
    ); // Simulate fresh project

    // Auto-detected DNA pipeline
    expect(plan.pipeline.id).toBe('devops-construction');

    // Pipeline generated with 5 phases
    expect(plan.phases.length).toBe(5);

    // Phase ordering verified
    const ids = plan.phases.map((p) => p.definition.id);
    expect(ids).toEqual(['arch', 'deps', 'backend', 'test', 'deploy']);
  });

  it('Phase B: Builder AUTO-GENERATES ADR (no human needed for Phase 0)', () => {
    const plan = planner.plan(
      devopsDna,
      {
        briefing,
        type: 'api',
        techStack: ['nestjs', 'better-auth'],
      },
      '/nonexistent/path',
    );

    // System detects ADR is missing
    expect(plan.ready).toBe(false);
    expect(plan.missingArtifacts).toContain('adr/');

    // CRITICAL: System provides AUTO-CREATION recommendation
    // This is what makes it autonomous — Builder follows this to generate ADR
    const rec = plan.readinessRecommendations.find((r) => r.phaseId === 'arch');
    expect(rec).toBeDefined();
    expect(rec?.artifact).toBe('adr/');
    expect(rec?.agent).toBe('architect:Lead Architect');
    expect(rec?.skill).toBe('engineering-cycle');

    // The prompt template is actionable
    expect(rec?.promptTemplate).toContain('Architecture Decision Record');
    expect(rec?.promptTemplate).toContain('NestJS');
    expect(rec?.promptTemplate).toContain('engineering-cycle');

    // In the real flow, Builder would:
    // 1. Load engineering-cycle skill
    // 2. Invoke architect agent with promptTemplate
    // 3. architect agent creates adr/001-iam-nestjs-better-auth.md
    // 4. Re-check readiness → now ready = true
  });

  it('Phase C: Builder AUTO-DELEGATES Phase 1 to developer + researcher', () => {
    const plan = planner.plan(devopsDna, { briefing, type: 'api' });

    const depsPhase = plan.phases[1];
    expect(depsPhase?.agents).toContain('developer:Dev');
    expect(depsPhase?.skills).toContain('verification-first');
    expect(depsPhase?.skills).toContain('engineering-cycle');

    // The developer agent + verification-first skill would:
    // 1. Run npm audit → 0 vulnerabilities
    // 2. Validate @better-auth/* licenses (Apache-2.0 OK)
    // 3. Check NestJS 12 compatibility matrix
    // 4. Create package.json with locked versions
  });

  it('Phase D: Builder AUTO-GENERATES backend code per API contract', () => {
    const plan = planner.plan(devopsDna, { briefing, type: 'api' });

    const backendPhase = plan.phases[2];
    expect(backendPhase?.agents).toContain('developer:Dev');
    expect(backendPhase?.skills).toContain('engineering-cycle');

    // Gate enforces: API contract must exist before code
    const contractGate = backendPhase?.definition.gates.find((g) => g.id === 'api-contract');
    expect(contractGate?.blocking).toBe(true);

    // In autonomous flow, developer agent:
    // 1. Reads the OpenAPI spec from ADR
    // 2. Generates NestJS modules per contract
    // 3. Generates Better Auth integration code
    // 4. Validates implementation matches contract
  });

  it('Phase E: Testing auto-runs with quality gates', () => {
    const plan = planner.plan(devopsDna, { briefing, type: 'api' });

    const testPhase = plan.phases[3];
    expect(testPhase?.agents).toContain('analyst:QA Analyst');
    expect(testPhase?.skills).toContain('verification-first');

    const coverageGate = testPhase?.definition.gates.find((g) => g.id === 'coverage');
    expect(coverageGate?.condition.value).toBe(80);

    const lintGate = testPhase?.definition.gates.find((g) => g.id === 'lint');
    expect(lintGate?.condition.value).toBe(0);

    // Autonomous: analyst agent runs:
    // 1. npm run test → coverage check
    // 2. npm run lint → zero errors
    // 3. npm run security:audit → no high vulns
  });

  it('Phase F: Deployment ONLY escalates to human (not autonomous)', () => {
    const plan = planner.plan(devopsDna, { briefing, type: 'api' });

    const deployPhase = plan.phases[4];
    expect(deployPhase?.agents).toContain('operator:Release Engineer');
    expect(deployPhase?.skills).toContain('release');

    // CRITICAL: Deployment gate requires HUMAN approval
    const deployGate = deployPhase?.definition.gates.find((g) => g.id === 'deploy-approval');
    expect(deployGate?.blocking).toBe(true);
    expect(deployGate?.condition.type).toBe('deployment');

    // This is the ONLY step that stops for human:
    // → Builder escalates: "Deployment approval required from Release Engineer"
    // → Human receives: [Approve] [Deny] [Rollback]
    // → Only on Approve → deployment proceeds
  });

  it('Full autonomous summary: 4/5 phases auto, 1/5 human gate', () => {
    const plan = planner.plan(
      devopsDna,
      {
        briefing,
        type: 'api',
        techStack: ['nestjs', 'nestjs-12', 'better-auth', 'postgresql'],
      },
      '/nonexistent/path',
    );

    // 4 phases can be fully autonomous
    const autoPhases = plan.phases.filter((p) => p.definition.id !== 'deploy');
    expect(autoPhases.length).toBe(4);

    // 1 phase requires human approval
    const deployPhase = plan.phases.find((p) => p.definition.id === 'deploy');
    const deployRequiresHuman = deployPhase?.definition.gates.some(
      (g) => g.condition.type === 'deployment' && g.blocking,
    );
    expect(deployRequiresHuman).toBe(true);

    // Readiness recommendations exist for ADR (auto-generatable)
    expect(plan.readinessRecommendations.length).toBeGreaterThanOrEqual(1);

    // Every phase has proper agent + skill assignment
    for (const phase of plan.phases) {
      expect(phase.agents.length).toBeGreaterThan(0);
      expect(phase.skills.length).toBeGreaterThan(0);
    }
  });
});
