import { describe, expect, it } from 'vitest';
import { BehaviorOS } from '../src/engine/behavior-os.js';
import { FairnessEngine } from '../src/engine/fairness-engine.js';

const provenance = {
  datasetId: 'hiring-2026-q1',
  source: 'ats-export',
  collectedAt: '2026-01-15T00:00:00.000Z',
  consentBasis: 'legitimate-interest',
};

describe('FairnessEngine', () => {
  it('blocks when demographic parity and disparate impact fail', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 20 },
      ],
      provenance,
    });

    expect(result.verdict).toBe('block');
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.metrics.map((metric) => metric.name)).toEqual([
      'demographic_parity_difference',
      'disparate_impact_ratio',
    ]);
    expect(result.metrics[0].value).toBe(0.3);
    expect(result.metrics[1].value).toBe(0.4);
  });

  it('passes when parity, impact, provenance and oversight are satisfied', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 52 },
      ],
      provenance,
      oversight: {
        required: true,
        approved: true,
        reviewerId: 'reviewer-1',
        reviewedAt: '2026-01-16T00:00:00.000Z',
      },
    });

    expect(result.verdict).toBe('pass');
    expect(result.violations).toEqual([]);
    expect(result.provenanceComplete).toBe(true);
    expect(result.oversightSatisfied).toBe(true);
    expect(Date.parse(result.evaluatedAt)).not.toBeNaN();
  });

  it('blocks on equal-opportunity gap even when outcome rates are equal', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50, actualPositive: 50, truePositive: 45 },
        { group: 'B', total: 100, positive: 50, actualPositive: 40, truePositive: 20 },
      ],
      provenance,
    });

    expect(result.verdict).toBe('block');
    const equalOpportunity = result.metrics.find(
      (metric) => metric.name === 'equal_opportunity_difference',
    );
    expect(equalOpportunity?.value).toBe(0.4);
    expect(result.violations.join(' ')).toContain('equal_opportunity_difference');
  });

  it('states that equal opportunity is not computable without ground truth', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 50 },
      ],
      provenance,
    });

    expect(result.metrics.some((metric) => metric.name.includes('equal_opportunity'))).toBe(false);
    expect(result.reasons.join(' ')).toContain('Equal opportunity not computed');
  });

  it('warns when provenance is missing but metrics are fair', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 50 },
      ],
    });

    expect(result.verdict).toBe('warn');
    expect(result.provenanceComplete).toBe(false);
    expect(result.provenanceIssues).toContain('no data provenance supplied');
  });

  it('blocks when required human oversight is not approved', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 50 },
      ],
      provenance,
      oversight: { required: true, approved: false },
    });

    expect(result.verdict).toBe('block');
    expect(result.oversightSatisfied).toBe(false);
  });

  it('requires a reviewer identity when oversight is required', () => {
    const result = new FairnessEngine().evaluate({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 50 },
      ],
      provenance,
      oversight: { required: true, approved: true },
    });

    expect(result.verdict).toBe('block');
    expect(result.oversightSatisfied).toBe(false);
  });

  it('returns insufficient_data with fewer than two non-empty groups', () => {
    const result = new FairnessEngine().evaluate({
      groups: [{ group: 'A', total: 100, positive: 50 }],
      provenance,
    });

    expect(result.verdict).toBe('insufficient_data');
    expect(result.passed).toBe(false);
  });

  it('rejects inconsistent counts', () => {
    expect(() =>
      new FairnessEngine().evaluate({
        groups: [{ group: 'A', total: 10, positive: 11 }],
      }),
    ).toThrow(/positive .* cannot exceed total/);

    expect(() =>
      new FairnessEngine().evaluate({
        groups: [
          { group: 'A', total: 10, positive: 1 },
          { group: 'A', total: 10, positive: 1 },
        ],
      }),
    ).toThrow(/Duplicate fairness group/);
  });

  it('flags incomplete, unparseable and future provenance', () => {
    const engine = new FairnessEngine();

    expect(engine.checkProvenance({ ...provenance, consentBasis: ' ' }).issues).toContain(
      'consentBasis is empty',
    );
    expect(engine.checkProvenance({ ...provenance, collectedAt: 'not-a-date' }).issues).toContain(
      'collectedAt is not a valid ISO-8601 timestamp',
    );
    expect(
      engine.checkProvenance({ ...provenance, collectedAt: '2999-01-01T00:00:00.000Z' }).issues,
    ).toContain('collectedAt is in the future');
  });
});

describe('BehaviorOS.evaluateFairness', () => {
  it('is wired to the engine and usable without a DNA', () => {
    const bos = new BehaviorOS();
    const result = bos.evaluateFairness({
      groups: [
        { group: 'A', total: 100, positive: 50 },
        { group: 'B', total: 100, positive: 20 },
      ],
      provenance,
    });

    expect(result.verdict).toBe('block');
    expect(result.metrics).toHaveLength(2);
  });
});
