import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { NaturalLanguageEngine } from '../src/engine/natural-language-engine.js';

describe('NaturalLanguageEngine', () => {
  it('parses "Block" rules correctly', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Block production deploys when tests are failing');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('block');
    expect(result.rule?.level).toBe('high');
    expect(result.rule?.confidence).toBe(0.9);
    expect(result.rule?.conditions).toContainEqual({
      type: 'context',
      value: 'tests are failing',
    });
  });

  it('parses "Require approval" rules correctly', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Require approval for mainnet transactions');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('escalate'); // 'require' maps to 'escalate'
    expect(result.rule?.level).toBe('medium');
  });

  it('parses "Warn before" rules correctly', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Warn before large transfers if amount exceeds threshold');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('warn');
    expect(result.rule?.level).toBe('medium');
    expect(result.rule?.confidence).toBe(0.8);
  });

  it('parses "Never" rules as critical blocks', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Never merge code without code review');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('block');
    expect(result.rule?.level).toBe('critical');
    expect(result.rule?.confidence).toBe(0.95);
  });

  it('parses "Must have" rules correctly', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Must have automated tests before deployment');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('escalate'); // 'require' maps to 'escalate'
    expect(result.rule?.level).toBe('high');
  });

  it('parses "Log" rules correctly', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Log all security-relevant actions');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('log');
    expect(result.rule?.level).toBe('low'); // 'info' maps to 'low'
  });

  it('falls back to keyword-based parsing for non-standard syntax', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Block this dangerous operation whenever possible');

    expect(result.success).toBe(true);
    expect(result.rule?.action).toBe('block');
    expect(result.rule?.level).toBe('high');
  });

  it('returns error with alternatives for unrecognized rules', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Do something interesting with the system');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives?.length).toBeGreaterThan(0);
  });

  it('parses multiple rules in batch', () => {
    const engine = new NaturalLanguageEngine();
    const sources = [
      'Block production deploys when tests fail',
      'Require approval for mainnet transactions',
      'Warn before large transfers if amount > 10000',
    ];

    const results = engine.parseRulesBatch(sources);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.confidence > 0.5)).toBe(true);
  });

  it('generates human-readable descriptions from structured rules', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Block deploys when tests are failing');
    expect(result.success).toBe(true);

    const description = engine.ruleToNaturalLanguage(
      result.rule ?? {
        id: 'fallback',
        level: 'low',
        action: 'warn',
        conditions: [],
        description: '',
        confidence: 0,
      },
    );
    expect(description).toContain(result.rule?.id);
    expect(description.toLowerCase()).toContain('block');
  });

  it('applies parsed rules to a DNA pattern', () => {
    const engine = new NaturalLanguageEngine();
    const dna: DNA = {
      name: 'test-dna',
      description: 'Test DNA',
      version: '1.0.0',
      personas: [],
      governance: [],
      quality: [],
    };

    const sources = [
      'Block production deploys when tests are failing',
      'Require approval for mainnet transactions',
    ];

    const result = engine.applyRules(dna, sources);
    expect(result.applied.length).toBe(2);
    expect(result.errors.length).toBe(0);
    expect(result.dna.governance.length).toBe(2);
    expect(result.dna.governance[0].action).toBe('block');
    expect(result.dna.governance[1].action).toBe('escalate'); // 'require' maps to 'escalate'
  });

  it('filters out low-confidence rules', () => {
    const engine = new NaturalLanguageEngine();
    const dna: DNA = {
      name: 'test-dna',
      description: 'Test DNA',
      version: '1.0.0',
      personas: [],
      governance: [],
      quality: [],
    };

    const sources = [
      'Block production deploys when tests are failing', // high confidence
      'Do something interesting with the system', // unrecognized syntax - not parsed
    ];

    const result = engine.applyRules(dna, sources);
    expect(result.applied.length).toBe(1);
    // Only 1 rule was successfully parsed, so no errors from filtering
    expect(result.errors.length).toBe(0);
  });

  it('uses custom rule IDs when provided', () => {
    const engine = new NaturalLanguageEngine();
    const result = engine.parseRule('Block deploys when tests fail', {
      ruleId: 'custom-rule-id',
    });

    expect(result.success).toBe(true);
    expect(result.rule?.id).toBe('custom-rule-id');
  });
});
