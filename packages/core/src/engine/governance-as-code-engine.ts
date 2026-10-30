/**
 * G-020: Governance-as-Code Repository Engine.
 *
 * Manages governance change requests as code — tracks proposed changes
 * to DNA patterns, their CI status, and approval workflow.
 */

type ChangeType = 'add' | 'modify' | 'delete';
type CIStatus = 'pending' | 'passing' | 'failing' | 'approved';

interface GovernanceRuleLike {
  id: string;
  level: 'critical' | 'high' | 'medium' | 'low';
  action: string;
  conditions: { type: string; value: unknown }[];
  description?: string;
}

interface GovernanceChangeRequest {
  id: string;
  dnaName: string;
  ruleId: string;
  changeType: ChangeType;
  proposedRule?: GovernanceRuleLike;
  rationale: string;
  ciStatus: CIStatus;
  createdAt: string;
}

function validateCI(changeReq: GovernanceChangeRequest): { status: CIStatus; errors: string[] } {
  const errors: string[] = [];

  if (changeReq.changeType === 'add' || changeReq.changeType === 'modify') {
    if (!changeReq.proposedRule) {
      errors.push('Proposed rule is required for add/modify changes');
    } else {
      const rule = changeReq.proposedRule;
      if (!rule.id || rule.id.length === 0) {
        errors.push('Rule must have an id');
      }
      if (!rule.action) {
        errors.push('Rule must specify an action');
      }
      if (!rule.conditions || rule.conditions.length === 0) {
        errors.push('Rule must have at least one condition');
      }
    }
  }

  if (!changeReq.rationale || changeReq.rationale.length < 10) {
    errors.push('Rationale must be at least 10 characters');
  }

  return {
    status: errors.length === 0 ? 'passing' : 'failing',
    errors,
  };
}

export class GovernanceAsCodeEngine {
  private changeRequests: GovernanceChangeRequest[] = [];
  private approvedChanges: GovernanceChangeRequest[] = [];

  /**
   * Submit a new change request.
   */
  createChangeRequest(
    dnaName: string,
    ruleId: string,
    changeType: ChangeType,
    proposedRule: GovernanceRuleLike | undefined,
    rationale: string,
  ): GovernanceChangeRequest {
    const changeReq: GovernanceChangeRequest = {
      id: `gcr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      dnaName,
      ruleId,
      changeType,
      proposedRule,
      rationale,
      ciStatus: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.changeRequests.push(changeReq);
    return changeReq;
  }

  /**
   * Run CI validation on a change request.
   */
  runCI(changeRequestId: string): { status: CIStatus; errors: string[] } {
    const changeReq = this.changeRequests.find((cr) => cr.id === changeRequestId);
    if (!changeReq) {
      return { status: 'failing', errors: ['Change request not found'] };
    }

    const result = validateCI(changeReq);
    changeReq.ciStatus = result.status;
    return result;
  }

  /**
   * Approve a change request (after CI passes).
   */
  approveChangeRequest(changeRequestId: string, _approvedBy: string): boolean {
    const changeReq = this.changeRequests.find((cr) => cr.id === changeRequestId);
    if (!changeReq) return false;
    if (changeReq.ciStatus !== 'passing') return false;

    changeReq.ciStatus = 'approved';
    this.approvedChanges.push(changeReq);
    return true;
  }

  /** Get all pending change requests. */
  getChangeRequests(status?: CIStatus): GovernanceChangeRequest[] {
    if (status) {
      return this.changeRequests.filter((cr) => cr.ciStatus === status);
    }
    return [...this.changeRequests];
  }

  /** Get all approved changes. */
  getApprovedChanges(): GovernanceChangeRequest[] {
    return [...this.approvedChanges];
  }
}

export type { ChangeType, CIStatus, GovernanceChangeRequest, GovernanceRuleLike };
