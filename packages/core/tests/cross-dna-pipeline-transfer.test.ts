/**
 * Tests for CrossDnaPipelineTransferEngine (R-023)
 *
 * Proves that pipeline phase transfers between DNA patterns work:
 * 1. Suggests transfers from Surgical Team → DevOps Pipeline (100% coverage gate)
 * 2. Ranks suggestions by confidence
 * 3. Filters by minConfidence threshold
 * 4. Computes pipeline-level similarity between DNA patterns
 * 5. Identifies transferable gates correctly
 */
import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { CrossDnaPipelineTransferEngine } from '../src/engine/cross-dna-pipeline-transfer-engine.js';

// Minimal DNA fixtures for testing
const surgicalTeamDna: DNA = {
  name: 'Surgical Team',
  version: '2.0.0',
  description: 'Zero-defect governance',
  personas: [
    {
      name: 'Lead Surgeon',
      role: 'architect',
      authority: 'architect',
      boundaries: [],
      skills: ['surgical-procedure', 'team-leadership', 'clinical-decision'],
    },
  ],
  governance: [
    {
      id: 'sterile-field',
      level: 'critical',
      action: 'block',
      conditions: [{ type: 'production', value: true }],
      description: 'Block non-approved production changes',
    },
  ],
  quality: [],
  workflows: [],
  pipelines: [
    {
      id: 'surgical-construction',
      name: 'Surgical Construction Pipeline',
      description: 'Minimal pipeline with maximum safety',
      appliesTo: ['api', 'web-app'],
      phases: [
        {
          id: 'arch',
          name: 'Pre-operative Architecture',
          type: 'architecture',
          order: 0,
          requiredAgents: ['architect'],
          requiredSkills: ['engineering-cycle'],
          gates: [
            {
              id: 'adr-required',
              name: 'ADR before any code',
              phaseType: 'architecture',
              blocking: true,
              condition: {
                type: 'file-exists',
                value: 'adr/',
                description: 'ADR required',
              },
            },
          ],
          readinessArtifact: 'adr/',
          blocking: true,
        },
        {
          id: 'build',
          name: 'Controlled Construction',
          type: 'backend',
          order: 2,
          requiredAgents: ['architect'],
          requiredSkills: ['engineering-cycle'],
          gates: [
            {
              id: 'test-coverage',
              name: '100% coverage enforced',
              phaseType: 'testing',
              blocking: true,
              condition: {
                type: 'test_coverage',
                value: 100,
                description: '100% test coverage required',
              },
            },
          ],
          blocking: true,
        },
      ],
    },
  ],
} as unknown as DNA;

const devopsPipelineDna: DNA = {
  name: 'DevOps Pipeline',
  version: '2.0.0',
  description: 'CI/CD governance',
  personas: [
    {
      name: 'Release Engineer',
      role: 'operator',
      authority: 'operator',
      boundaries: [],
      skills: [],
    },
  ],
  governance: [],
  quality: [],
  workflows: [],
  pipelines: [
    {
      id: 'devops-construction',
      name: 'DevOps Construction Pipeline',
      description: 'CI/CD-oriented pipeline',
      appliesTo: ['api', 'web-app'],
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
                description: 'ADR required',
              },
            },
          ],
          readinessArtifact: 'adr/',
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
              name: 'Test coverage 80%',
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
  ],
} as unknown as DNA;

const minimalDna: DNA = {
  name: 'Minimal',
  version: '1.0.0',
  description: 'No pipelines',
  personas: [],
  governance: [],
  quality: [],
  workflows: [],
} as unknown as DNA;

describe('CrossDnaPipelineTransferEngine (R-023)', () => {
  describe('suggestPhaseTransfers', () => {
    it('suggests transferring Surgical Team 100% coverage gate to DevOps Pipeline', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, devopsPipelineDna);

      // Should find at least one transfer suggestion
      expect(suggestions.length).toBeGreaterThan(0);

      // The transfer should be about the testing phase (Surgical Team has 100% coverage gate)
      const testingTransfer = suggestions.find((s) => s.phaseName === 'Controlled Construction');
      expect(testingTransfer).toBeDefined();

      expect(testingTransfer?.sourceDna).toBe('Surgical Team');
      expect(testingTransfer?.targetDna).toBe('DevOps Pipeline');
      expect(testingTransfer?.confidence).toBeGreaterThanOrEqual(0.5); // minConfidence default
      expect(testingTransfer?.justification).toContain('Surgical Team');
      expect(testingTransfer?.transferableGates.length).toBeGreaterThan(0);
    });

    it('returns at least one high-confidence suggestion (>= 0.8)', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, devopsPipelineDna);

      const highConfidence = suggestions.filter((s) => s.confidence >= 0.8);
      expect(highConfidence.length).toBeGreaterThan(0);
    });

    it('sorts suggestions by confidence descending', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, devopsPipelineDna);

      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i]?.confidence).toBeLessThanOrEqual(suggestions[i - 1]?.confidence);
      }
    });

    it('respects minConfidence parameter', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, devopsPipelineDna, 0.75);

      expect(suggestions.length).toBeGreaterThan(0);
      for (const s of suggestions) {
        expect(s.confidence).toBeGreaterThanOrEqual(0.75);
      }
    });

    it('returns empty array when source DNA has no pipelines', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(minimalDna, devopsPipelineDna);

      expect(suggestions).toEqual([]);
    });

    it('returns empty array when target DNA has no pipelines', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, minimalDna);

      expect(suggestions).toEqual([]);
    });

    it('returns empty array when pipelines target different project types', () => {
      const sourceWithNoShare: DNA = {
        ...surgicalTeamDna,
        pipelines: [
          {
            ...surgicalTeamDna.pipelines?.[0],
            appliesTo: ['mobile'], // No overlap with devops
          },
        ],
      } as unknown as DNA;

      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(sourceWithNoShare, devopsPipelineDna);

      expect(suggestions).toEqual([]);
    });
  });

  describe('computePipelineSimilarity', () => {
    it('returns 0 when either DNA has no pipelines', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      expect(engine.computePipelineSimilarity(minimalDna, devopsPipelineDna)).toBe(0);
      expect(engine.computePipelineSimilarity(surgicalTeamDna, minimalDna)).toBe(0);
    });

    it('returns higher similarity for DNAs with more similar phases', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const simSurgicalToDevops = engine.computePipelineSimilarity(
        surgicalTeamDna,
        devopsPipelineDna,
      );

      // Both have 'arch' phase and 'api' project type — should be > 0
      expect(simSurgicalToDevops).toBeGreaterThan(0);
    });

    it('returns value between 0 and 1 inclusive', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const sim = engine.computePipelineSimilarity(surgicalTeamDna, devopsPipelineDna);

      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    });
  });

  describe('PhaseTransferSuggestion structure', () => {
    it('includes all required fields in suggestions', () => {
      const engine = new CrossDnaPipelineTransferEngine();
      const suggestions = engine.suggestPhaseTransfers(surgicalTeamDna, devopsPipelineDna);

      expect(suggestions.length).toBeGreaterThan(0);
      for (const suggestion of suggestions) {
        expect(suggestion.id).toBeTruthy();
        expect(suggestion.sourceDna).toBeTruthy();
        expect(suggestion.targetDna).toBeTruthy();
        expect(suggestion.phaseId).toBeTruthy();
        expect(suggestion.phaseName).toBeTruthy();
        expect(suggestion.confidence).toBeGreaterThan(0);
        expect(suggestion.justification).toBeTruthy();
        expect(Array.isArray(suggestion.transferableGates)).toBe(true);
        expect(['low', 'medium', 'high']).toContain(suggestion.impact);
        expect(suggestion.createdAt).toBeTruthy();
      }
    });
  });
});
