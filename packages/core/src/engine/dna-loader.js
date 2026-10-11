import { DNASchema } from '@behavior-os/schemas';
export class DNALoader {
  cache = new Map();
  patterns = new Map();
  load(dna) {
    const result = DNASchema.safeParse(dna);
    if (!result.success) {
      throw new Error(`Invalid DNA pattern: ${result.error.message}`);
    }
    return result.data;
  }
  loadFromObject(dna) {
    try {
      return this.load(dna);
    } catch {
      return null;
    }
  }
  register(name, dna) {
    this.patterns.set(name.toLowerCase(), dna);
    this.cache.set(name.toLowerCase(), dna);
  }
  get(name) {
    return this.patterns.get(name.toLowerCase()) ?? this.cache.get(name.toLowerCase());
  }
  list() {
    return Array.from(this.patterns.keys());
  }
  clearCache() {
    this.cache.clear();
  }
}
//# sourceMappingURL=dna-loader.js.map
