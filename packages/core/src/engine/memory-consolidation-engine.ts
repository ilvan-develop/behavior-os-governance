/**
 * G-008: Memory Consolidation Engine.
 *
 * Nightly consolidation process that converts episodic memory (individual
 * governance events) into semantic facts, prunes obsolete facts, and
 * produces a summary of the consolidation run.
 */

interface Episode {
  id: string;
  action: string;
  verdict: string;
  timestamp: number;
  reason?: string;
}

interface SemanticFactInternal {
  id: string;
  fact: string;
  sourceEpisodes: string[];
  confidence: number;
  createdAt: string;
  lastValidated?: string;
}

function extractFactsFromEpisode(episode: Episode): string[] {
  const facts: string[] = [];

  // Fact: "Action X tends to result in verdict Y"
  facts.push(`Action '${episode.action}' results in '${episode.verdict}'`);

  // Fact: "Rule with reason Z fires for action A"
  if (episode.reason) {
    facts.push(`Reason '${episode.reason}' applies to action '${episode.action}'`);
  }

  return facts;
}

function mergeSimilarFacts(facts: SemanticFactInternal[]): SemanticFactInternal[] {
  const merged: SemanticFactInternal[] = [];
  const used = new Set<string>();

  for (let i = 0; i < facts.length; i++) {
    if (used.has(facts[i].id)) continue;
    const current = facts[i];
    const similar = [current];

    for (let j = i + 1; j < facts.length; j++) {
      if (used.has(facts[j].id)) continue;
      // Merge facts with the same fact text (simple string match)
      if (facts[j].fact === current.fact) {
        similar.push(facts[j]);
        used.add(facts[j].id);
      }
    }

    const mergedFact: SemanticFactInternal = {
      id: current.id,
      fact: current.fact,
      sourceEpisodes: similar.flatMap((f) => f.sourceEpisodes),
      confidence: Math.min(1, similar.reduce((sum, f) => sum + f.confidence, 0) / similar.length),
      createdAt: current.createdAt,
      lastValidated: current.lastValidated,
    };
    merged.push(mergedFact);
    used.add(current.id);
  }

  return merged;
}

function pruneObsoleteFacts(
  facts: SemanticFactInternal[],
  threshold = 0.1,
): SemanticFactInternal[] {
  return facts.filter((f) => f.confidence >= threshold);
}

export class MemoryConsolidationEngine {
  private semanticFacts: SemanticFactInternal[] = [];

  /**
   * Consolidate episodic memory (behavior events) into semantic facts.
   *
   * @param episodes - The episodic events to process.
   * @param now - Timestamp for the consolidation run.
   */
  consolidate(
    episodes: Episode[],
    now = new Date().toISOString(),
  ): {
    semanticFacts: SemanticFactInternal[];
    summary: string;
    episodesProcessed: number;
    factsPruned: number;
  } {
    const newFacts: SemanticFactInternal[] = [];

    for (const episode of episodes) {
      const factStrings = extractFactsFromEpisode(episode);
      for (const factStr of factStrings) {
        newFacts.push({
          id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fact: factStr,
          sourceEpisodes: [episode.id],
          confidence: 0.5, // Default confidence for new facts
          createdAt: now,
        });
      }
    }

    // Merge with existing facts
    const mergedAll = mergeSimilarFacts([...this.semanticFacts, ...newFacts]);

    // Prune obsolete facts
    const beforePrune = mergedAll.length;
    const pruned = pruneObsoleteFacts(mergedAll);

    this.semanticFacts = pruned;

    // Strengthen confidence of facts that appear in multiple episodes
    for (const fact of this.semanticFacts) {
      const sourceCount = fact.sourceEpisodes.length;
      fact.confidence = Math.min(1, 0.5 + (sourceCount - 1) * 0.1);
      fact.lastValidated = now;
    }

    const summary = `Consolidated ${episodes.length} episodes into ${this.semanticFacts.length} semantic facts. Pruned ${beforePrune - this.semanticFacts.length} obsolete facts.`;

    return {
      semanticFacts: [...this.semanticFacts],
      summary,
      episodesProcessed: episodes.length,
      factsPruned: beforePrune - this.semanticFacts.length,
    };
  }

  /** Get all semantic facts. */
  getFacts(): SemanticFactInternal[] {
    return [...this.semanticFacts];
  }

  /** Query facts matching a text pattern. */
  queryFacts(pattern: string): SemanticFactInternal[] {
    const regex = new RegExp(pattern, 'i');
    return this.semanticFacts.filter((f) => regex.test(f.fact));
  }

  /** Clear all semantic facts. */
  clear(): void {
    this.semanticFacts = [];
  }
}

export type { SemanticFactInternal };
