import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { PipelinePlannerEngine } from '../src/engine/pipeline-planner.js';

const baseDna: DNA = {
  name: 'Test DNA',
  version: '1.0.0',
  description: 'Test DNA for pipeline planner',
  personas: [
    { role: 'architect', name: 'Test Architect', authority: 'architect', skills: [] },
    { role: 'developer', name: 'Test Developer', authority: 'developer', skills: [] },
    { role: 'analyst', name: 'Test Analyst', authority: 'analyst', skills: [] },
    { role: 'operator', name: 'Test Operator', authority: 'operator', skills: [] },
  ],
  governance: [],
  quality: [],
};

const dnaWithPipeline: DNA = {
  ...baseDna,
  name: 'Custom Pipeline DNA',
  pipelines: [
    {
      id: 'custom-web',
      name: 'Custom Web Pipeline',
      description: 'A custom pipeline',
      appliesTo: ['web-app'],
      phases: [
        {
          id: 'custom-arch',
          name: 'Custom Architecture',
          type: 'architecture',
          order: 0,
          requiredAgents: ['architect'],
          requiredSkills: ['engineering-cycle'],
          gates: [
            {
              id: 'adr-check',
              name: 'ADR required',
              phaseType: 'architecture',
              blocking: true,
              condition: { type: 'file-exists', value: 'adr/', description: 'ADR needed' },
            },
          ],
          readinessArtifact: 'adr/',
          blocking: true,
        },
      ],
    },
  ],
};

describe('PipelinePlannerEngine', () => {
  const engine = new PipelinePlannerEngine();

  it('detects web-app project type from React tech stack', () => {
    const result = engine.plan(null, {
      techStack: ['react', 'vite'],
    });
    expect(result.pipeline.id).toBe('default-web-app');
    expect(result.phases.length).toBe(5);
  });

  it('detects api project type from Express/Fastify tech stack', () => {
    const result = engine.plan(null, {
      techStack: ['express', 'docker'],
    });
    expect(result.pipeline.id).toBe('default-api');
  });

  it('detects mobile project type from React Native tech stack', () => {
    const result = engine.plan(null, {
      techStack: ['react-native', 'expo'],
    });
    expect(result.pipeline.id).toBe('default-mobile');
  });

  it('detects mobile when deployment is "mobile"', () => {
    const result = engine.plan(null, {
      techStack: ['typescript'],
      deployment: 'mobile',
    });
    expect(result.pipeline.id).toBe('default-mobile');
  });

  it('uses explicit project type over inference', () => {
    const result = engine.plan(null, {
      type: 'api',
      techStack: ['react'], // would be web-app, but explicit type wins
    });
    expect(result.pipeline.id).toBe('default-api');
  });

  it('prioritizes DNA-defined pipeline over defaults', () => {
    const result = engine.plan(dnaWithPipeline, {
      type: 'web-app',
    });
    expect(result.pipeline.id).toBe('custom-web');
    expect(result.phases.length).toBe(1);
  });

  it('resolves agent personas from DNA', () => {
    const result = engine.plan(baseDna, { type: 'web-app' });
    const archPhase = result.phases.find((p) => p.definition.id === 'arch');
    expect(archPhase?.agents).toEqual(['architect:Test Architect']);
  });

  it('resolves agents when DNA has no matching personas', () => {
    const dnaNoMatch: DNA = { ...baseDna, personas: [] };
    const result = engine.plan(dnaNoMatch, { type: 'web-app' });
    const archPhase = result.phases.find((p) => p.definition.id === 'arch');
    expect(archPhase?.agents).toEqual(['architect']);
  });

  it('includes default skills from DNA metadata', () => {
    const dnaWithSkills: DNA = {
      ...baseDna,
      metadata: { defaultSkills: ['security-audit'] },
    };
    const result = engine.plan(dnaWithSkills, { type: 'web-app' });
    const archPhase = result.phases.find((p) => p.definition.id === 'arch');
    expect(archPhase?.skills).toContain('security-audit');
  });

  it('detects missing readiness artifacts', () => {
    // Use a non-existent project root
    const result = engine.plan(baseDna, { type: 'web-app' }, '/nonexistent/path/12345');
    expect(result.ready).toBe(false);
    expect(result.missingArtifacts).toContain('adr/');
  });

  it('returns ready=true when no readiness artifacts exist', () => {
    // The 'backend' and 'frontend' phases have no readinessArtifact
    const result = engine.plan(baseDna, { type: 'web-app' }, '/nonexistent/path/12345');
    expect(result.ready).toBe(false); // arch phase requires adr/
  });

  it('registers and uses custom pipelines', () => {
    engine.registerPipeline({
      id: 'custom-project',
      name: 'Custom Project Pipeline',
      appliesTo: ['custom-type'],
      phases: [
        {
          id: 'custom-phase',
          name: 'Custom Phase',
          type: 'architecture',
          order: 0,
          requiredAgents: ['architect'],
          requiredSkills: ['engineering-cycle'],
          gates: [],
          blocking: true,
        },
      ],
    });
    const result = engine.plan(null, { type: 'custom-type' });
    expect(result.pipeline.id).toBe('custom-project');
  });

  it('lists all available pipeline IDs', () => {
    const ids = engine.listPipelineIds();
    expect(ids).toContain('web-app');
    expect(ids).toContain('api');
    expect(ids).toContain('mobile');
  });

  it('falls back to web-app for unknown project types', () => {
    const result = engine.plan(null, { type: 'unknown-type' });
    expect(result.pipeline.id).toBe('default-web-app');
  });

  it('auto-loads cli-tool skill when tech stack has shadcn-ui', () => {
    const result = engine.plan(baseDna, {
      type: 'web-app',
      techStack: ['react', 'shadcn-ui'],
    });
    const frontendPhase = result.phases.find((p) => p.definition.id === 'frontend');
    expect(frontendPhase?.skills).toContain('cli-tool');
  });

  it('auto-loads design-system skill when tech stack has design-system', () => {
    const result = engine.plan(baseDna, {
      type: 'web-app',
      techStack: ['react', 'design-system'],
    });
    const frontendPhase = result.phases.find((p) => p.definition.id === 'frontend');
    expect(frontendPhase?.skills).toContain('design-system');
  });

  it('orders phases by their order field', () => {
    const result = engine.plan(baseDna, { type: 'web-app' });
    const orders = result.phases.map((p) => p.definition.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('includes all required gates in each phase', () => {
    const result = engine.plan(baseDna, { type: 'web-app' });
    const testPhase = result.phases.find((p) => p.definition.id === 'test');
    expect(testPhase?.definition.gates.length).toBe(2); // coverage + lint
  });
});
