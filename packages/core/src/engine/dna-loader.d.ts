import type { DNA } from '@behavior-os/schemas';
export declare class DNALoader {
  private cache;
  private patterns;
  load(dna: unknown): DNA;
  loadFromObject(dna: unknown): DNA | null;
  register(name: string, dna: DNA): void;
  get(name: string): DNA | undefined;
  list(): string[];
  clearCache(): void;
}
//# sourceMappingURL=dna-loader.d.ts.map
