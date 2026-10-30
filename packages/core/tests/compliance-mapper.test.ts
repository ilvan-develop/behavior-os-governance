import type { GovernanceRule } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { ComplianceMapperEngine } from '../src/engine/compliance-mapper-engine.js';

function makeRules(): GovernanceRule[] {
  return [
    {
      id: 'gprp-data-access',
      level: 'critical',
      action: 'block',
      conditions: [{ type: 'resource', value: 'pii-data' }],
      description: 'GDPR: restrict access to personal data',
    },
    {
      id: 'sox-audit-trail',
      level: 'high',
      action: 'escalate',
      conditions: [{ type: 'action', value: 'financial-report' }],
      description: 'SOX: financial reports require audit trail',
    },
    {
      id: 'generic-lint',
      level: 'low',
      action: 'warn',
      conditions: [{ type: 'tool', value: 'biome' }],
      description: 'Run biome before commit',
    },
  ];
}

describe('ComplianceMapperEngine (G-016)', () => {
  it('maps governance rules to registered regulations', () => {
    const engine = new ComplianceMapperEngine();
    engine.registerRegulation('GDPR Article 5', /gprp|gdpr|personal.data/i);
    engine.registerRegulation('SOX 302', /sox|financial/i);

    const maps = engine.mapRules(makeRules(), ['GDPR Article 5', 'SOX 302']);
    expect(maps).toHaveLength(2);

    const gdpr = maps.find((m) => m.regulation === 'GDPR Article 5');
    expect(gdpr?.rules).toContain('gprp-data-access');
    expect(gdpr?.status).toBe('compliant'); // has a block rule, so blockingCount/totalRules >= 0.5

    const sox = maps.find((m) => m.regulation === 'SOX 302');
    expect(sox?.rules).toContain('sox-audit-trail');
    expect(sox?.status).toBe('compliant'); // has an escalate rule
  });

  it('reports violation when no rules match a regulation', () => {
    const engine = new ComplianceMapperEngine();
    engine.registerRegulation('HIPAA Privacy Rule', /hipaa|health.data/i);

    const maps = engine.mapRules(makeRules(), ['HIPAA Privacy Rule']);
    expect(maps).toHaveLength(1);
    expect(maps[0].status).toBe('violation');
    expect(maps[0].rules).toHaveLength(0);
  });

  it('reports at-risk when matching rules lack blocking actions', () => {
    const engine = new ComplianceMapperEngine();
    // Pattern that matches a warn-only rule
    engine.registerRegulation('Test Regulation', /biome/i);

    const maps = engine.mapRules(makeRules(), ['Test Regulation']);
    expect(maps[0].status).toBe('at-risk'); // only a warn rule matched, blockingCount = 0
  });

  it('tracks compliance maps and overall status', () => {
    const engine = new ComplianceMapperEngine();
    engine.registerRegulation('GDPR Article 5', /gprp|gdpr|personal.data/i);
    engine.registerRegulation('SOX 302', /sox|financial/i);

    const maps = engine.mapRules(makeRules(), ['GDPR Article 5', 'SOX 302']);
    for (const map of maps) engine.setComplianceMap(map);

    expect(engine.getComplianceMap('GDPR Article 5')?.status).toBe('compliant');
    expect(engine.overallStatus()).toBe('compliant');

    // Force a violation
    engine.setComplianceMap({
      id: 'test',
      regulation: 'HIPAA',
      rules: [],
      evidence: [],
      lastAudit: new Date().toISOString(),
      status: 'violation',
      score: 0,
    });
    expect(engine.overallStatus()).toBe('violation');
  });

  it('returns all saved compliance maps', () => {
    const engine = new ComplianceMapperEngine();
    engine.registerRegulation('GDPR Article 5', /gprp|gdpr|personal.data/i);

    const maps = engine.mapRules(makeRules(), ['GDPR Article 5']);
    for (const map of maps) engine.setComplianceMap(map);

    expect(engine.getAllMaps()).toHaveLength(1);
  });
});
