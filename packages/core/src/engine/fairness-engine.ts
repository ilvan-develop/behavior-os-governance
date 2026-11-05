import type {
  DataProvenance,
  FairnessEvaluation,
  FairnessGroup,
  FairnessMetric,
  FairnessThresholds,
  HumanOversight,
} from '@behavior-os/schemas';

export const DEFAULT_FAIRNESS_THRESHOLDS: FairnessThresholds = {
  maxParityDifference: 0.1,
  minDisparateImpactRatio: 0.8,
  maxEqualOpportunityDifference: 0.1,
};

export interface FairnessInput {
  groups: FairnessGroup[];
  provenance?: DataProvenance;
  oversight?: HumanOversight;
  thresholds?: Partial<FairnessThresholds>;
}

export interface ProvenanceCheck {
  complete: boolean;
  issues: string[];
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Deterministic Responsible-AI evaluation.
 *
 * It answers three separate questions and never conflates them:
 *  - are outcomes distributed fairly across groups (demographic parity,
 *    disparate impact, equal opportunity)?
 *  - is the data provenance complete and auditable?
 *  - was human oversight satisfied for a high-impact decision?
 *
 * Ground truth (`actualPositive` / `truePositive`) is optional: without it the
 * engine still reports parity metrics and explicitly states that equal
 * opportunity could not be computed, instead of inventing a number.
 */
export class FairnessEngine {
  evaluate(input: FairnessInput): FairnessEvaluation {
    if (!input || !Array.isArray(input.groups)) {
      throw new Error('Fairness evaluation requires an array of groups');
    }
    if (input.groups.length === 0) {
      throw new Error('Fairness evaluation requires at least one group');
    }

    this.validateGroups(input.groups);

    const thresholds: FairnessThresholds = {
      ...DEFAULT_FAIRNESS_THRESHOLDS,
      ...(input.thresholds ?? {}),
    };
    const metrics: FairnessMetric[] = [];
    const violations: string[] = [];
    const reasons: string[] = [];

    const usable = input.groups.filter((group) => group.total > 0);
    const provenance = this.checkProvenance(input.provenance);
    const oversightSatisfied = this.isOversightSatisfied(input.oversight);

    if (usable.length < 2) {
      reasons.push(
        'Insufficient data: at least two groups with a non-zero decision count are required.',
      );
      return {
        verdict: 'insufficient_data',
        passed: false,
        metrics,
        violations,
        provenanceComplete: provenance.complete,
        provenanceIssues: provenance.issues,
        oversightSatisfied,
        reasons,
        thresholds,
        evaluatedAt: new Date().toISOString(),
      };
    }

    const rates = usable.map((group) => ({
      group: group.group,
      rate: group.total === 0 ? 0 : group.positive / group.total,
    }));
    const minRate = Math.min(...rates.map((entry) => entry.rate));
    const maxRate = Math.max(...rates.map((entry) => entry.rate));

    const parityDifference = round(maxRate - minRate);
    const parityPassed = parityDifference <= thresholds.maxParityDifference;
    metrics.push({
      name: 'demographic_parity_difference',
      value: parityDifference,
      threshold: thresholds.maxParityDifference,
      passed: parityPassed,
      detail: rates.map((entry) => `${entry.group}=${round(entry.rate)}`).join(', '),
    });
    if (!parityPassed) {
      violations.push(
        `demographic_parity_difference ${parityDifference} exceeds ${thresholds.maxParityDifference}`,
      );
    }

    const impactRatio = maxRate === 0 ? 1 : round(minRate / maxRate);
    const impactPassed = impactRatio >= thresholds.minDisparateImpactRatio;
    metrics.push({
      name: 'disparate_impact_ratio',
      value: impactRatio,
      threshold: thresholds.minDisparateImpactRatio,
      passed: impactPassed,
      detail: maxRate === 0 ? 'no favourable decisions in any group' : `min/max rate ratio`,
    });
    if (!impactPassed) {
      violations.push(
        `disparate_impact_ratio ${impactRatio} is below ${thresholds.minDisparateImpactRatio}`,
      );
    }

    const withGroundTruth = usable.filter(
      (group) =>
        group.actualPositive !== undefined &&
        group.actualPositive > 0 &&
        group.truePositive !== undefined,
    );
    if (withGroundTruth.length >= 2) {
      const tprs = withGroundTruth.map((group) => ({
        group: group.group,
        tpr: (group.truePositive as number) / (group.actualPositive as number),
      }));
      const minTpr = Math.min(...tprs.map((entry) => entry.tpr));
      const maxTpr = Math.max(...tprs.map((entry) => entry.tpr));
      const eoDifference = round(maxTpr - minTpr);
      const eoPassed = eoDifference <= thresholds.maxEqualOpportunityDifference;
      metrics.push({
        name: 'equal_opportunity_difference',
        value: eoDifference,
        threshold: thresholds.maxEqualOpportunityDifference,
        passed: eoPassed,
        detail: tprs.map((entry) => `${entry.group}=${round(entry.tpr)}`).join(', '),
      });
      if (!eoPassed) {
        violations.push(
          `equal_opportunity_difference ${eoDifference} exceeds ${thresholds.maxEqualOpportunityDifference}`,
        );
      }
    } else {
      reasons.push(
        'Equal opportunity not computed: ground truth (actualPositive/truePositive) is missing for at least two groups.',
      );
    }

    if (!oversightSatisfied) {
      reasons.push(
        'Human oversight is required but not satisfied: approval with a non-empty reviewerId is mandatory.',
      );
    }
    if (!provenance.complete) {
      reasons.push(`Data provenance incomplete: ${provenance.issues.join('; ')}`);
    }

    let verdict: FairnessEvaluation['verdict'];
    if (violations.length > 0 || !oversightSatisfied) {
      verdict = 'block';
    } else if (!provenance.complete) {
      verdict = 'warn';
    } else {
      verdict = 'pass';
    }

    if (verdict === 'pass') {
      reasons.push('All fairness metrics, provenance and oversight checks passed.');
    }

    return {
      verdict,
      passed: verdict === 'pass',
      metrics,
      violations,
      provenanceComplete: provenance.complete,
      provenanceIssues: provenance.issues,
      oversightSatisfied,
      reasons,
      thresholds,
      evaluatedAt: new Date().toISOString(),
    };
  }

  checkProvenance(record?: DataProvenance): ProvenanceCheck {
    const issues: string[] = [];
    if (!record) {
      return { complete: false, issues: ['no data provenance supplied'] };
    }
    if (!record.datasetId?.trim()) issues.push('datasetId is empty');
    if (!record.source?.trim()) issues.push('source is empty');
    if (!record.consentBasis?.trim()) issues.push('consentBasis is empty');
    if (!record.collectedAt?.trim()) {
      issues.push('collectedAt is empty');
    } else {
      const collected = Date.parse(record.collectedAt);
      if (Number.isNaN(collected)) {
        issues.push('collectedAt is not a valid ISO-8601 timestamp');
      } else if (collected > Date.now() + 5 * 60 * 1000) {
        issues.push('collectedAt is in the future');
      }
    }
    for (const [index, step] of (record.transformations ?? []).entries()) {
      if (!step.trim()) issues.push(`transformations[${index}] is empty`);
    }
    for (const [index, parent] of (record.lineage ?? []).entries()) {
      if (!parent.trim()) issues.push(`lineage[${index}] is empty`);
    }
    return { complete: issues.length === 0, issues };
  }

  private isOversightSatisfied(oversight?: HumanOversight): boolean {
    if (!oversight?.required) return true;
    return oversight.approved && Boolean(oversight.reviewerId?.trim());
  }

  private validateGroups(groups: FairnessGroup[]): void {
    const seen = new Set<string>();
    for (const group of groups) {
      if (!group.group?.trim()) {
        throw new Error('Every fairness group requires a non-empty name');
      }
      if (seen.has(group.group)) {
        throw new Error(`Duplicate fairness group "${group.group}"`);
      }
      seen.add(group.group);
      if (group.positive > group.total) {
        throw new Error(
          `Group "${group.group}": positive (${group.positive}) cannot exceed total (${group.total})`,
        );
      }
      if (group.actualPositive !== undefined && group.actualPositive > group.total) {
        throw new Error(
          `Group "${group.group}": actualPositive (${group.actualPositive}) cannot exceed total (${group.total})`,
        );
      }
      if (
        group.truePositive !== undefined &&
        group.actualPositive !== undefined &&
        group.truePositive > group.actualPositive
      ) {
        throw new Error(
          `Group "${group.group}": truePositive (${group.truePositive}) cannot exceed actualPositive (${group.actualPositive})`,
        );
      }
    }
  }
}
