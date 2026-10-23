import { describe, expect, it } from 'vitest';
import { AntipatternEngine } from '../src/engine/antipattern-engine.js';

describe('AntipatternEngine', () => {
  it('scans for TypeScript errors', () => {
    const engine = new AntipatternEngine();
    const result = engine.scan(
      'Error: TS2345: Argument of type string is not assignable to parameter of type number',
    );
    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.patterns.some((p) => p.type === 'typescript-error')).toBe(true);
  });

  it('scans for security vulnerabilities', () => {
    const engine = new AntipatternEngine();
    const result = engine.scan('Hardcoded password found: secret123');
    const securityPatterns = result.patterns.filter((p) => p.type === 'security-vulnerability');
    expect(securityPatterns.length).toBeGreaterThan(0);
    expect(securityPatterns[0].severity).toBe('critical');
  });

  it('returns empty for clean text', () => {
    const engine = new AntipatternEngine();
    const result = engine.scan('This is clean code with no issues');
    expect(result.summary.total).toBe(0);
  });

  it('fixes a pattern', () => {
    const engine = new AntipatternEngine();
    const scanResult = engine.scan('Error: eval(userInput) is dangerous');
    expect(scanResult.patterns.length).toBeGreaterThan(0);
    const fixed = engine.fixPattern(scanResult.patterns[0].id, 'Removed eval usage');
    expect(fixed).not.toBeNull();
    if (!fixed) throw new Error('Expected a fix result');
    expect(fixed.fixApplied).toBe(true);
  });

  it('generates report', () => {
    const engine = new AntipatternEngine();
    engine.scan('TS2345: Type mismatch');
    const report = engine.generateReport();
    expect(report).toContain('Anti-Pattern');
  });

  it('auto-fixes critical patterns', () => {
    const engine = new AntipatternEngine();
    engine.scan('CVE-2024-1234: Critical vulnerability');
    const fixed = engine.autoFixCritical();
    expect(fixed.length).toBeGreaterThan(0);
  });
});
