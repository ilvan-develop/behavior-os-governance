import type { DNA } from '@behavior-os/schemas';
import { describe, expect, it } from 'vitest';
import { DNALoader } from '../src/engine/dna-loader.js';

describe('DNALoader', () => {
  const loader = new DNALoader();

  it('should load valid DNA', () => {
    const dna: DNA = {
      name: 'Test DNA',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    const loaded = loader.load(dna);
    expect(loaded.name).toBe('Test DNA');
  });

  it('should reject invalid DNA', () => {
    expect(() => loader.load({} as DNA)).toThrow();
  });

  it('should register and retrieve DNA patterns', () => {
    const dna: DNA = {
      name: 'Surgical Team',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    loader.register('surgical-team', dna);
    const retrieved = loader.get('surgical-team');

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Surgical Team');
  });

  it('should be case-insensitive for pattern names', () => {
    const dna: DNA = {
      name: 'Test',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    loader.register('Test-Pattern', dna);
    const retrieved = loader.get('test-pattern');

    expect(retrieved).toBeDefined();
  });

  it('should return undefined for unregistered pattern', () => {
    const retrieved = loader.get('non-existent');
    expect(retrieved).toBeUndefined();
  });

  it('should list registered patterns', () => {
    loader.register('pattern-1', {
      name: 'Pattern 1',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    });
    loader.register('pattern-2', {
      name: 'Pattern 2',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    });

    const list = loader.list();
    expect(list).toContain('pattern-1');
    expect(list).toContain('pattern-2');
  });

  it('should clear cache', () => {
    loader.register('pattern-1', {
      name: 'Pattern 1',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    });

    loader.clearCache();
    // After clearing cache, it should still be in patterns but not cached
    const list = loader.list();
    expect(list).toContain('pattern-1');
  });

  it('should return null for invalid DNA via loadFromObject', () => {
    const result = loader.loadFromObject({} as DNA);
    expect(result).toBeNull();
  });

  it('should return DNA for valid input via loadFromObject', () => {
    const dna: DNA = {
      name: 'Valid DNA',
      version: '1.0.0',
      description: 'Test',
      personas: [],
      governance: [],
      quality: [],
    };

    const result = loader.loadFromObject(dna);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Valid DNA');
  });
});
