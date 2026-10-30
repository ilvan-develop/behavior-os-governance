import type { ConstructionPipeline, DNA, PipelinePhaseDefinition } from '@behavior-os/schemas';

/**
 * G-021: DNA-Adaptive Pipeline Planner.
 *
 * Maps a DNA pattern + project context to a concrete construction
 * pipeline: an ordered set of phases, each with gates, required agents,
 * and auto-loadable skills.
 *
 * The planner solves the "monkey pressing buttons" problem: instead of
 * an agent jumping straight to `npm install shadcn` without architecture,
 * the planner enforces a phase-gated pipeline derived from the DNA.
 */
export interface ProjectContext {
  /** The project type: "web-app", "api", "mobile", "library", "cli", etc. */
  type?: string;
  /** Detected tech stack: ["react", "nextjs", "shadcn-ui", "docker", ...] */
  techStack?: string[];
  /** Human-readable briefing for the project. */
  briefing?: string;
  /** Target deployment target: "web", "mobile", "server", "edge". */
  deployment?: string;
}

/**
 * Result of planning: the ordered construction pipeline ready for
 * execution by the LoopManager / Builder meta-agent.
 */
export interface PlannedPipeline {
  /** The selected pipeline definition (from DNA or default). */
  pipeline: ConstructionPipeline;
  /** Phases in execution order, enriched with resolved agents and skills. */
  phases: Array<{
    definition: PipelinePhaseDefinition;
    /** Resolved agent persona names from the DNA. */
    agents: string[];
    /** Skills to auto-load from .opencode/skills/<id>/SKILL.md. */
    skills: string[];
    /** Resolved readiness artifact path (if any). */
    readinessArtifact?: string;
  }>;
  /** Whether the pipeline is fully ready (all readiness artifacts exist). */
  ready: boolean;
  /** Missing readiness artifacts (human-readable). */
  missingArtifacts: string[];
  /**
   * Recommendations for auto-generating missing artifacts.
   * Each entry includes the agent + skill to use and a prompt template.
   * This enables FULL AUTONOMY — the Builder follows these recommendations
   * to auto-create ADRs, dependency files, etc. without human intervention.
   */
  readinessRecommendations: Array<{
    artifact: string;
    phaseId: string;
    agent: string;
    skill: string;
    promptTemplate: string;
  }>;
}

/** Default pipelines for common project types. These are used when the
 * active DNA does not define a pipeline for the detected project type. */
const DEFAULT_PIPELINES: Record<string, ConstructionPipeline> = {
  'web-app': {
    id: 'default-web-app',
    name: 'Web Application Construction Pipeline',
    description: 'Standard SPA/SSR web application pipeline',
    appliesTo: ['web-app', 'web', 'frontend'],
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
            name: 'Architecture Decision Record required',
            phaseType: 'architecture',
            blocking: true,
            condition: {
              type: 'file-exists',
              value: 'adr/',
              description: 'At least one ADR must exist in adr/ directory',
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
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'dep-policy',
            name: 'Dependency policy enforced',
            phaseType: 'dependencies',
            blocking: true,
            condition: {
              type: 'dep-policy-checked',
              value: true,
              description: 'No known vulnerable or license-violating dependencies',
            },
          },
        ],
        readinessArtifact: 'package.json',
        blocking: true,
      },
      {
        id: 'frontend',
        name: 'Frontend Construction',
        type: 'frontend',
        order: 2,
        requiredAgents: ['developer'],
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'component-check',
            name: 'Component library validated',
            phaseType: 'frontend',
            blocking: false,
            condition: {
              type: 'component-library',
              value: true,
              description: 'Component library is consistent with design system',
            },
          },
        ],
        blocking: true,
      },
      {
        id: 'backend',
        name: 'Backend Construction',
        type: 'backend',
        order: 3,
        requiredAgents: ['developer'],
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'api-contract',
            name: 'API contract validated',
            phaseType: 'backend',
            blocking: true,
            condition: {
              type: 'api-contract',
              value: true,
              description: 'API contract matches frontend expectations',
            },
          },
        ],
        blocking: true,
      },
      {
        id: 'test',
        name: 'Testing & Quality',
        type: 'testing',
        order: 4,
        requiredAgents: ['analyst'],
        requiredSkills: ['verification-first'],
        gates: [
          {
            id: 'coverage',
            name: 'Test coverage threshold',
            phaseType: 'testing',
            blocking: true,
            condition: {
              type: 'test_coverage',
              value: 80,
              description: 'Minimum 80% test coverage',
            },
          },
          {
            id: 'lint',
            name: 'Lint clean',
            phaseType: 'testing',
            blocking: true,
            condition: {
              type: 'lint',
              value: 0,
              description: 'Zero lint errors',
            },
          },
        ],
        blocking: true,
      },
    ],
  },

  api: {
    id: 'default-api',
    name: 'API Service Construction Pipeline',
    description: 'Backend API service pipeline',
    appliesTo: ['api', 'backend', 'microservice', 'server'],
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
            name: 'API Architecture Decision Record',
            phaseType: 'architecture',
            blocking: true,
            condition: {
              type: 'file-exists',
              value: 'adr/',
              description: 'ADR required before any API construction',
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
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'dep-policy',
            name: 'Dependency security audit',
            phaseType: 'dependencies',
            blocking: true,
            condition: {
              type: 'dep-policy-checked',
              value: true,
              description: 'No vulnerable dependencies',
            },
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
            name: 'API contract defined',
            phaseType: 'backend',
            blocking: true,
            condition: {
              type: 'api-contract',
              value: true,
              description: 'OpenAPI spec defined before endpoint implementation',
            },
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
            condition: {
              type: 'test_coverage',
              value: 80,
              description: 'Minimum 80% test coverage',
            },
          },
        ],
        blocking: true,
      },
    ],
  },

  mobile: {
    id: 'default-mobile',
    name: 'Mobile App Construction Pipeline',
    description: 'Mobile app pipeline (React Native / iOS / Android)',
    appliesTo: ['mobile', 'mobile-app', 'ios', 'android', 'react-native'],
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
            name: 'Mobile architecture decision record',
            phaseType: 'architecture',
            blocking: true,
            condition: {
              type: 'file-exists',
              value: 'adr/',
              description: 'ADR for navigation + state management required',
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
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'dep-policy',
            name: 'Mobile dependency policy',
            phaseType: 'dependencies',
            blocking: true,
            condition: {
              type: 'dep-policy-checked',
              value: true,
              description: 'No vulnerable or oversized dependencies',
            },
          },
        ],
        readinessArtifact: 'package.json',
        blocking: true,
      },
      {
        id: 'frontend',
        name: 'UI Construction',
        type: 'frontend',
        order: 2,
        requiredAgents: ['developer'],
        requiredSkills: ['engineering-cycle'],
        gates: [
          {
            id: 'design-system',
            name: 'Design system adherence',
            phaseType: 'frontend',
            blocking: false,
            condition: {
              type: 'design-system',
              value: true,
              description: 'Components match design system tokens',
            },
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
            name: 'Test coverage',
            phaseType: 'testing',
            blocking: true,
            condition: {
              type: 'test_coverage',
              value: 70,
              description: 'Minimum 70% test coverage for mobile',
            },
          },
        ],
        blocking: true,
      },
    ],
  },
};

/**
 * Map tech stack detection to a project type.
 */
function detectProjectType(techStack: string[] = [], deployment = ''): string {
  const stack = techStack.map((t) => t.toLowerCase());
  const dep = deployment.toLowerCase();

  if (
    stack.some((t) => t.includes('react-native') || t.includes('expo')) ||
    dep.includes('mobile')
  ) {
    return 'mobile';
  }
  if (
    stack.some(
      (t) =>
        t.includes('express') ||
        t.includes('fastify') ||
        t.includes('nestjs') ||
        t.includes('spring'),
    )
  ) {
    return 'api';
  }
  if (
    stack.some(
      (t) =>
        t.includes('react') || t.includes('vue') || t.includes('angular') || t.includes('svelte'),
    )
  ) {
    return 'web-app';
  }
  if (stack.some((t) => t.includes('docker') || t.includes('kubernetes'))) {
    return 'api';
  }
  return 'web-app';
}

/**
 * Detect missing readiness artifacts by checking if the project
 * directory contains the required artifact paths.
 */
function checkReadiness(
  artifacts: string[],
  projectRoot: string,
): { ready: boolean; missing: string[] } {
  const fs = require('node:fs');
  const path = require('node:path');
  const missing: string[] = [];

  for (const artifact of artifacts) {
    const fullPath = path.resolve(projectRoot, artifact);
    try {
      if (!fs.existsSync(fullPath)) {
        missing.push(artifact);
      }
    } catch {
      missing.push(artifact);
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * The PipelinePlanner engine. Maps DNA + context → construction pipeline.
 */
export class PipelinePlannerEngine {
  private defaultPipelines: Map<string, ConstructionPipeline> = new Map(
    Object.entries(DEFAULT_PIPELINES),
  );

  /**
   * Select the best pipeline for the given DNA + context.
   * Strategy:
   * 1. Look for a pipeline in the DNA that explicitly applies to the project type
   * 2. Fall back to a default pipeline based on detected project type
   * 3. Fall back to web-app as the safe default
   */
  plan(
    dna: DNA | null | undefined,
    context: ProjectContext,
    projectRoot: string = process.cwd(),
  ): PlannedPipeline {
    // Determine project type from context
    const projectType =
      context.type ?? detectProjectType(context.techStack, context.deployment ?? '');

    // Try DNA-defined pipeline first
    const dnaPipelines =
      (dna as unknown as { pipelines?: ConstructionPipeline[] })?.pipelines ?? [];

    const dnaPipeline = dnaPipelines.find((p) =>
      p.appliesTo.some((t) => t.toLowerCase() === projectType.toLowerCase()),
    );

    // Fall back to default pipeline
    // Guaranteed: 'web-app' is always registered as a default fallback.
    const pipeline =
      dnaPipeline ??
      this.defaultPipelines.get(projectType) ??
      this.defaultPipelines.get('web-app') ??
      Array.from(this.defaultPipelines.values())[0] ??
      DEFAULT_PIPELINES['web-app'];

    // Resolve phases with agents + skills
    const phases = pipeline.phases
      .sort((a, b) => a.order - b.order)
      .map((phaseDef) => {
        const agents = this.resolveAgents(phaseDef.requiredAgents, dna);
        const skills = this.resolveSkills(phaseDef.requiredSkills, context, dna);
        return {
          definition: phaseDef,
          agents,
          skills,
          readinessArtifact: phaseDef.readinessArtifact,
        };
      });

    // Check readiness + generate auto-creation recommendations for missing artifacts
    const allArtifacts = phases
      .map((p) => ({ artifact: p.readinessArtifact, phaseId: p.definition.id }))
      .filter((a): a is { artifact: string; phaseId: string } => !!a.artifact);

    const readiness =
      allArtifacts.length > 0
        ? checkReadiness(
            allArtifacts.map((a) => a.artifact),
            projectRoot,
          )
        : { ready: true, missing: [] };

    // Generate recommendations for auto-creating missing artifacts (autonomy)
    const recommendations = allArtifacts
      .filter((a) => readiness.missing.includes(a.artifact))
      .map((entry) => {
        const phase = phases.find((p) => p.definition.id === entry.phaseId);
        const agent = phase?.agents[0] ?? 'planner';
        const skill = phase?.skills[0] ?? 'engineering-cycle';
        return {
          artifact: entry.artifact,
          phaseId: entry.phaseId,
          agent,
          skill,
          promptTemplate:
            entry.artifact === 'adr/'
              ? `Create an Architecture Decision Record in ${entry.artifact} for: ${context.briefing ?? 'this project'}. Include: API contract (OpenAPI spec), security model, dependency policy, and deployment strategy. Use the engineering-cycle skill (8-step: understand → discover → ground → plan → implement → validate → audit → learn).`
              : `Auto-generate ${entry.artifact} for the project. Use ${skill} for best practices.`,
        };
      });

    return {
      pipeline,
      phases,
      ready: readiness.ready,
      missingArtifacts: readiness.missing,
      readinessRecommendations: recommendations,
    };
  }

  /**
   * Register a custom default pipeline. Useful for hosts that want
   * to provide project-type-specific pipelines.
   */
  registerPipeline(pipeline: ConstructionPipeline): void {
    this.defaultPipelines.set(pipeline.id, pipeline);
    for (const appliesTo of pipeline.appliesTo) {
      this.defaultPipelines.set(appliesTo, pipeline);
    }
  }

  /**
   * List all available pipeline IDs.
   */
  listPipelineIds(): string[] {
    return Array.from(this.defaultPipelines.keys());
  }

  /**
   * Resolve agent personas from the DNA based on phase requirements.
   * Falls back to generic roles if DNA doesn't define a persona.
   */
  private resolveAgents(requiredAgents: string[], dna: DNA | null | undefined): string[] {
    if (!dna?.personas) {
      return requiredAgents;
    }

    // Map required agent roles to DNA personas
    const resolved: string[] = [];
    for (const required of requiredAgents) {
      const match = dna.personas.find(
        (p) => p.role === required || p.name.toLowerCase().includes(required.toLowerCase()),
      );
      if (match) {
        resolved.push(`${match.role}:${match.name}`);
      } else {
        resolved.push(required);
      }
    }
    return resolved.length > 0 ? resolved : requiredAgents;
  }

  /**
   * Resolve skills to auto-load for a phase. Cross-references
   * the DNA's metadata and the context's tech stack.
   */
  private resolveSkills(
    requiredSkills: string[],
    context: ProjectContext,
    dna: DNA | null | undefined,
  ): string[] {
    const skills: string[] = [...requiredSkills];

    // Add tech-stack-specific skills
    const stack = context.techStack ?? [];
    for (const tech of stack) {
      const lower = tech.toLowerCase();
      if (lower.includes('shadcn') || lower.includes('ui')) {
        skills.push('cli-tool'); // Skill for safe CLI usage
      }
      if (lower.includes('design-system') || lower.includes('figma')) {
        skills.push('design-system');
      }
      if (lower.includes('docker') || lower.includes('kubernetes')) {
        skills.push('devops');
      }
    }

    // Add DNA-specific skills
    if (dna?.metadata?.defaultSkills) {
      const dnaSkills = Array.isArray(dna.metadata.defaultSkills)
        ? dna.metadata.defaultSkills
        : [dna.metadata.defaultSkills];
      skills.push(...dnaSkills.map((s) => String(s)));
    }

    // Deduplicate
    return [...new Set(skills)];
  }
}
