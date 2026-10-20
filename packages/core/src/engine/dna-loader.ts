import { readFileSync } from 'node:fs';
import type { DNA } from '@behavior-os/schemas';
import { DNASchema } from '@behavior-os/schemas';
import { load as yamlLoad } from 'js-yaml';

export class DNALoader {
  private cache: Map<string, DNA> = new Map();
  private patterns: Map<string, DNA> = new Map();

  load(dna: unknown): DNA {
    const result = DNASchema.safeParse(dna);
    if (!result.success) {
      throw new Error(`Invalid DNA pattern: ${result.error.message}`);
    }
    return result.data;
  }

  /**
   * Load and validate a DNA YAML file. Core already owns the YAML parser, so
   * hosts (CLI, orchestrator) reuse this instead of adding a second parser.
   */
  loadFile(filePath: string): DNA {
    const raw: unknown = yamlLoad(readFileSync(filePath, 'utf-8'));
    return this.load(raw);
  }

  loadFromObject(dna: unknown): DNA | null {
    try {
      return this.load(dna);
    } catch {
      return null;
    }
  }

  register(name: string, dna: DNA): void {
    this.patterns.set(name.toLowerCase(), dna);
    this.cache.set(name.toLowerCase(), dna);
  }

  get(name: string): DNA | undefined {
    return this.patterns.get(name.toLowerCase()) ?? this.cache.get(name.toLowerCase());
  }

  list(): string[] {
    return Array.from(this.patterns.keys());
  }

  clearCache(): void {
    this.cache.clear();
  }
}
