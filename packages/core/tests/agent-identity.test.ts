import type { Agent, DNA } from '@behavior-os/schemas';
import { beforeEach, describe, expect, it } from 'vitest';
import { BehaviorOS, personaIdentity, UNASSIGNED_AGENT_ID } from '../src/engine/behavior-os.js';

/**
 * The governed agent identity is what audits, governance decisions and the
 * governance log are attributed to. It must be derived from the selected DNA
 * (persona) or a registered agent — never from the model name, which is what
 * the host happens to be running.
 */
function makeDna(overrides: Partial<DNA> = {}): DNA {
  return {
    name: 'Test DNA',
    version: '1.0.0',
    description: 'Identity test pattern',
    personas: [
      { role: 'developer', name: 'Test Dev', authority: 'developer', skills: ['coding'] },
      { role: 'reviewer', name: 'Test Reviewer', authority: 'reviewer', skills: ['review'] },
    ],
    governance: [],
    quality: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Agent One',
    type: 'developer',
    status: 'idle',
    dnaPattern: 'Test DNA',
    capabilities: [],
    currentMission: null,
    metrics: { tasksCompleted: 0, tasksFailed: 0, avgResponseTime: 0, governanceViolations: 0 },
    ...overrides,
  };
}

describe('Governed agent identity', () => {
  let bos: BehaviorOS;

  beforeEach(() => {
    bos = new BehaviorOS();
  });

  it('reports "unassigned" instead of a model name when nothing is selected', () => {
    const identity = bos.resolveAgentIdentity();
    expect(identity.agentId).toBe(UNASSIGNED_AGENT_ID);
    expect(identity.persona).toBeNull();
    expect(identity.dnaPattern).toBeNull();
    expect(identity.source).toBe('unassigned');
  });

  it('derives the identity from the first DNA persona on loadDNA', async () => {
    await bos.loadDNA(makeDna());

    const identity = bos.resolveAgentIdentity();
    expect(identity.agentId).toBe(personaIdentity('developer'));
    expect(identity.persona).toBe('developer');
    expect(identity.dnaPattern).toBe('Test DNA');
    expect(identity.source).toBe('persona');
  });

  it('auto-registers the active persona as a configurable-free role on loadDNA', async () => {
    await bos.loadDNA(makeDna());

    const engine = bos.getRolePolicyEngine();
    const role = engine.getRole('developer');
    expect(role).toBeDefined();
    // Fail-safe posture: identity and attribution only; policies empty and no
    // capabilities granted until an explicit registration adds them.
    expect(role?.policies).toEqual([]);
    expect(role?.canAudit).toBe(false);
    expect(role?.canEnforce).toBe(false);
    expect(role?.canTeach).toBe(false);
    expect(role?.responsibilities).toEqual(['coding']);

    // Out-of-the-box evaluation now works and lands in the audit trail.
    const decision = engine.evaluate({ persona: 'developer' }, 'write code');
    expect(decision.action).toBe('allow');
    expect(decision.role?.id).toBe('developer');
    expect(engine.getAuditTrail()).toHaveLength(1);
  });

  it('auto-registers the role for an explicitly activated persona too', async () => {
    await bos.loadDNA(makeDna());
    // The first persona ('developer') is auto-registered by loadDNA; activate
    // the other one through the setAgent path.
    expect(bos.setActiveAgent({ persona: 'reviewer' })?.persona).toBe('reviewer');
    expect(bos.getRolePolicyEngine().getRole('reviewer')).toBeDefined();
  });

  it('never overwrites an explicitly registered role with the auto one', async () => {
    const engine = bos.getRolePolicyEngine();
    engine.registerRole({
      id: 'developer',
      name: 'Hand-rolled Dev',
      displayName: 'Hand-rolled Dev',
      responsibilities: [],
      policies: ['explicit-policy'],
      canAudit: true,
      canEnforce: true,
      canTeach: true,
    });

    await bos.loadDNA(makeDna());
    const role = bos.getRolePolicyEngine().getRole('developer');
    expect(role?.name).toBe('Hand-rolled Dev');
    expect(role?.policies).toEqual(['explicit-policy']);
    expect(role?.canEnforce).toBe(true);
  });

  it('leaves the persona unset when the DNA defines none', async () => {
    await bos.loadDNA(makeDna({ personas: [] }));

    const identity = bos.resolveAgentIdentity();
    expect(identity.agentId).toBe(UNASSIGNED_AGENT_ID);
    expect(identity.persona).toBeNull();
    // The DNA is still known, so the gap is scoped rather than invisible.
    expect(identity.dnaPattern).toBe('Test DNA');
  });

  it('attributes audits to the DNA persona when agentId is omitted', async () => {
    await bos.loadDNA(makeDna());

    const report = await bos.runAudit({ missionId: 'mission-1' });

    expect(report.agentId).toBe(personaIdentity('developer'));
    expect(report.persona).toBe('developer');
    expect(report.dnaPattern).toBe('Test DNA');
  });

  it('reports "unassigned" for audits run without a DNA selection', async () => {
    const report = await bos.runAudit({ missionId: 'mission-1' });
    expect(report.agentId).toBe(UNASSIGNED_AGENT_ID);
  });

  it('honours an explicit agentId but still stamps DNA and persona', async () => {
    await bos.loadDNA(makeDna());

    const report = await bos.runAudit({ missionId: 'mission-1', agentId: 'auditor-7' });

    expect(report.agentId).toBe('auditor-7');
    expect(report.persona).toBe('developer');
    expect(report.dnaPattern).toBe('Test DNA');
  });

  it('switches persona by role or name', async () => {
    await bos.loadDNA(makeDna());

    const byRole = bos.setActiveAgent({ persona: 'reviewer' });
    expect(byRole?.agentId).toBe(personaIdentity('reviewer'));

    const byName = bos.setActiveAgent({ persona: 'Test Dev' });
    expect(byName?.persona).toBe('developer');
  });

  it('returns null for a persona the active DNA does not define', async () => {
    await bos.loadDNA(makeDna());
    expect(bos.setActiveAgent({ persona: 'compliance' })).toBeNull();
  });

  it('registers and activates an agent in one call', () => {
    const identity = bos.setActiveAgent({
      id: 'agent-9',
      name: 'Nightly Auditor',
      type: 'reviewer',
      capabilities: ['audit'],
    });

    expect(identity?.agentId).toBe('agent-9');
    expect(identity?.source).toBe('registered');
    expect(bos.listAgents()).toHaveLength(1);
    expect(bos.getAgent('agent-9')?.capabilities).toEqual(['audit']);
  });

  it('activates an already registered agent by id', () => {
    bos.registerAgent(makeAgent({ id: 'agent-2', name: 'Agent Two' }));

    const identity = bos.setActiveAgent({ id: 'agent-2' });

    expect(identity?.agentId).toBe('agent-2');
    expect(identity?.source).toBe('registered');
    expect(identity?.agent?.name).toBe('Agent Two');
  });

  it('prefers a registered agent bound to the DNA over the default persona', async () => {
    bos.registerAgent(makeAgent({ id: 'agent-3', name: 'Pattern Dev', dnaPattern: 'Test DNA' }));

    await bos.loadDNA(makeDna());

    const identity = bos.resolveAgentIdentity();
    expect(identity.agentId).toBe('agent-3');
    expect(identity.source).toBe('registered');
  });

  it('keeps the identity across an export/import round trip', async () => {
    await bos.loadDNA(makeDna());
    bos.setActiveAgent({ persona: 'reviewer' });

    // Round trip through JSON, as a host persists it.
    const snapshot = JSON.parse(JSON.stringify(bos.exportState()));
    const restored = new BehaviorOS();
    expect(restored.importState(snapshot)).toBe(true);

    const identity = restored.resolveAgentIdentity();
    expect(identity.agentId).toBe(personaIdentity('reviewer'));
    expect(identity.persona).toBe('reviewer');
    expect(identity.dnaPattern).toBe('Test DNA');
  });

  it('derives an explicit identity from a snapshot that predates the field', async () => {
    await bos.loadDNA(makeDna());
    const snapshot = JSON.parse(JSON.stringify(bos.exportState())) as {
      agentState: Record<string, unknown>;
    };
    delete snapshot.agentState.agentId;
    delete snapshot.agentState.persona;

    const restored = new BehaviorOS();
    expect(restored.importState(snapshot as never)).toBe(true);

    const identity = restored.resolveAgentIdentity();
    expect(identity.agentId).toBe(UNASSIGNED_AGENT_ID);
    expect(identity.persona).toBeNull();
  });
});
