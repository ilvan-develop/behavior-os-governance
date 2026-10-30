import { describe, expect, it } from 'vitest';
import { GovernanceAsCodeEngine } from '../src/engine/governance-as-code-engine.js';

describe('GovernanceAsCodeEngine (G-020)', () => {
  it('creates a change request with pending CI status', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'add',
      {
        id: 'rule-1',
        level: 'high',
        action: 'block',
        conditions: [{ type: 'tool', value: 'bash' }],
        description: 'Block bash usage',
      },
      'Prevent accidental destructive commands',
    );

    expect(cr.id).toMatch(/^gcr-/);
    expect(cr.dnaName).toBe('lean-factory');
    expect(cr.changeType).toBe('add');
    expect(cr.ciStatus).toBe('pending');
  });

  it('runs CI validation and updates status', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'add',
      {
        id: 'rule-1',
        level: 'high',
        action: 'block',
        conditions: [{ type: 'tool', value: 'bash' }],
      },
      'Valid rationale for the test',
    );

    const result = engine.runCI(cr.id);
    expect(result.status).toBe('passing');
  });

  it('fails CI when rationale is too short', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'modify',
      { id: 'r1', level: 'low', action: 'warn', conditions: [] },
      'short',
    );

    const result = engine.runCI(cr.id);
    expect(result.status).toBe('failing');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('fails CI when proposed rule is missing for add', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'add',
      undefined,
      'Valid rationale for the test',
    );

    const result = engine.runCI(cr.id);
    expect(result.status).toBe('failing');
  });

  it('approves change requests after CI passes', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'delete',
      undefined,
      'This rule is no longer needed because of the new architecture',
    );

    const ciResult = engine.runCI(cr.id);
    expect(ciResult.status).toBe('passing');

    const approved = engine.approveChangeRequest(cr.id, 'admin-user');
    expect(approved).toBe(true);

    expect(engine.getApprovedChanges()).toHaveLength(1);
  });

  it('refuses approval when CI fails', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr = engine.createChangeRequest(
      'lean-factory',
      'rule-1',
      'add',
      { id: 'r1', level: 'low', action: 'warn', conditions: [] },
      'short',
    );

    engine.runCI(cr.id);
    const approved = engine.approveChangeRequest(cr.id, 'admin-user');
    expect(approved).toBe(false);
  });

  it('filters change requests by CI status', () => {
    const engine = new GovernanceAsCodeEngine();

    const cr1 = engine.createChangeRequest(
      'lean-factory',
      'r1',
      'delete',
      undefined,
      'valid rationale here for the change',
    );
    engine.createChangeRequest('lean-factory', 'r2', 'add', undefined, 'valid rationale here');

    engine.runCI(cr1.id);
    // cr2 stays pending

    expect(engine.getChangeRequests('passing')).toHaveLength(1);
    expect(engine.getChangeRequests('pending')).toHaveLength(1);
  });
});
